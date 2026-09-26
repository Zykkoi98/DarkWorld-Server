const towerFinisher = require('./tower/tower_battle_finisher');
const dbHelper = require('./db_helper');
const GAME_ITEMS_DATABASE = require('./shop/shop_items_config'); 

const ZONE_NAMES = { head: "Голову", breast: "Грудь", torso: "Торс", belt: "Пояс", legs: "Ноги" };

// 🔥 ИСПОЛЬЗУЕМ ЦЕНТРАЛИЗОВАННЫЕ ФУНКЦИИ ИЗ DB_HELPER
const getEquipmentBonus = dbHelper.getEquipmentBonus;
const findItemInAnyDatabase = dbHelper.findItemInAnyDatabase;
const autoRefillPotionsAfterBattle = dbHelper.autoRefillPotionsAfterBattle;

// 🔥 УМНАЯ ПРОВЕРКА ЩИТА — ТЕПЕРЬ РАБОТАЕТ ЧЕРЕЗ БАЗУ ДАННЫХ
function isShield(itemId) {
  if (!itemId) return false;
  
  const itemData = findItemInAnyDatabase(itemId);
  
  if (itemData) {
    // Если у предмета указан slotType = 'offHand' и в названии есть "щит" — это точно щит
    const name = (itemData.name || '').toLowerCase();
    const slotType = (itemData.slotType || '').toLowerCase();
    
    // Явный признак щита по названию
    if (name.includes('щит') || name.includes('баклер') || name.includes('эгида') || 
        name.includes('скутум') || name.includes('бастион') || name.includes('зеркало мастера') ||
        name.includes('оберег') || name.includes('стена') || name.includes('торч') ||
        name.includes('гвардейский') || name.includes('сетчатый') || name.includes('плетеный')) {
      return true;
    }
    
    // Проверяем slotType
    if (slotType === 'shield') return true;
  }
  
  // Подстраховка по системному ID
  const id = itemId.toLowerCase();
  return id.includes('shield') || id.includes('buckler') || id.includes('aegis') || 
         id.includes('screen') || id.includes('mirror') || id.includes('wall') ||
         id.includes('scutum') || id.includes('bastion') || id.includes('parry');
}

// Честный серверный расчет боевых параметров персонажей
function getServerAtk(fighter) {
  const rawStrength = fighter.strength ?? (fighter.stats && fighter.stats.strength) ?? 1;
  const totalStrength = Number(rawStrength) + getEquipmentBonus(fighter.equipped, 'strength');
  const baseAtk = Math.floor(2 + (totalStrength * 1.5));
  return baseAtk + getEquipmentBonus(fighter.equipped, 'atk');
}

function getServerDef(fighter) {
  const rawEndurance = fighter.endurance ?? (fighter.stats && fighter.stats.endurance) ?? 1;
  const baseEndurance = Number(rawEndurance);
  const gearEndurance = getEquipmentBonus(fighter.equipped, 'endurance');
  return Math.floor((baseEndurance + gearEndurance) * 0.5) + getEquipmentBonus(fighter.equipped, 'def');
}

function getServerAgility(fighter) {
  const rawAgi = fighter.agility ?? (fighter.stats && fighter.stats.agility) ?? 1;
  return Number(rawAgi) + getEquipmentBonus(fighter.equipped, 'agility');
}

function getServerLuck(fighter) {
  const rawLuck = fighter.luck ?? (fighter.stats && fighter.stats.luck) ?? 1;
  return Number(rawLuck) + getEquipmentBonus(fighter.equipped, 'luck');
}

function sanitizeTeam(team) {
  return team.map(f => ({
    uuid: f.uuid, name: f.name, icon: f.icon, level: f.level,
    currentHp: f.currentHp, maxHp: f.maxHp, isBot: f.isBot,
    hasSubmitted: !!f.turn, equipped: f.equipped || null,
    afkTurns: f.afkTurns || 0  // 🔥 Передаём счётчик АФК на клиент
  }));
}

