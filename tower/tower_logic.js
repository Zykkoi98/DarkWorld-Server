// ============================================================================
// ===== 🏰 ПРОЦЕДУРНОЕ СЕРВЕРНОЕ ЯДРО БАШНИ (TOWER/TOWER_LOGIC.JS) — ЧАСТЬ 1 =====
// ============================================================================

const dbHelper = require('../db_helper');
const { TOWER_SHOP_DATABASE } = require('./tower_config');

module.exports = function(io, socket, sb, activeRooms) {
  if (!socket) return;

  const getServerMaxHp = dbHelper.getServerMaxHp;
  const triggerLoadGameSuccess = dbHelper.triggerLoadGameSuccess;

    // --- 🕒 ОБРАБОТЧИК: ОТДАЧА СТАТУСА КУЛДАУНА БЕЗ ЛОЖНЫХ СБРОСОВ ЭТАЖЕЙ ---
  socket.on('check_tower_cooldown_request', async ({ userId }) => {
    try {
      const nUserId = Number(userId);
      const { data: timerRow } = await sb.from('player_timers')
        .select('ends_at')
        .eq('user_id', nUserId)
        .eq('timer_type', 'tower_cooldown')
        .maybeSingle();

      // Проверяем, активен ли таймер прямо сейчас
      if (timerRow && new Date(timerRow.ends_at) > new Date()) {
        socket.emit('tower_cooldown_status', { active: true, ends_at: timerRow.ends_at });
      } else {
        // 🟢 Кулдаун отсутствует, истек или это старая запись в БД!
        if (timerRow) {
          // Если старая просроченная строчка КД до сих пор пылится в базе, 
          // просто тихо стираем её, чтобы не засорять таблицу таймеров
          await sb.from('player_timers')
            .delete()
            .eq('user_id', nUserId)
            .eq('timer_type', 'tower_cooldown');
          console.log(`🧹 [БД ТАЙМЕР] Просроченная строка КД удалена для ID ${nUserId}.`);
        }

        // 🔥 ЖЕЛЕЗНЫЙ ФИКС: Больше НИКАКИХ принудительных сбросов tower_floor на 1 здесь!
        // Прогресс теперь сбрасывается только физически в момент экрана поражения.
        socket.emit('tower_cooldown_status', { active: false });
      }
    } catch (err) { 
      console.error("🚨 Ошибка проверки КД в Башне:", err.message); 
    }
  });

  // --- 🔐 ОБРАБОТЧИК: ИЗОЛИРОВАННАЯ АВТОР ИЗАЦИЯ СОКЕТА БАШНИ ---
  socket.on('load_tower_game_secure', async ({ userId, username }) => {
    console.log(`🔐 [🏰 БАШНЯ АВТОР ИЗАЦИЯ] Сокет ${socket.id} пробит для Башни: ${username}`);
    try {
      const nUserId = Number(userId);
      const { data: dbPlayer } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      
      if (dbPlayer) {
        const currentXp = dbHelper.safeReadField(dbPlayer, 'xp', 0);
        const cloudLevel = dbHelper.getServerCorrectLevelByXp(currentXp);
        let pointsKey = dbPlayer.statpoints !== undefined ? 'statpoints' : 'statPoints';

        const playerProfile = {
                id: dbPlayer.id, name: dbPlayer.name, avatar: dbPlayer.avatar || "assets/avatars/hero1.png",
                level: cloudLevel, gold: dbHelper.safeReadField(dbPlayer, 'gold', 0), xp: currentXp,
                hp: dbHelper.safeReadField(dbPlayer, 'hp', 10), statPoints: dbHelper.safeReadField(dbPlayer, pointsKey, 0),
                currentTownIndex: dbHelper.safeReadField(dbPlayer, 'currenttownindex', 0),
                
                // 🔥 [ФИНАЛЬНЫЙ ФИКС ЭТАЖА БАШНИ]
                // Теперь сервер честно забирает двойку из Supabase и шлет её на телефон!
                tower_floor: dbHelper.safeReadField(dbPlayer, 'tower_floor', 1),
                tower_coins: dbHelper.safeReadField(dbPlayer, 'tower_coins', 0), 

                stats: {
                    strength: dbHelper.safeReadField(dbPlayer, 'strength', 1),
                    agility: dbHelper.safeReadField(dbPlayer, 'agility', 1),
                    endurance: dbHelper.safeReadField(dbPlayer, 'endurance', 1),
                    luck: dbHelper.safeReadField(dbPlayer, 'luck', 1)
                },
                inventory: dbPlayer.inventory || { equipment: [], resources: [], consumables: [] },
                equipped: dbPlayer.equipped || { rings: [null, null, null] }
                };

                socket.emit('tower_load_game_success', { player: playerProfile });
            }
            } catch (err) { console.error("🚨 Ошибка сокет-авторизации Башни:", err.message); }
        });

  // --- ОБРАБОТЧИК Б: ЛАВКА БАШНИ ---
  socket.on('buy_tower_shop_item_secure', async ({ userId, itemId }) => {
    try {
      const nUserId = Number(userId);
      const itemConfig = TOWER_SHOP_DATABASE[itemId];
      if (!itemConfig) return socket.emit('tower_shop_error', { message: "🚨 Предмет отсутствует!" });

      const { data: playerRow } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      const currentGold = Number(playerRow.gold ?? 0);
      if (currentGold < itemConfig.price) return socket.emit('tower_shop_error', { message: "❌ Мало золота!" });

      let inventory = playerRow.inventory || { equipment: [], consumables: [], resources: [] };
      if (itemConfig.type === 'consumable') {
        const existing = inventory.consumables.find(c => c.id === itemId);
        if (existing) existing.count = (existing.count || 1) + 1;
        else inventory.consumables.push({ id: itemId, count: 1 });
      } else {
        inventory.equipment.push({ uuid: `${itemId}_tower_${Date.now()}`, id: itemId });
      }

      await sb.from('players').update({ gold: currentGold - itemConfig.price, inventory }).eq('id', nUserId);
      await triggerLoadGameSuccess(nUserId, socket, sb);
      socket.emit('tower_shop_success', { message: "🎉 Успешно куплено!" });
    } catch (err) { socket.emit('tower_shop_error', { message: `🚨 Ошибка: ${err.message}` }); }
  });
  // --- 🏰 ОБРАБОТЧИК: ПРОЦЕДУРНЫЙ СПАВН ЭТАЖА И РЕДИРЕКТ ---
  socket.on('start_tower_battle_secure', async ({ userId, currentFloor }) => {
    console.log(`\n📥 [БЭКЕНД] Начат штурм этажа: ${currentFloor}`);
    try {
      const nUserId = Number(userId);
      const floor = Math.max(1, Number(currentFloor || 1));

      await sb.from('arena_lobby').delete().eq('id', nUserId);
      io.emit('arena_lobby_updated');

      const { data: dbPlayer } = await sb.from('players').select('*').eq('id', nUserId).single();
      const { data: allBots, error: botsErr } = await sb.from('bots').select('*').eq('category', 'tower');

      if (!dbPlayer || !allBots || allBots.length === 0) {
        return socket.emit('error', 'В базе данных Supabase не найдены монстры с тегом "tower".');
      }

      const roomId = `room_tower_${dbPlayer.id}_floor_${floor}_${Date.now()}`;
      const playerVirtualObj = { endurance: Number(dbPlayer.endurance || 1), equipped: dbPlayer.equipped || {} };
      const pMaxHp = getServerMaxHp(playerVirtualObj);

      const teamA = [{
        uuid: `player_${dbPlayer.id}`, id: String(dbPlayer.id), name: dbPlayer.name, icon: '👤', isBot: false,
        level: Number(dbPlayer.level || 1), strength: Number(dbPlayer.strength || 1), agility: Number(dbPlayer.agility || 1), endurance: Number(dbPlayer.endurance || 1), luck: Number(dbPlayer.luck || 1),
        currentHp: Math.min(Number(dbPlayer.hp || pMaxHp), pMaxHp), maxHp: pMaxHp, socketId: socket.id, turn: null,
        gold: Number(dbPlayer.gold || 0), xp: Number(dbPlayer.xp || 0), statpoints: Number(dbPlayer.statpoints || 0),
        equipped: dbPlayer.equipped || {}, inventory: dbPlayer.inventory || {}, afkTurns: 0 
      }];

      const teamB = [];
      const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
      const statMultiplier = 1 + ((floor - 1) * 0.20);
      const rewardMultiplier = 1 + ((floor - 1) * 0.20);

      const isBossFloor = floor >= 5 && rand(1, 100) <= 15;

      if (isBossFloor) {
        let bossTemplate = allBots.find(b => b.id.includes('boss') || b.name.toLowerCase().includes('босс')) || allBots[0];
        const bossStr = Math.floor(Number(bossTemplate.strength || 5) * statMultiplier * 1.5);
        const bossAgi = Math.floor(Number(bossTemplate.agility || 5) * statMultiplier * 1.5);
        const bossEnd = Math.floor(Number(bossTemplate.endurance || 5) * statMultiplier * 2.0);
        const bossLuck = Math.floor(Number(bossTemplate.luck || 5) * statMultiplier * 1.5);

        // Прописываем endurance и на верхний уровень, и внутрь stats для db_helper и калькулятора боя
        const virtualBossForHp = { endurance: bossEnd, stats: { endurance: bossEnd }, equipped: {} };
        const bossMaxHp = getServerMaxHp(virtualBossForHp) * 2;

        teamB.push({
          uuid: `bot_tower_boss_${bossTemplate.id}_${Date.now()}`, id: bossTemplate.id,
          name: `👑 ${bossTemplate.name} [БОСС]`, icon: "👹", isBot: true,
          level: floor, 
          strength: bossStr, agility: bossAgi, endurance: bossEnd, luck: bossLuck,
          stats: { strength: bossStr, agility: bossAgi, endurance: bossEnd, luck: bossLuck },
          currentHp: bossMaxHp, maxHp: bossMaxHp,
          rewardXp: Math.floor(Number(bossTemplate.reward_xp || 20) * rewardMultiplier * 2),
          rewardGold: Math.floor(Number(bossTemplate.reward_gold || 10) * rewardMultiplier * 2),
          turn: null
        });
      } else {
        let maxSpawnCount = 2;
        if (floor >= 4) maxSpawnCount = 3;
        if (floor >= 7) maxSpawnCount = 4;
        if (floor >= 10) maxSpawnCount = 5;
        
        const finalSpawnCount = rand(1, maxSpawnCount);
        const regularPool = allBots.filter(b => !b.id.includes('boss') && !b.name.toLowerCase().includes('босс'));

        for (let i = 0; i < finalSpawnCount; i++) {
          const baseBot = regularPool[rand(0, regularPool.length - 1)] || allBots[0];
          const botStr = Math.floor(Number(baseBot.strength || 4) * statMultiplier);
          const botAgi = Math.floor(Number(baseBot.agility || 4) * statMultiplier);
          const botEnd = Math.floor(Number(baseBot.endurance || 4) * statMultiplier);
          const botLuck = Math.floor(Number(baseBot.luck || 4) * statMultiplier);

          const virtualBotForHp = { endurance: botEnd, stats: { endurance: botEnd }, equipped: {} };
          const botMaxHp = getServerMaxHp(virtualBotForHp);

          teamB.push({
            uuid: `bot_tower_floor_${floor}_slot_${i}_${Date.now()}`, id: baseBot.id,
            name: `${baseBot.name} #${i + 1}`, icon: baseBot.icon, isBot: true,
            level: floor, 
            strength: botStr, agility: botAgi, endurance: botEnd, luck: botLuck,
            stats: { strength: botStr, agility: botAgi, endurance: botEnd, luck: botLuck },
            currentHp: botMaxHp, maxHp: botMaxHp,
            rewardXp: Math.floor(Number(baseBot.reward_xp || 10) * rewardMultiplier),
            rewardGold: Math.floor(Number(baseBot.reward_gold || 5) * rewardMultiplier),
            turn: null
          });
        }
      }

      activeRooms[roomId] = { id: roomId, type: 'pve', isTower: true, towerFloor: floor, teamA, teamB, turnCount: 1, timeoutRef: null };
      socket.join(roomId);
      
      const sanitizeTeamLocal = (team) => team.map(f => ({
        uuid: f.uuid, name: f.name, icon: f.icon, level: f.level,
        currentHp: f.currentHp, maxHp: f.maxHp, isBot: f.isBot,
        hasSubmitted: !!f.turn, equipped: f.equipped || null 
      }));

      socket.emit('battle_init_data', {
        roomId, turnCount: 1, myUuid: `player_${dbPlayer.id}`,
        teamA: sanitizeTeamLocal(teamA), teamB: sanitizeTeamLocal(teamB)
      });

      if (teamA[0].currentHp <= 0) {
        if (global.executeRoundCalculations) global.executeRoundCalculations(roomId, activeRooms, io);
        return;
      }

      // 🔥 ЖЕСТКИЙ ФИКС РЕДИРЕКТА: Отправляем лично в сокет и дублируем во всю комнату,
      // чтобы корень города (telegram_supabase.js) гарантированно поймал переход!
      socket.emit('arena_redirect_to_battle', { roomId: roomId });
      io.to(roomId).emit('arena_redirect_to_battle', { roomId: roomId });

      console.log(`🚀 [БАШНЯ СТАРТ] Редирект в комнату ${roomId} успешно отправлен в сеть.`);

      if (global.startServerTurnTimer) global.startServerTurnTimer(roomId, activeRooms, io);

    } catch (err) { socket.emit('error', `Ошибка Башни: ${err.message}`); }
  });
};