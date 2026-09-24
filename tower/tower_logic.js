// ============================================================================
// ===== 🏰 ПРОЦЕДУРНОЕ СЕРВЕРНОЕ ЯДРО БАШНИ И ЛАВКИ (TOWER/TOWER_LOGIC.JS) =====
// ============================================================================

const dbHelper = require('../db_helper');
const { TOWER_SHOP_DATABASE } = require('./tower_config');

module.exports = function(io, socket, sb, activeRooms) {
  if (!socket) return;

  const getServerMaxHp = dbHelper.getServerMaxHp;
  const triggerLoadGameSuccess = dbHelper.triggerLoadGameSuccess;
// 🔥 [НОВОЕ] ОБРАБОТЧИК: ОТДАЧА СТАТУСА КУЛДАУНА ИЗ ТАБЛИЦЫ ТАЙМЕРОВ С СЕРВЕРА
  socket.on('check_tower_cooldown_request', async ({ userId }) => {
    try {
      const nUserId = Number(userId);
      
      const { data: timerRow } = await sb.from('player_timers')
        .select('ends_at')
        .eq('user_id', nUserId)
        .eq('timer_type', 'tower_cooldown')
        .maybeSingle();

      if (timerRow && new Date(timerRow.ends_at) > new Date()) {
        // Если КД найдено и оно еще тикает — шлем точное время клиенту
        socket.emit('tower_cooldown_status', { active: true, ends_at: timerRow.ends_at });
      } else {
        // Если КД нет или оно уже истекло — обнуляем бан на фронтенде
        socket.emit('tower_cooldown_status', { active: false });
      }
    } catch (err) {
      console.error("🚨 Ошибка проверки КД в Башне:", err.message);
    }
  });
  // --- 🏰 ОБРАБОТЧИК А: СТАРТ PvP/PvE ЭТАЖА И ПРОВЕРКА ТАЙМЕРА ---
  socket.on('start_tower_battle_secure', async ({ userId, currentFloor }) => {
    try {
      const nUserId = Number(userId);
      const floor = Math.max(1, Number(currentFloor || 1));

      await sb.from('arena_lobby').delete().eq('id', nUserId);
      io.emit('arena_lobby_updated');

      // 🕒 1. ЧЕСТНАЯ ПРОВЕРКА КУЛДАУНА ИЗ ТВОЕЙ НОВОЙ ТАБЛИЦЫ ТАЙМЕРОВ
      const { data: timerRow } = await sb.from('player_timers')
        .select('ends_at')
        .eq('user_id', nUserId)
        .eq('timer_type', 'tower_cooldown')
        .maybeSingle();

      if (timerRow) {
        const cooldownDate = new Date(timerRow.ends_at);
        const now = new Date();

        if (cooldownDate > now) {
          const timeLeftMs = cooldownDate - now;
          const leftHours = Math.floor(timeLeftMs / (1000 * 60 * 60));
          const leftMinutes = Math.ceil((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));
          
          let timeText = `${leftMinutes} мин.`;
          if (leftHours > 0) timeText = `${leftHours} ч. ${leftMinutes} мин.`;

          return socket.emit('error', `🏰 Башня закрыта! Доступ через: ${timeText}`);
        }
      }

      // 2. Загружаем данные игрока и пула ботов из Supabase
      const { data: dbPlayer } = await sb.from('players').select('*').eq('id', nUserId).single();
      const { data: allBots, error: botsErr } = await sb.from('bots')
        .select('*')
        .eq('category', 'tower'); // Жесткий античит-фильтр группы спавна

      if (!dbPlayer || botsErr || !allBots || allBots.length === 0) {
        return socket.emit('error', 'В базе данных Supabase не найдены шаблоны монстров с категорией "tower".');
      }

      if (!dbPlayer || botsErr || !allBots || allBots.length === 0) {
        return socket.emit('error', 'Ошибка загрузки данных Башни.');
      }

      const roomId = `room_tower_${dbPlayer.id}_floor_${floor}_${Date.now()}`;
      const pMaxHp = getServerMaxHp(dbPlayer);

      const teamA = [{
        uuid: `player_${dbPlayer.id}`, id: String(dbPlayer.id), name: dbPlayer.name, icon: '👤', isBot: false,
        level: Number(dbPlayer.level), strength: Number(dbPlayer.strength), agility: Number(dbPlayer.agility), endurance: Number(dbPlayer.endurance), luck: Number(dbPlayer.luck),
        currentHp: Math.min(Number(dbPlayer.hp), pMaxHp), maxHp: pMaxHp, socketId: socket.id, turn: null,
        gold: Number(dbPlayer.gold), xp: Number(dbPlayer.xp), statpoints: Number(dbPlayer.statpoints),
        equipped: dbPlayer.equipped || {}, inventory: dbPlayer.inventory || {}, afkTurns: 0 
      }];

      const teamB = [];
      const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
      const statMultiplier = 1 + ((floor - 1) * 0.15);
      const rewardMultiplier = 1 + ((floor - 1) * 0.20);

      // Рассчитываем Босса (С 5-го этажа, шанс 15%)
      const isBossFloor = floor >= 5 && rand(1, 100) <= 15;

      if (isBossFloor) {
        let bossTemplate = allBots.find(b => b.id.includes('boss') || b.name.toLowerCase().includes('босс')) || allBots[0];
        const bossStr = Math.floor(Number(bossTemplate.strength || 5) * statMultiplier * 1.5);
        const bossAgi = Math.floor(Number(bossTemplate.agility || 5) * statMultiplier * 1.5);
        const bossEnd = Math.floor(Number(bossTemplate.endurance || 5) * statMultiplier * 2.0);
        const bossLuck = Math.floor(Number(bossTemplate.luck || 5) * statMultiplier * 1.5);

        // 🔥 [ИСПРАВЛЕНО] Упаковываем статы во вложенный объект stats, чтобы db_helper не падал!
        const virtualBossForHp = { 
          stats: { endurance: bossEnd }, 
          equipped: {} 
        };
        const bossMaxHp = getServerMaxHp(virtualBossForHp) * 2;

        teamB.push({
          uuid: `bot_tower_boss_${bossTemplate.id}_${Date.now()}`, id: bossTemplate.id,
          name: `👑 ${bossTemplate.name} [БОСС]`, icon: "👹", isBot: true,
          level: floor, strength: bossStr, agility: bossAgi, endurance: bossEnd, luck: bossLuck,
          currentHp: bossMaxHp, maxHp: bossMaxHp,
          rewardXp: Math.floor(Number(bossTemplate.reward_xp || 20) * rewardMultiplier * 2),
          rewardGold: Math.floor(Number(bossTemplate.reward_gold || 10) * rewardMultiplier * 2),
          turn: null
        });
      } else {
        // Рандомный пак обычных мобов (Танк, Уворот, Крит) до 5 штук
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

          // 🔥 [ИСПРАВЛЕНО] Упаковываем статы во вложенный объект stats, чтобы db_helper не падал!
          const virtualBotForHp = { 
            stats: { endurance: botEnd }, 
            equipped: {} 
          };
          const botMaxHp = getServerMaxHp(virtualBotForHp);

          teamB.push({
            uuid: `bot_tower_floor_${floor}_slot_${i}_${Date.now()}`, id: baseBot.id,
            name: `${baseBot.name} #${i + 1}`, icon: baseBot.icon, isBot: true,
            level: floor, strength: botStr, agility: botAgi, endurance: botEnd, luck: botLuck,
            currentHp: botMaxHp, maxHp: botMaxHp,
            rewardXp: Math.floor(Number(baseBot.reward_xp || 10) * rewardMultiplier),
            rewardGold: Math.floor(Number(baseBot.reward_gold || 5) * rewardMultiplier),
            turn: null
          });
        }
      }

      activeRooms[roomId] = { id: roomId, type: 'pve', isTower: true, towerFloor: floor, teamA, teamB, turnCount: 1, timeoutRef: null };

      socket.join(roomId);
      socket.emit('battle_init_data', {
        roomId, turnCount: 1, myUuid: `player_${dbPlayer.id}`,
        teamA: teamA.map(f => ({ uuid: f.uuid, name: f.name, icon: f.icon, level: f.level, currentHp: f.currentHp, maxHp: f.maxHp, isBot: f.isBot, hasSubmitted: !!f.turn, equipped: f.equipped || null })), 
        teamB: teamB.map(f => ({ uuid: f.uuid, name: f.name, icon: f.icon, level: f.level, currentHp: f.currentHp, maxHp: f.maxHp, isBot: f.isBot, hasSubmitted: !!f.turn, equipped: f.equipped || null }))
      });

      if (teamA.currentHp <= 0) {
        if (global.executeRoundCalculations) global.executeRoundCalculations(roomId, activeRooms, io);
        return;
      }
      if (global.startServerTurnTimer) global.startServerTurnTimer(roomId, activeRooms, io);

    } catch (err) { socket.emit('error', `Ошибка Башни: ${err.message}`); }
  });

  // --- ОБРАБОТЧИК Б: ЛАВКА БАШНИ ---
  socket.on('buy_tower_shop_item_secure', async ({ userId, itemId }) => {
    try {
      const nUserId = Number(userId);
      const itemConfig = TOWER_SHOP_DATABASE[itemId];
      if (!itemConfig) return socket.emit('tower_shop_error', { message: "🚨 Предмет отсутствует в лавке Башни!" });

      const { data: playerRow, error: dbError } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      if (dbError || !playerRow) return socket.emit('tower_shop_error', { message: "❌ Ошибка загрузки данных." });

      const currentGold = Number(playerRow.gold ?? 0);
      if (currentGold < itemConfig.price) return socket.emit('tower_shop_error', { message: "❌ Недостаточно золота!" });

      let inventory = playerRow.inventory || { equipment: [], consumables: [], resources: [] };
      if (!inventory.equipment) inventory.equipment = [];
      if (!inventory.consumables) inventory.consumables = [];

      if (itemConfig.type === 'consumable') {
        const existing = inventory.consumables.find(c => c.id === itemId);
        if (existing) existing.count = (existing.count || 1) + 1;
        else inventory.consumables.push({ id: itemId, count: 1 });
      } else {
        if (inventory.equipment.length >= 30) return socket.emit('tower_shop_error', { message: "🎒 Сумка переполнена!" });
        inventory.equipment.push({ uuid: `${itemId}_tower_${Date.now()}_${Math.floor(Math.random() * 1000)}`, id: itemId });
      }

      const updatedGold = currentGold - itemConfig.price;
      await sb.from('players').update({ gold: Number(updatedGold), inventory: inventory }).eq('id', nUserId);

      await triggerLoadGameSuccess(nUserId, socket, sb);
      socket.emit('tower_shop_success', { message: "🎉 Успешно куплено в лавке Башни!" });

    } catch (err) { socket.emit('tower_shop_error', { message: `🚨 Ошибка: ${err.message}` }); }
  });
};