// Главный экспорт модуля боевой логики
module.exports = function(io, socket, sb, activeRooms) {
  
  const triggerLoadGameSuccess = dbHelper.triggerLoadGameSuccess;
  const getServerMaxHp = dbHelper.getServerMaxHp;
  const getServerCorrectLevelByXp = dbHelper.getServerCorrectLevelByXp;

  // --- 1. ОБРАБОТЧИК: ЗАПРОС СПИСКА ДУЭЛЕЙ НА АРЕНЕ ---
  socket.on('arena_get_lobby', async () => {
    try {
      const nowISO = new Date().toISOString();
      const { data, error } = await sb.from('arena_lobby').select('*').gt('arena_expires_at', nowISO);
      if (!error && data) socket.emit('arena_lobby_data', data);
    } catch (e) { console.error(e); }
  });

  // --- 2. ОБРАБОТЧИК: ПУБЛИКАЦИЯ СВОЕГО ВЫЗОВА В ЛОББИ ---
  socket.on('arena_create_request', async ({ playerData, currentHp }) => {
    try {
      const expiresAt = new Date(Date.now() + 180000).toISOString();
      const { error } = await sb.from('arena_lobby').upsert({
        id: Number(playerData.id),
        name: playerData.name,
        level: Number(playerData.level || 1),
        hp: Number(currentHp),
        arena_expires_at: expiresAt
      });
      if (!error) io.emit('arena_lobby_updated');
    } catch (e) { console.error(e); }
  });

  // --- 3. ОБРАБОТЧИК: ОТМЕНА СВОЕГО ВЫЗОВА В ЛОББИ ---
  socket.on('arena_cancel_request', async ({ userId }) => {
    try {
      const { error } = await sb.from('arena_lobby').delete().eq('id', Number(userId));
      if (!error) io.emit('arena_lobby_updated');
    } catch (e) { console.error(e); }
  });

  // --- 4. ОБРАБОТЧИК: ПРИНЯТИЕ ЧУЖОГО PvP ВЫЗОВА ---
  socket.on('arena_accept_challenge_request', async ({ myId, opponentId, playerData, currentHp }) => {
    try {
      const nMyId = Number(myId);
      const nOpponentId = Number(opponentId);

      const { data, error } = await sb.from('arena_lobby').delete().eq('id', nOpponentId).select();
      if (error || !data || data.length === 0) {
        return socket.emit('error', 'Вызов уже принят другим гладиатором!');
      }

      await sb.from('arena_lobby').delete().eq('id', nMyId);

      const roomId = `room_pvp_${opponentId}_vs_${myId}_${Date.now()}`;
      
const { data: oppData, error: oppErr } = await sb.from('players').select('*').eq('id', nOpponentId).maybeSingle();
      if (oppErr || !oppData) {
        return socket.emit('error', 'Не удалось загрузить профиль соперника.');
      }

      // 🔥 [ФИКС ПОТЕРИ РЕДИРЕКТА] Проверяем, что сокет противника жив
      // Если он отключён — всё равно создаём бой, но отправляем событие в общий канал,
      // чтобы игрок поймал его при возврате в игру через check_active_battle
      
      // Собираем список активных сокетов в комнате io
      const socketsInRoom = io.sockets.adapter.rooms;
      
      // Находим живой сокет противника по его userId (если он ещё онлайн)
      let opponentSocketId = null;
      for (const [socketId, sock] of io.sockets.sockets) {
        // В твоём server.js сокет не хранит userId, но мы можем искать по player
        // Простейший способ: проверить, есть ли у сокета свойство с нашим userId
        if (sock.data && String(sock.data.userId) === String(nOpponentId)) {
          opponentSocketId = socketId;
          break;
        }
      }

      // Если нашли живой сокет — отправим событие адресно
      if (opponentSocketId) {
        io.to(opponentSocketId).emit('arena_redirect_to_battle', { roomId });
        console.log(`📡 [PvP ФИКС] Адресный редирект отправлен в сокет ${opponentSocketId}`);
      } else {
        // Игрок оффлайн или на другой странице — используем глобальную рассылку
        // Он поймает через global_battle_watch.js или check_active_battle
        console.log(`⚠️ [PvP ФИКС] Сокет соперника не найден в io. Рассылаем глобально.`);
        io.emit('arena_redirect_to_battle', { roomId });
      }

      initiatePvpMatch(roomId, playerData, currentHp, oppData, activeRooms, io);
    } catch (e) { 
      console.error(e); 
    }
  });

  // --- 5. ОБРАБОТЧИКИ РЕКОННЕКТОВ ---
  socket.on('check_active_battle_directly', ({ userId }, callback) => {
    const sUserId = String(userId);
    const activeRoomId = Object.keys(activeRooms).find(roomId => 
      activeRooms[roomId].teamA.some(f => String(f.id) === sUserId) ||
      activeRooms[roomId].teamB.some(f => String(f.id) === sUserId)
    );
    callback({ activeRoomId: activeRoomId || null });
  });

  socket.on('reconnect_to_battle', async ({ roomId, userId }) => {
    try {
      const room = activeRooms[roomId];
      if (!room) return socket.emit('error', 'Бой уже завершился.');

      const sUserId = String(userId);
      const nUserId = Number(userId);
      const pFighter = [...room.teamA, ...room.teamB].find(f => String(f.id) === sUserId);

      if (pFighter) {
        pFighter.socketId = socket.id;
        socket.join(roomId);
         if (pFighter.afkTurns > 0) {
          console.log(`🔄 [АФК РЕКОННЕКТ] ${pFighter.name} вернулся с ${pFighter.afkTurns} АФК. Даём шанс.`);
          // Не сбрасываем сразу — пусть сделает ход
        }

        // 🔥 [АНТИЧИТ-ПЕРЕХВАТ ПРИ F5] — используем централизованную функцию
        const { data: cloudPlayer } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
        
        if (cloudPlayer) {
          const wasAnythingUnequipped = dbHelper.enforceEquipmentRequirements(cloudPlayer);
          
          if (wasAnythingUnequipped) {
            await sb.from('players').update({ 
              equipped: cloudPlayer.equipped, 
              inventory: cloudPlayer.inventory 
            }).eq('id', nUserId);
            
            pFighter.equipped = cloudPlayer.equipped;
            pFighter.inventory = cloudPlayer.inventory;
            pFighter.strength = Number(cloudPlayer.strength || 1);
            pFighter.agility = Number(cloudPlayer.agility || 1);
            pFighter.endurance = Number(cloudPlayer.endurance || 1);
            pFighter.luck = Number(cloudPlayer.luck || 1);
            
            console.log(`✨ [АНТИЧИТ F5 УСПЕХ] Кукла бойца ${pFighter.name} зачищена.`);
          }
        }

        socket.emit('battle_init_data', {
          roomId: roomId, turnCount: room.turnCount, myUuid: pFighter.uuid,
          teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB)
        });

        const isTeamADead = room.teamA.every(f => f.currentHp <= 0);
        const isTeamBDead = room.teamB.every(f => f.currentHp <= 0);
        if (isTeamADead || isTeamBDead) {
          console.log(`🏁 [СОКЕТНЫЙ ЭКСПРЕСС-ФИНАЛ] Закрываем матч.`);
          setTimeout(() => { executeRoundCalculations(roomId, activeRooms, io); }, 300);
        }
      }
    } catch (err) {
      console.error("🚨 Сбой античита при реконнекте:", err.message);
    }
  });

  socket.on('check_active_battle', ({ userId }) => {
    const sUserId = String(userId);
    const activeRoomId = Object.keys(activeRooms).find(roomId => 
      activeRooms[roomId].teamA.some(f => String(f.id) === sUserId) ||
      activeRooms[roomId].teamB.some(f => String(f.id) === sUserId)
    );
    if (activeRoomId) socket.emit('arena_redirect_to_battle', { roomId: activeRoomId });
  });

  // 🔥 СЕРВЕРНЫЙ ОБРАБОТЧИК: ОТДАЧА ТОЧНЫХ ХАРАКТЕРИСТИК ДЛЯ ПОПОВЕРА
  socket.on('get_fighter_exact_stats', ({ roomId, targetUuid }, callback) => {
    try {
      const room = activeRooms[roomId];
      if (!room) return callback({ error: "Комната боя не найдена" });

      const fighter = [...room.teamA, ...room.teamB].find(f => f.uuid === targetUuid);
      if (!fighter) return callback({ error: "Боец не найден в ОЗУ" });

      const totalStr = getServerAtk ? (Number(fighter.strength ?? (fighter.stats && fighter.stats.strength) ?? 1) + getEquipmentBonus(fighter.equipped, 'strength')) : 1;
      const totalAgi = getServerAgility(fighter);
      const totalEnd = Number(fighter.endurance ?? (fighter.stats && fighter.stats.endurance) ?? 1) + getEquipmentBonus(fighter.equipped, 'endurance');
      const totalLuck = getServerLuck(fighter);

      const mfInv = (totalAgi * 10) + getEquipmentBonus(fighter.equipped, 'mf_inv');
      const mfAntiInv = (totalAgi * 4) + getEquipmentBonus(fighter.equipped, 'mf_antiinv');
      const mfCrit = (totalLuck * 10) + getEquipmentBonus(fighter.equipped, 'mf_crit');
      const mfAntiCrit = (totalLuck * 4) + getEquipmentBonus(fighter.equipped, 'mf_anticrit');

      callback({
        success: true,
        stats: [
          { label: '💪 Сила', value: totalStr },
          { label: '🏹 Ловкость', value: totalAgi },
          { label: '🛡️ Выносливость', value: totalEnd },
          { label: '🍀 Удача', value: totalLuck },
          { label: '🏹 Мф. Уворота', value: `+${mfInv}%` },
          { label: '🎯 Мф. Антиуворота', value: `+${mfAntiInv}%` },
          { label: '💥 Мф. Крита', value: `+${mfCrit}%` },
          { label: '🛡️ Мф. Антикрита', value: `+${mfAntiCrit}%` }
        ]
      });
    } catch (err) {
      console.error("🚨 Ошибка при сборке статов для поповера:", err.message);
      callback({ error: "Внутренняя ошибка сервера" });
    }
  });

  // --- 6. ОБРАБОТЧИК: ЗАПУСК PvE БОЯ ---
  socket.on('search_pve_match', async ({ playerData, monsterKey, count }) => {
    try {
      const sPlayerId = String(playerData.id);
      const nPlayerId = Number(playerData.id);

      // Анти-спам кулдаун леса
      const { data: forestTimer } = await sb.from('player_timers')
        .select('ends_at')
        .eq('user_id', nPlayerId)
        .eq('timer_type', 'forest_cooldown')
        .maybeSingle();

      if (forestTimer && new Date(forestTimer.ends_at) > new Date()) {
        const msLeft = new Date(forestTimer.ends_at) - new Date();
        const minLeft = Math.ceil(msLeft / 60000);
        return socket.emit('error', `🌲 Лес восстанавливается после похода! Доступ через: ${minLeft} мин.`);
      }

      await sb.from('arena_lobby').delete().eq('id', nPlayerId);
      io.emit('arena_lobby_updated');

      const existingRoomId = Object.keys(activeRooms).find(rId => 
        activeRooms[rId].teamA.some(fighter => fighter.id === sPlayerId)
      );

      if (existingRoomId) {
        const existingRoom = activeRooms[existingRoomId];
        const pFighter = existingRoom.teamA.find(fighter => fighter.id === sPlayerId);
        if (pFighter) pFighter.socketId = socket.id;
        socket.join(existingRoomId);
        return socket.emit('battle_init_data', {
          roomId: existingRoomId, turnCount: existingRoom.turnCount,
          myUuid: pFighter ? pFighter.uuid : `player_${sPlayerId}`,
          teamA: sanitizeTeam(existingRoom.teamA), teamB: sanitizeTeam(existingRoom.teamB)
        });
      }

      const monsterCount = Math.min(5, Math.max(1, Number(count || 1)));
      const { data: dbMonster } = await sb.from('bots').select('*').eq('id', monsterKey).maybeSingle();
      const { data: dbPlayer } = await sb.from('players').select('*').eq('id', nPlayerId).single();

      if (!dbMonster || !dbPlayer) return socket.emit('error', 'Ошибка инициализации данных PvE.');

      // Обновляем таймер леса на 1 минуту
      await sb.from('player_timers')
        .delete()
        .eq('user_id', nPlayerId)
        .eq('timer_type', 'forest_cooldown');

      const cooldownTime = new Date(Date.now() + 1 * 60 * 1000); 
      
      await sb.from('player_timers').insert({
        user_id: nPlayerId,
        timer_type: 'forest_cooldown',
        ends_at: cooldownTime.toISOString()
      });
      console.log(`🌲 [БД ТАЙМЕР] Игрок ID ${nPlayerId} в лесу. КД до ${cooldownTime.toISOString()}`);

      const roomId = `room_pve_${dbPlayer.id}_${Date.now()}`;
      const pMaxHp = getServerMaxHp(dbPlayer);

      const teamA = [{
        uuid: `player_${dbPlayer.id}`, id: String(dbPlayer.id), name: dbPlayer.name, icon: '👤', isBot: false,
        level: Number(dbPlayer.level), 
        strength: Number(dbPlayer.strength), agility: Number(dbPlayer.agility), 
        endurance: Number(dbPlayer.endurance), luck: Number(dbPlayer.luck),
        currentHp: Math.min(Number(dbPlayer.hp), pMaxHp), maxHp: pMaxHp, socketId: socket.id, turn: null,
        gold: Number(dbPlayer.gold), xp: Number(dbPlayer.xp), statpoints: Number(dbPlayer.statpoints),
        equipped: dbPlayer.equipped || {}, inventory: dbPlayer.inventory || {}, afkTurns: 0 
      }];

      const teamB = [];
      const mMaxHp = getServerMaxHp(dbMonster);
      for (let i = 0; i < monsterCount; i++) {
        teamB.push({
          uuid: `bot_${dbMonster.id}_${i}_${Date.now()}`, id: dbMonster.id,
          name: monsterCount > 1 ? `${dbMonster.name} #${i + 1}` : dbMonster.name, icon: dbMonster.icon,
          isBot: true, level: Number(dbMonster.level), 
          strength: Number(dbMonster.strength),
          agility: Number(dbMonster.agility), endurance: Number(dbMonster.endurance),
          luck: Number(dbMonster.luck), currentHp: mMaxHp, maxHp: mMaxHp, 
          rewardXp: Number(dbMonster.reward_xp),
          rewardGold: Number(dbMonster.reward_gold), turn: null
        });
      }

      activeRooms[roomId] = { id: roomId, type: 'pve', teamA, teamB, turnCount: 1, timeoutRef: null };
      socket.join(roomId);
      
      socket.emit('battle_init_data', {
        roomId, turnCount: 1, myUuid: `player_${dbPlayer.id}`,
        teamA: sanitizeTeam(teamA), teamB: sanitizeTeam(teamB)
      });

      const startCheckTeamA = teamA.every(f => f.currentHp <= 0);
      const startCheckTeamB = teamB.every(f => f.currentHp <= 0);

      if (startCheckTeamA || startCheckTeamB) {
        console.log(`🏁 [PvE ЭКСПРЕСС-ФИНАЛ] Вход с 0 HP. Мгновенное завершение.`);
        setTimeout(() => {
          executeRoundCalculations(roomId, activeRooms, io);
        }, 200);
        return;
      }

      startServerTurnTimer(roomId, activeRooms, io);

    } catch (err) {
      socket.emit('error', `Внутренняя ошибка: ${err.message}`);
    }
  });

  // --- 7. ОБРАБОТЧИК: ПРИЕМ ХОДА ---
  socket.on('submit_turn', ({ roomId, targetUuid, attack, defends }) => {
    const room = activeRooms[roomId];
    if (!room) {
      console.log(`⚠️ [ХОД ОТКЛОНЕН] Комната ${roomId} не найдена.`);
      return;
    }

    if (room.isCalculating || room.isOver) {
      console.log(`🚫 [СЕРВЕРНЫЙ ПЕРЕХВАТ СПАМА] Игнорируем дубликат хода.`);
      return;
    }

    const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
    if (!fighter) return;
    if (fighter.currentHp <= 0) return;
    if (fighter.turn) return;

    // 🛡️ АНТИЧИТ: проверка лимитов атак/блоков
    let serverMaxAttacks = 1;
    let serverMaxDefends = 1;

    if (fighter.equipped) {
      const mainHand = fighter.equipped.mainHand;
      const offHand = fighter.equipped.offHand;

      const mainItemData = findItemInAnyDatabase(mainHand);
      const isTwoHanded = (mainHand && mainHand.includes('twoHanded')) || 
                          (mainItemData && mainItemData.slotType === 'twoHanded') || 
                          (mainHand === 'heavy_halberd');

      if (isTwoHanded) {
        serverMaxAttacks = 1;
      } else if (offHand && !isShield(offHand)) {
        serverMaxAttacks = 2;
      } else {
        serverMaxAttacks = 1;
      }

      if (offHand && isShield(offHand)) {
        serverMaxDefends = 3;
      } else if (Number(fighter.level || 1) <= 1) {
        serverMaxDefends = 2;
      }
    } else {
      serverMaxDefends = (Number(fighter.level || 1) <= 1) ? 2 : 1;
    }

    let checkedDefends = Array.isArray(defends) ? defends.filter(z => typeof z === 'string') : [];
    let checkedAttack = attack;

    if (checkedDefends.length > serverMaxDefends) {
      console.warn(`🚨 [АНТИЧИТ] ${fighter.name}: блоков ${checkedDefends.length} > ${serverMaxDefends}`);
      checkedDefends = checkedDefends.slice(0, serverMaxDefends);
    }

    if (serverMaxAttacks === 1 && Array.isArray(checkedAttack)) {
      console.warn(`🚨 [АНТИЧИТ] ${fighter.name}: массив атак без двуручника.`);
      checkedAttack = checkedAttack[0] || "torso";
    } 
    else if (serverMaxAttacks === 2 && Array.isArray(checkedAttack) && checkedAttack.length > 2) {
      checkedAttack = checkedAttack.slice(0, 2);
    }

    fighter.turn = { 
      targetUuid: String(targetUuid), 
      attack: checkedAttack, 
      defends: checkedDefends 
    };
    fighter.afkTurns = 0; 

    console.log(`📥 [ХОД] ${fighter.name} | Удар: ${Array.isArray(checkedAttack) ? checkedAttack.join(', ') : checkedAttack} | Блок: [${checkedDefends.join(', ')}]`);

    let canExecuteRound = false;

    if (room.type === 'pve') {
      const awaitingPvE = room.teamA.filter(p => !p.isBot && p.currentHp > 0 && !p.turn);
      if (awaitingPvE.length === 0) canExecuteRound = true;
    } 
    else if (room.type === 'pvp') {
      const playerA = room.teamA[0];
      const playerB = room.teamB[0];
      
      if (playerA && playerB) {
        const isReadyA = (playerA.currentHp <= 0 || playerA.turn !== null);
        const isReadyB = (playerB.currentHp <= 0 || playerB.turn !== null);
        if (isReadyA && isReadyB) canExecuteRound = true;
      }
    }

    if (canExecuteRound) {
      console.log(`🔔 [УДАР В КОЛОКОЛ] Запускаем executeRoundCalculations...`);
      clearTimeout(room.timeoutRef);
      room.isCalculating = true; 
      executeRoundCalculations(roomId, activeRooms, io); 
    }
  });

  // --- 8. ОБРАБОТЧИК: ИСПОЛЬЗОВАНИЕ ЗЕЛИЙ В БОЮ ---
  socket.on('instant_use_potion', async ({ roomId }) => {
    try {
      const room = activeRooms[roomId];
      if (!room) return;

      const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
      if (!fighter || fighter.currentHp <= 0) return;

      const potionSlot = fighter.equipped?.potion;

      if (potionSlot && typeof potionSlot === 'object' && potionSlot.id && potionSlot.count > 0) {
        const itemConfig = findItemInAnyDatabase(potionSlot.id);
        
        let healAmount = 25;
        let potionName = "Зелье HP";
        
        if (itemConfig) {
          potionName = itemConfig.name || "Зелье HP";
          healAmount = itemConfig.heal || itemConfig.bonus?.heal || itemConfig.bonus?.stats?.heal || 0;
        }
        
        if (!healAmount) {
          if (potionSlot.id === 'hp_potion_small') { healAmount = 25; potionName = "Малое зелье HP"; }
          if (potionSlot.id === 'hp_potion_big') { healAmount = 60; potionName = "Большое зелье HP"; }
          if (potionSlot.id === 'fish_soup') { healAmount = 40; potionName = "Уха из таверны"; }
        }

        fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + healAmount);
        potionSlot.count--;
        let displayCountLog = potionSlot.count;

        if (potionSlot.count <= 0) fighter.equipped.potion = null;

        io.to(roomId).emit('battle_effect_potion', {
          uuid: fighter.uuid, 
          currentHp: fighter.currentHp, 
          equipped: fighter.equipped, 
          logMsg: `🧪 <strong>${fighter.name}</strong> выпил ${potionName} (+${healAmount} HP)! Осталось: ${displayCountLog} шт.`
        });

        await sb.from('players').update({ hp: fighter.currentHp, equipped: fighter.equipped }).eq('id', Number(fighter.id));
      }
    } catch (err) {
      console.error("🚨 Ошибка применения банки в бою:", err.message);
    }
  });

  // --- 9. ВНУТРЕННЯЯ ФУНКЦИЯ: СБОРКА PvP КОМНАТЫ ---
  function initiatePvpMatch(roomId, playerData, p1Hp, p2Data, activeRooms, io) {
    const p1Stats = {
      strength: Number(playerData.strength ?? playerData.stats?.strength ?? 1),
      agility: Number(playerData.agility ?? playerData.stats?.agility ?? 1),
      endurance: Number(playerData.endurance ?? playerData.stats?.endurance ?? 1),
      luck: Number(playerData.luck ?? playerData.stats?.luck ?? 1),
      equipped: playerData.equipped || {}
    };

    const p2Stats = {
      strength: Number(p2Data.strength ?? p2Data.stats?.strength ?? 1),
      agility: Number(p2Data.agility ?? p2Data.stats?.agility ?? 1),
      endurance: Number(p2Data.endurance ?? p2Data.stats?.endurance ?? 1),
      luck: Number(p2Data.luck ?? p2Data.stats?.luck ?? 1),
      equipped: p2Data.equipped || {}
    };

    // 🔥 ИСПРАВЛЕНО: передаем корректные объекты с equipped для расчета HP
    const p1MaxHp = getServerMaxHp({ endurance: p1Stats.endurance, equipped: p1Stats.equipped });
    const p2MaxHp = getServerMaxHp({ endurance: p2Stats.endurance, equipped: p2Stats.equipped });

    console.log(`🔎 [ИНСПЕКЦИЯ АРЕНЫ] Создатель: Lv.${playerData.level} | Оппонент: Lv.${p2Data.level}`);

    const teamA = [{
      uuid: `player_${playerData.id}`, id: String(playerData.id), name: playerData.name, icon: '👤', isBot: false,
      level: Number(playerData.level ?? 1), 
      strength: p1Stats.strength, agility: p1Stats.agility,
      endurance: p1Stats.endurance, luck: p1Stats.luck,
      currentHp: Math.min(Number(p1Hp || p1MaxHp), p1MaxHp), maxHp: p1MaxHp, socketId: null, turn: null,
      equipped: playerData.equipped || {}, inventory: playerData.inventory || {}, afkTurns: 0
    }];

    const teamB = [{
      uuid: `player_${p2Data.id}`, id: String(p2Data.id), name: p2Data.name, icon: '👤', isBot: false, 
      level: Number(p2Data.level ?? 1), 
      strength: p2Stats.strength, agility: p2Stats.agility,
      endurance: p2Stats.endurance, luck: p2Stats.luck,
      currentHp: Math.min(Number(p2Data.hp || p2MaxHp), p2MaxHp), maxHp: p2MaxHp, socketId: null, turn: null,
      equipped: p2Data.equipped || {}, inventory: p2Data.inventory || {}, afkTurns: 0
    }];

    activeRooms[roomId] = { id: roomId, type: 'pvp', teamA, teamB, turnCount: 1, timeoutRef: null };
    console.log(`⚔️ [PvP ЗАПУСК] Комната: ${roomId} для ${playerData.name} vs ${p2Data.name}`);
    
    // 🔥 [ФИКС ПОТЕРИ РЕДИРЕКТА] Отправляем редирект и глобально, и адресно
    setTimeout(() => {
      io.emit('arena_lobby_updated');
      
      // Глобальный редирект (поймают все, кто на связи через global_battle_watch.js)
      io.emit('arena_redirect_to_battle', { roomId: roomId });
      
      // Плюс шлём в комнату отдельно (для тех, кто уже перешёл)
      io.to(roomId).emit('arena_redirect_to_battle', { roomId: roomId });
      
      console.log(`📡 [PvP РЕДИРЕКТ] Событие отправлено глобально для комнаты ${roomId}`);
    }, 150);

    const startCheckTeamA = teamA.every(f => f.currentHp <= 0);
    const startCheckTeamB = teamB.every(f => f.currentHp <= 0);

    if (startCheckTeamA || startCheckTeamB) {
      console.log(`🏁 [PvP ЭКСПРЕСС-ФИНАЛ] Вход с 0 HP.`);
      setTimeout(() => {
        executeRoundCalculations(roomId, activeRooms, io);
      }, 300);
      return;
    }

    startServerTurnTimer(roomId, activeRooms, io);
  }

  // --- 10. ВНУТРЕННЯЯ ФУНКЦИЯ: ТАЙМЕР АФК С ДИНАМИЧЕСКИМ ВРЕМЕНЕМ ---
function startServerTurnTimer(roomId, activeRooms, io) {
  const room = activeRooms[roomId];
  if (!room) return;
  if (room.timeoutRef) clearTimeout(room.timeoutRef);

  // 🔥 ДИНАМИЧЕСКИЙ ТАЙМЕР: считаем максимальный afkTurns среди живых игроков
  const aliveHumans = [...room.teamA, ...room.teamB]
    .filter(f => !f.isBot && f.currentHp > 0);
  
  const maxAfkInRoom = aliveHumans.reduce((max, f) => Math.max(max, f.afkTurns || 0), 0);
  
  let turnDurationMs = 60000; // 60 сек по умолчанию
  
  if (maxAfkInRoom === 1) {
    turnDurationMs = 30000; // После первого АФК — 30 сек
    console.log(`⏱️ [ДИНАМ. ТАЙМЕР] Штрафное время 30 сек (1 АФК)`);
  } else if (maxAfkInRoom === 2) {
    turnDurationMs = 15000; // После второго АФК — 15 сек
    console.log(`⏱️ [ДИНАМ. ТАЙМЕР] Штрафное время 15 сек (2 АФК)`);
  }
  
  // Отправляем клиентам информацию о длительности
  io.to(roomId).emit('turn_timer_started', { 
    durationMs: turnDurationMs,
    round: room.turnCount
  });

  room.timeoutRef = setTimeout(() => {
    if (!activeRooms[roomId]) return;
    
    console.log(`⏱️ [АФК ТРИГГЕР] Время (${turnDurationMs / 1000}с) вышло в комнате ${roomId}.`);
    const allFighters = [...room.teamA, ...room.teamB];
    
    allFighters.forEach(f => {
      if (!f.isBot && f.currentHp > 0) {
        if (!f.turn) {
          // 🎯 Игрок пропустил ход — увеличиваем счётчик
          f.afkTurns = (f.afkTurns || 0) + 1;
          f.missedLastTurn = true; // 🔥 Флаг для лога
          
          const opposingTeam = room.teamA.includes(f) ? room.teamB : room.teamA;
          const aliveEnemies = opposingTeam.filter(e => e.currentHp > 0);
          
          // 🎯 АФК-игрок бьёт СЛУЧАЙНО, а не пустышкой — чтобы бой шёл быстрее
          const zones = ["head", "breast", "torso", "belt", "legs"];
          const randomDefends = [];
          const defendsCount = (f.level <= 1) ? 2 : 1;
          while (randomDefends.length < defendsCount) {
            const z = zones[Math.floor(Math.random() * zones.length)];
            if (!randomDefends.includes(z)) randomDefends.push(z);
          }
          
          f.turn = { 
            targetUuid: aliveEnemies.length > 0 ? aliveEnemies[0].uuid : null, 
            attack: zones[Math.floor(Math.random() * zones.length)], // 🎯 случайный удар
            defends: randomDefends,
            isAfkAutoMove: true // 🔥 Флаг, что ход сгенерирован АФК-системой
          };
          
          console.log(`💤 [АФК] ${f.name} пропустил ход (всего пропусков: ${f.afkTurns})`);
        } else {
          // Игрок сделал ход — сбрасываем АФК-счётчик
          if (f.afkTurns > 0) {
            console.log(`✅ [АФК СБРОС] ${f.name} снова активен, счётчик сброшен`);
          }
          f.afkTurns = 0;
          f.missedLastTurn = false;
        }
      }
    });
    
    executeRoundCalculations(roomId, activeRooms, io);
  }, turnDurationMs); 
}
  // --- 11. ГЛАВНАЯ ФУНКЦИЯ РАСЧЕТА РАУНДА ---
  async function executeRoundCalculations(roomId, activeRooms, io) {
    const room = activeRooms[roomId];
    if (!room) return;

    const logs = [];
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

     // Проверка АФК дисквалификации
    const allHumanFighters = [...room.teamA, ...room.teamB].filter(f => !f.isBot && f.currentHp > 0);
    let afkDisqualifiedFighter = allHumanFighters.find(f => (f.afkTurns || 0) >= 3);

    if (afkDisqualifiedFighter) {
      logs.push(`🛑 Гладиатор <strong>${afkDisqualifiedFighter.name}</strong> застыл слишком долго. Техническое поражение.`);
      afkDisqualifiedFighter.currentHp = 0;

      const isTeamADead = room.teamA.every(f => f.currentHp <= 0);
      const isTeamBDead = room.teamB.every(f => f.currentHp <= 0);
      let result = 'draw';
      if (!isTeamADead && isTeamBDead) result = 'win';
      if (isTeamADead && !isTeamBDead) result = 'lose';

      if (room.type === 'pve') {
        if (room.isTower) {
          towerFinisher.finalizeTowerBattleSecure(room, result, sb);
        } else {
          finalizePveBattle(room, result, logs, room.turnCount, io);
        }
      }
      else if (room.type === 'pvp') {
        finalizePvpBattle(room, result, logs, room.turnCount, io);
      }
      return;
    }
        // 🔥 НОВОЕ: логируем пропуски ходов игроками (для понимания игроком)
    allHumanFighters.forEach(f => {
      if (f.missedLastTurn && f.afkTurns > 0) {
        const remaining = 3 - f.afkTurns;
        if (remaining > 0) {
          logs.push(`💤 <strong>${f.name}</strong> пропустил ход. Осталось предупреждений: ${remaining}.`);
        }
      }
    });
    // Расчет ИИ монстров PvE
    if (room.type === 'pve') {
      room.teamB.forEach(bot => {
        if (bot.currentHp <= 0 || !bot.isBot) return;
        const aliveTargets = room.teamA.filter(a => a.currentHp > 0);
        if (aliveTargets.length === 0) return;

        const targetFighter = aliveTargets[rand(0, aliveTargets.length - 1)];
        const zones = ["head", "breast", "torso", "belt", "legs"];
        
        const bAgi = Number(bot.agility || 1);
        const bLuck = Number(bot.luck || 1);
        const bEnd = Number(bot.endurance || 1);

        let botMaxAttacks = 1;
        let botMaxDefends = 2;

        if (bEnd > bAgi && bEnd > bLuck) {
          botMaxAttacks = 1;
          botMaxDefends = 3;
        } 
        else if (bAgi > bEnd || bLuck > bEnd) {
          botMaxAttacks = 2;
          botMaxDefends = 2;
        }

        const mDefend = [];
        while (mDefend.length < botMaxDefends) {
          const rz = zones[rand(0, zones.length - 1)];
          if (!mDefend.includes(rz)) mDefend.push(rz);
        }

        let botAttackPayload = null;
        if (botMaxAttacks === 2) {
          const firstHit = zones[rand(0, zones.length - 1)];
          const secondHit = zones[rand(0, zones.length - 1)];
          botAttackPayload = [firstHit, secondHit];
          console.log(`🤖⚔️ [ИИ ДУАЛЫ] ${bot.name} бьет 2 раза: [${firstHit}, ${secondHit}]`);
        } else {
          botAttackPayload = zones[rand(0, zones.length - 1)];
        }

        bot.turn = { 
          targetUuid: targetFighter.uuid, 
          attack: botAttackPayload, 
          defends: mDefend 
        };
      });
    }

    // Сортировка очереди ходов
    let queue = [...room.teamA, ...room.teamB];
    const aliveAtStart = queue.filter(f => f.currentHp > 0).map(f => f.uuid);

    queue.forEach(attacker => {
      if (!aliveAtStart.includes(attacker.uuid) || !attacker.turn || !attacker.turn.targetUuid) return;

      let target = [...room.teamA, ...room.teamB].find(f => f.uuid === attacker.turn.targetUuid);
      if (!target) {
        const opposingTeam = room.teamA.includes(attacker) ? room.teamB : room.teamA;
        const newAlive = opposingTeam.filter(t => t && t.currentHp > 0);
        if (newAlive.length === 0) return;
        target = newAlive[0];
      }

      if (attacker.uuid === target.uuid) return;

      let attacksList = [];

      if (attacker.isBot) {
        attacksList = Array.isArray(attacker.turn.attack) ? attacker.turn.attack : [attacker.turn.attack];
      } else {
        const mainWeapon = attacker.equipped?.mainHand;
        const offWeapon = attacker.equipped?.offHand;

        if (mainWeapon && (mainWeapon.includes('twoHanded') || mainWeapon === 'heavy_halberd')) {
          attacksList = Array.isArray(attacker.turn.attack) ? attacker.turn.attack : [attacker.turn.attack];
        } else if (offWeapon && !isShield(offWeapon)) {
          const primaryAttackZone = Array.isArray(attacker.turn.attack) ? attacker.turn.attack[0] : attacker.turn.attack;
          const zones = ["head", "breast", "torso", "belt", "legs"];
          const leftHandZone = zones[Math.floor(Math.random() * zones.length)];
          
          attacksList = [primaryAttackZone, leftHandZone]; 
          console.log(`⚔️⚔️ [ДУАЛЫ] ${attacker.name}: Правая ${primaryAttackZone}, Левая ${leftHandZone}`);
        } else {
          const singleZone = Array.isArray(attacker.turn.attack) ? attacker.turn.attack[0] : attacker.turn.attack;
          attacksList = [singleZone];
        }
      }

      const targetDefends = (target.turn && Array.isArray(target.turn.defends)) ? target.turn.defends : [];
        
      attacksList.forEach(currentAttackZone => {
        if (currentAttackZone === null) return;

        // Проверка блока
        if (targetDefends.includes(currentAttackZone)) {
          logs.push(`🛡️ <strong>${target.name}</strong> заблокировал удар от <strong>${attacker.name}</strong> в ${ZONE_NAMES[currentAttackZone]}.`);
          return;
        }

        // БК: Уворот
        const targetAgi = getServerAgility(target);
        const attackerAgi = getServerAgility(attacker);
        
        const targetMfInv = (targetAgi * 10) + getEquipmentBonus(target.equipped, 'mf_inv');
        const attackerMfAntiInv = (attackerAgi * 4) + getEquipmentBonus(attacker.equipped, 'mf_antiinv');

        let finalEvadeChance = 5 + (targetAgi - attackerAgi) * 1 + Math.floor((targetMfInv - attackerMfAntiInv) / 10);
        const evadeChance = Math.min(70, Math.max(5, finalEvadeChance));

        if (rand(1, 100) <= evadeChance) {
          logs.push(`🏹 <strong>${target.name}</strong> увернулся от удара <strong>${attacker.name}</strong> в ${ZONE_NAMES[currentAttackZone]}!`);
          return;
        }

        // БК: Крит
        const attackerLuck = getServerLuck(attacker);
        const targetLuck = getServerLuck(target);
        
        const attackerMfCrit = (attackerLuck * 10) + getEquipmentBonus(attacker.equipped, 'mf_crit');
        const targetMfAntiCrit = (targetLuck * 4) + getEquipmentBonus(target.equipped, 'mf_anticrit');

        let finalCritChance = 10 + (attackerLuck - targetLuck) * 2 + Math.floor((attackerMfCrit - targetMfAntiCrit) / 10);
        const criticalChance = Math.min(65, Math.max(5, finalCritChance));
        const isCrit = rand(1, 100) <= criticalChance;

        let dmgFactor = (attacksList.length === 2) ? 1.3 : 1.0;
        let dmg = Math.floor(getServerAtk(attacker) / dmgFactor);
        
        if (isCrit) dmg = Math.floor(dmg * 2.0);

        dmg = Math.max(1, dmg - getServerDef(target)); 
        target.currentHp = Math.max(0, Number(target.currentHp || 0) - dmg);
        
        logs.push(`⚔️ <strong>${attacker.name}</strong> нанес <strong>${target.name}</strong> <strong>${dmg}</strong> урона в ${ZONE_NAMES[currentAttackZone]} ${isCrit ? '💥 КРИТ!' : ''}`);
      });
    });

    room.teamA.forEach(f => { 
      f.turn = null; 
      f.missedLastTurn = false; // 🔥 Сбрасываем флаг пропуска после логирования
    });
    room.teamB.forEach(f => { 
      f.turn = null; 
      f.missedLastTurn = false; // 🔥 Сбрасываем флаг пропуска после логирования
    });
    console.log(`⚔️ [МАТЕМАТИКА РАУНДА ЗАВЕРШЕНА]`);

    const isTeamADead = room.teamA.every(f => f.currentHp <= 0);
    const isTeamBDead = room.teamB.every(f => f.currentHp <= 0);
    const currentRound = room.turnCount;
    room.turnCount++;

    if (isTeamADead || isTeamBDead || room.turnCount > 1000) {
      let result = 'draw';
      if (!isTeamADead && isTeamBDead) result = 'win';  
      if (isTeamADead && !isTeamBDead) result = 'lose'; 

      console.log(`🏁 [ФИНАЛ МАТЧА] Тип: ${room.type}. Результат TeamA: ${result}`);

      // PvE тексты
      if (room.type === 'pve' && !room.isTower) {
        const player = room.teamA[0];
        if (player && result === 'win') {
          let gainedXp = 0;
          let gainedGold = 0;
          room.teamB.forEach(m => {
            gainedXp += Number(m.rewardXp || 0);
            gainedGold += Number(m.rewardGold || 0);
          });

          const oldLevel = Number(player.level || 1);
          const correctLevel = dbHelper.getServerCorrectLevelByXp(player.xp + gainedXp);

          if (correctLevel > oldLevel) {
            logs.push(`🎉 <strong>УРОВЕНЬ ПОВЫШЕН!</strong> Вы достигли ${correctLevel} уровня!`);
          }
          logs.push(`🏁 <strong>ПОБЕДА!</strong> Награда: 💰 ${gainedGold} монет, ✨ ${gainedXp} опыта.`);
        } else if (player && result === 'lose') {
          logs.push(`🏁 <strong>ВАС ОДОЛЕЛИ...</strong> Воскрешение в городе.`);
        }
      }

      // Башня
      if (room.isTower) {
        console.log(`🏰 [ДИСПЕТЧЕР БАШНИ] Расчет наград...`);
        await towerFinisher.finalizeTowerBattleSecure(room, result, sb);
        
        const currentFloorLvl = Number(room.towerFloor || 1);
        
        if (result === 'win') {
          const txp = Number(room.gainedXpLocal || (5 + (currentFloorLvl * 3)));
          const tgold = Number(room.gainedGoldLocal || 0);
          const tcoins = Number(room.gainedCoinsLocal || 0);

          let rewardText = `🏁 <strong>ПОБЕДА В БАШНЕ!</strong> Этаж ${currentFloorLvl}. Награда: ✨ +${txp} опыта`;
          if (tgold > 0) rewardText += `, 💰 +${tgold} золота`;
          if (tcoins > 0) rewardText += `, 🪙 +${tcoins} монет Башни`;
          rewardText += `.`;
          
          logs.push(rewardText);
        } else {
          logs.push(`🏁 <strong>ВАС ОДОЛЕЛИ...</strong> Башня сброшена на 1 этаж. КД 3 часа.`);
        }
      }

      // PvP
      if (room.type === 'pvp') {
        const playerA = room.teamA[0];
        const playerB = room.teamB[0];
        const goldReward = 25;
        const calculatePvpXpLog = (winnerLvl, loserLvl) => {
          let baseXp = Number(loserLvl || 1) * 15;
          let multiplier = 1;
          if (loserLvl > winnerLvl) multiplier = 1 + ((loserLvl - winnerLvl) * 0.25);
          else if (loserLvl < winnerLvl) multiplier = Math.max(0.1, 1 - ((winnerLvl - loserLvl) * 0.20));
          return Math.floor(baseXp * multiplier);
        };

        if (result === 'win' && playerA && playerB) {
          const xpGained = calculatePvpXpLog(playerA.level, playerB.level);
          logs.push(`🏁 <strong>ПОБЕДА НА АРЕНЕ!</strong> ${playerA.name} поверг соперника! Награда: 💰 ${goldReward} монет, ✨ ${xpGained} опыта.`);
        } else if (result === 'lose' && playerA && playerB) {
          const xpGained = calculatePvpXpLog(playerB.level, playerA.level);
          logs.push(`🏁 <strong>ПОБЕДА НА АРЕНЕ!</strong> ${playerB.name} одержал верх! Награда: 💰 ${goldReward} монет, ✨ ${xpGained} опыта.`);
        } else {
          logs.push(`🏁 <strong>НИЧЬЯ НА АРЕНЕ!</strong> Силы равны. Награды аннулированы.`);
        }
      }

      // Отправка результатов
      if (room.type === 'pvp') {
        const playerA = room.teamA[0];
        const playerB = room.teamB[0];
        if (playerA && playerA.socketId) {
          io.to(playerA.socketId).emit('round_result', { 
            turnCount: currentRound, logs: logs, isOver: true, resultType: result,
            teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB) 
          });
        }
        if (playerB && playerB.socketId) {
          const resB = (result === 'win') ? 'lose' : (result === 'lose' ? 'win' : 'draw');
          io.to(playerB.socketId).emit('round_result', { 
            turnCount: currentRound, logs: logs, isOver: true, resultType: resB,
            teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB) 
          });
        }
      } else {
        io.to(roomId).emit('round_result', { 
          turnCount: currentRound, 
          logs: logs,
          isOver: true, 
          resultType: result,
          isTower: !!room.isTower,
          teamA: sanitizeTeam(room.teamA), 
          teamB: sanitizeTeam(room.teamB) 
        });
      }

      // Финишеры Supabase
      if (!room.isTower) {
        if (room.type === 'pve') {
          finalizePveBattle(room, result, logs, currentRound, io);
        } else if (room.type === 'pvp') {
          finalizePvpBattle(room, result, logs, currentRound, io);
        }
      }

      setTimeout(() => {
        delete activeRooms[room.id];
        console.log(`🗑️ [ОЗУ] Комната ${room.id} выгружена.`);
      }, 1200);
      
    } else {
      [...room.teamA, ...room.teamB].forEach(p => {
        if (p.socketId) {
          io.to(p.socketId).emit('round_result', { 
            turnCount: currentRound, logs: logs, isOver: false, 
            teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB) 
          });
        }
      });
      room.isCalculating = false;
      startServerTurnTimer(roomId, activeRooms, io);
    }
  }

  // --- 12. ФИНАЛИЗАЦИЯ PvE ---
  async function finalizePveBattle(room, result, logs, finalRound, io) {
    try {
      const player = (room && room.teamA && Array.isArray(room.teamA)) ? room.teamA[0] : (room ? room.teamA : null);
      if (!player) {
        console.error("🚨 [КРИТ] finalizePveBattle: Объект игрока не найден!");
        return;
      }

      let gainedXp = 0; 
      let gainedGold = 0;
      let dbHpPayload = Number(player.currentHp || 0);
      autoRefillPotionsAfterBattle(player);

      if (result === 'win') {
        if (room.teamB && Array.isArray(room.teamB)) {
          room.teamB.forEach(m => { 
            gainedXp += Number(m.rewardXp || 0); 
            gainedGold += Number(m.rewardGold || 0); 
          });
        }
        player.gold = Number(player.gold || 0) + gainedGold;
        player.xp = Number(player.xp || 0) + gainedXp;
        
        const oldLevel = Number(player.level || 1);
        const correctLevel = dbHelper.getServerCorrectLevelByXp(player.xp);
        
        if (correctLevel > oldLevel) {
          const levelsGained = correctLevel - oldLevel;
          player.statpoints = Number(player.statpoints || player.statPoints || 0) + (levelsGained * 5);
          player.level = correctLevel;
          player.currentHp = dbHelper.getServerMaxHp(player);
        }
        dbHpPayload = player.currentHp;
      } else {
        player.currentHp = 0;
        dbHpPayload = Math.max(1, Math.floor(dbHelper.getServerMaxHp(player) * 0.2));
      }

      let pointsKey = (player.statpoints !== undefined) ? 'statpoints' : 'statPoints';

      console.log(`📡 [БД PvE] Отправка наград для ID: ${player.id}...`);
      
      const { error } = await sb.from('players').update({ 
        gold: Number(player.gold), 
        xp: Number(player.xp), 
        hp: Number(dbHpPayload), 
        level: Number(player.level), 
        inventory: player.inventory,
        equipped: player.equipped,
        [pointsKey]: Number(player.statpoints || player.statPoints || 0) 
      }).eq('id', Number(player.id));

      if (error) {
        console.error("🚨 [Supabase SQL Error]:", error.message);
      } else {
        console.log(`☁️ [БД PvE УСПЕХ] Награды для ${player.name} зафиксированы.`);
      }

    } catch (err) {
      console.error("❌ Фатальный сбой в finalizePveBattle:", err.message);
    }
  }

  // --- 13. ФИНАЛИЗАЦИЯ PvP ---
  async function finalizePvpBattle(room, result, logs, finalRound, io) {
    try {
      const playerA = room.teamA[0]; 
      const playerB = room.teamB[0]; 
      
      if (!playerA || !playerB) return;

      console.log(`\n🏁 [PvP ФИНАЛИЗАЦИЯ] Транзакция наград. Исход TeamA: ${result}`);

      const goldReward = 25; 

      const calculatePvpXp = (winnerLvl, loserLvl) => {
        let baseXp = Number(loserLvl || 1) * 15; 
        let multiplier = 1;
        if (loserLvl > winnerLvl) multiplier = 1 + ((loserLvl - winnerLvl) * 0.25);
        else if (loserLvl < winnerLvl) multiplier = Math.max(0.1, 1 - ((winnerLvl - loserLvl) * 0.20));
        return Math.floor(baseXp * multiplier);
      };

      const [resA, resB] = await Promise.all([
        sb.from('players').select('*').eq('id', Number(playerA.id)).maybeSingle(),
        sb.from('players').select('*').eq('id', Number(playerB.id)).maybeSingle()
      ]);

      if (!resA || !resB || !resA.data || !resB.data) {
        console.error("🚨 [КРИТ] Не удалось прочитать профили из БД!");
        return;
      }

      const rowA = resA.data;
      const rowB = resB.data;

      autoRefillPotionsAfterBattle(rowA);
      autoRefillPotionsAfterBattle(rowB);

      const safeRead = (row, field, def = 0) => {
        const low = field.toLowerCase();
        const up = field.toUpperCase();
        const cap = field.charAt(0).toUpperCase() + field.slice(1);
        return Number(row[low] ?? row[up] ?? row[cap] ?? row[field] ?? def);
      };

      let pointsKeyA = rowA.statpoints !== undefined ? 'statpoints' : 'statPoints';
      let pointsKeyB = rowB.statpoints !== undefined ? 'statpoints' : 'statPoints';

      let goldA = safeRead(rowA, 'gold', 0);
      let xpA = safeRead(rowA, 'xp', 0);
      let levelA = safeRead(rowA, 'level', 1);
      let statpointsA = safeRead(rowA, pointsKeyA, 0);

      let goldB = safeRead(rowB, 'gold', 0);
      let xpB = safeRead(rowB, 'xp', 0);
      let levelB = safeRead(rowB, 'level', 1);
      let statpointsB = safeRead(rowB, pointsKeyB, 0);

      const maxHpA = dbHelper.getServerMaxHp({ endurance: safeRead(rowA, 'endurance', 1), equipped: rowA.equipped || {} });
      const maxHpB = dbHelper.getServerMaxHp({ endurance: safeRead(rowB, 'endurance', 1), equipped: rowB.equipped || {} });

      let endHpA = maxHpA;
      let endHpB = maxHpB;

      if (result === 'win') {
        const pvpXp = calculatePvpXp(levelA, levelB);
        goldA += goldReward;
        xpA += pvpXp;

        const correctLevelA = dbHelper.getServerCorrectLevelByXp(xpA);
        if (correctLevelA > levelA) {
          statpointsA += (correctLevelA - levelA) * 5;
          levelA = correctLevelA;
        }

        endHpA = Math.max(1, Number(playerA.currentHp));
        endHpB = Math.max(1, Math.floor(maxHpB * 0.2)); 
      } 
      else if (result === 'lose') {
        const pvpXp = calculatePvpXp(levelB, levelA);
        goldB += goldReward;
        xpB += pvpXp;

        const correctLevelB = dbHelper.getServerCorrectLevelByXp(xpB);
        if (correctLevelB > levelB) {
          statpointsB += (correctLevelB - levelB) * 5;
          levelB = correctLevelB;
        }

        endHpA = Math.max(1, Math.floor(maxHpA * 0.2)); 
        endHpB = Math.max(1, Number(playerB.currentHp));
      } 
      else {
        endHpA = Math.max(1, Math.floor(maxHpA * 0.2));
        endHpB = Math.max(1, Math.floor(maxHpB * 0.2));
      }

      await Promise.all([
        sb.from('players').update({
          gold: Number(goldA), xp: Number(xpA), level: Number(levelA),
          inventory: rowA.inventory,
          equipped: rowA.equipped,
          [pointsKeyA]: Number(statpointsA), hp: Number(endHpA)
        }).eq('id', Number(playerA.id)),

        sb.from('players').update({
          gold: Number(goldB), xp: Number(xpB), level: Number(levelB),
          inventory: rowB.inventory,
          equipped: rowB.equipped,
          [pointsKeyB]: Number(statpointsB), hp: Number(endHpB)
        }).eq('id', Number(playerB.id))
      ]);

      console.log("☁️ [БД PvP УСПЕХ] Данные сохранены.");

    } catch (err) {
      console.error("❌ Фатальная ошибка транзакции PvP наград:", err.message);
    }
  }

};