// ============================================================================
// ===== 🔌 SOCKET-СЛОЙ БОЯ (BATTLE_HANDLERS.JS) — v2 (со зрителями) =====
// ============================================================================

const dbHelper = require('../db_helper');
const core = require('./battle_core');
const state = require('./battle_state');
const router = require('./battle_router');

// 🔥 Глобальный индекс: userId → roomId (для проверки «в бою ли игрок»)
if (!global.activeBattlesByUser) {
  global.activeBattlesByUser = new Map();
}

module.exports = function(io, socket, sb, activeRooms) {
  if (!socket) return;

  const getServerMaxHp = dbHelper.getServerMaxHp;

  // ==========================================================================
  // 1. СТАРТ БОЯ
  // ==========================================================================
  socket.on('battle_start', async ({ battleType, params = {}, playerData = {} }) => {
    try {
      // 🔥 PvP стартует через arena_logic, не через battle_start
      if (battleType === 'arena_pvp') {
        console.warn('⚠️ [battle_start] Попытка старта PvP через battle_start — игнорируем');
        return;
      }
      const config = router.getConfig(battleType);
      if (!config) return socket.emit('error', `Неизвестный тип боя: ${battleType}`);

      // Кулдаун
      if (config.cooldown) {
        const { data: timerRow } = await sb.from('player_timers')
          .select('ends_at')
          .eq('user_id', Number(playerData.id))
          .eq('timer_type', config.cooldown.type)
          .maybeSingle();

        if (timerRow && new Date(timerRow.ends_at) > new Date()) {
          const msLeft = new Date(timerRow.ends_at) - new Date();
          const minLeft = Math.ceil(msLeft / 60000);
          return socket.emit('error', `⏳ Кулдаун. Доступ через ${minLeft} мин.`);
        }
      }

        // 🔥 ЖЁСТКАЯ ПРОВЕРКА: сканируем ВСЕ активные комнаты
        const sUserId = String(playerData.id);
        const existingRoomIds = [];

        for (const roomId in activeRooms) {
        const room = activeRooms[roomId];
        if (!room || room.state === 'finished') continue;

        const hasPlayer = [...room.teamA, ...room.teamB].some(f => !f.isBot && String(f.id) === sUserId);
        if (hasPlayer) existingRoomIds.push(roomId);
        }

        if (existingRoomIds.length > 0) {
        console.warn(`🚨 [АНТИЧИТ] Игрок ${playerData.name} уже в ${existingRoomIds.length} комнатах: ${existingRoomIds.join(', ')}`);

        // 🔥 Удаляем ВСЕ старые комнаты (защита от параллельных боёв)
        existingRoomIds.forEach(roomId => {
            const room = activeRooms[roomId];
            room.state = 'finished';
            if (room.timeoutRef) clearTimeout(room.timeoutRef);
            delete activeRooms[roomId];
            console.log(`🧹 [ОЧИСТКА ДУБЛЯ] Комната ${roomId} удалена`);
        });

        // Очищаем индекс
        global.activeBattlesByUser.delete(sUserId);

        // НЕ блокируем — создаём новый бой
        }

      const { data: dbPlayer } = await sb.from('players')
        .select('*').eq('id', Number(playerData.id)).maybeSingle();

      if (!dbPlayer) return socket.emit('error', 'Игрок не найден');

      const teamA = router.buildPlayerTeam(playerData, dbPlayer);
      teamA[0].maxHp = getServerMaxHp(teamA[0]);
      teamA[0].currentHp = Math.min(teamA[0].currentHp, teamA[0].maxHp);
      teamA[0].socketId = socket.id;

    let teamB = [];

    // === БАШНЯ: свой спавн мобов ===
    if (battleType === 'tower') {
    const floor = Math.max(1, Number(params.currentFloor || 1));

    // Загрузка пула мобов башни
    const { data: allBots } = await sb.from('bots').select('*').eq('category', 'tower');
    if (!allBots || allBots.length === 0) {
        return socket.emit('error', 'Мобы Башни не найдены в БД');
    }

    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const statMultiplier = 1 + ((floor - 1) * 0.20);
    const rewardMultiplier = 1 + ((floor - 1) * 0.20);

    // Босс 15% с 5 этажа
    const isBossFloor = floor >= 5 && rand(1, 100) <= 15;

    if (isBossFloor) {
        let bossTemplate = allBots.find(b => b.id.includes('boss') || b.name.toLowerCase().includes('босс')) || allBots[0];

        const bossStr = Math.floor(Number(bossTemplate.strength || 5) * statMultiplier * 1.5);
        const bossAgi = Math.floor(Number(bossTemplate.agility || 5) * statMultiplier * 1.5);
        const bossEnd = Math.floor(Number(bossTemplate.endurance || 5) * statMultiplier * 2.0);
        const bossLuck = Math.floor(Number(bossTemplate.luck || 5) * statMultiplier * 1.5);

        teamB.push({
        uuid: `bot_tower_boss_${bossTemplate.id}_${Date.now()}`,
        id: bossTemplate.id,
        name: `👑 ${bossTemplate.name} [БОСС]`,
        icon: bossTemplate.icon || '👹',
        isBot: true,
        level: floor,
        strength: bossStr,
        agility: bossAgi,
        endurance: bossEnd,
        luck: bossLuck,
        currentHp: 0, maxHp: 0,   // заполним ниже
        rewardXp: Math.floor(Number(bossTemplate.reward_xp || 20) * rewardMultiplier * 2),
        rewardGold: Math.floor(Number(bossTemplate.reward_gold || 10) * rewardMultiplier * 2),
        turn: null, afkTurns: 0
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

        const bStr = Math.floor(Number(baseBot.strength || 4) * statMultiplier);
        const bAgi = Math.floor(Number(baseBot.agility || 4) * statMultiplier);
        const bEnd = Math.floor(Number(baseBot.endurance || 4) * statMultiplier);
        const bLuck = Math.floor(Number(baseBot.luck || 4) * statMultiplier);

        teamB.push({
            uuid: `bot_tower_floor_${floor}_slot_${i}_${Date.now()}`,
            id: baseBot.id,
            name: `${baseBot.name} #${i + 1}`,
            icon: baseBot.icon || '👹',
            isBot: true,
            level: floor,
            strength: bStr,
            agility: bAgi,
            endurance: bEnd,
            luck: bLuck,
            currentHp: 0, maxHp: 0,
            rewardXp: Math.floor(Number(baseBot.reward_xp || 10) * rewardMultiplier),
            rewardGold: Math.floor(Number(baseBot.reward_gold || 5) * rewardMultiplier),
            turn: null, afkTurns: 0
        });
        }
    }

    // Заполняем HP
    teamB.forEach(m => {
        m.maxHp = getServerMaxHp(m);
        m.currentHp = m.maxHp;
    });

    // Запоминаем этаж
    config.towerFloor = floor;
    }

    // === МИР: стандартный спавн ===
    else if (battleType === 'world') {
    const monsterIds = params.monsterIds || [];
    const { data: allBots } = await sb.from('bots')
        .select('*').in('id', monsterIds);

    if (!allBots || allBots.length === 0) {
        return socket.emit('error', 'Мобы не найдены');
    }

    teamB = router.buildMonsterTeam(allBots, config, {
        count: params.count || monsterIds.length
    });

    teamB.forEach(m => {
        m.maxHp = getServerMaxHp(m);
        m.currentHp = m.maxHp;
    });
    }

      const room = core.createRoom({
        battleType,
        teamA,
        teamB,
        config,
        params: { roomId: params.roomId }
      });

      activeRooms[room.id] = room;
      socket.join(room.id);

      // 🔥 Индекс userId → roomId
      teamA.forEach(f => {
        if (!f.isBot) global.activeBattlesByUser.set(String(f.id), room.id);
      });

      socket.emit('battle_init_data', {
        roomId: room.id,
        turnCount: 1,
        myUuid: teamA[0].uuid,
        teamA: state.serializeTeam(room.teamA),
        teamB: state.serializeTeam(room.teamB),
        isTower: battleType === 'tower',
        battleType,
        isSpectator: false,
        isOver: false,
        result: null
        });

      startTurnTimer(room, io);

      console.log(`🎬 [BATTLE START] ${battleType} | Комната: ${room.id} | Игрок: ${teamA[0].name}`);

    } catch (err) {
      console.error('🚨 [battle_start]', err.message);
      socket.emit('error', `Ошибка старта боя: ${err.message}`);
    }
  });

  // ==========================================================================
  // 2. ЗРИТЕЛЬ — ПОДКЛЮЧЕНИЕ
  // ==========================================================================
  socket.on('battle_spectate', ({ roomId }) => {
    try {
      const room = activeRooms[roomId];
      if (!room) return socket.emit('error', 'Бой не найден или завершён.');

      core.addSpectator(room, socket.id);
      socket.join(roomId);

      // Отправляем полное состояние + архив логов
      const battleState = core.getBattleState(room);

      socket.emit('battle_init_data', {
        roomId: room.id,
        turnCount: room.turnCount,
        myUuid: null,
        teamA: battleState.teamA,
        teamB: battleState.teamB,
        isTower: room.battleType === 'tower',
        battleType: room.battleType,
        isSpectator: true,
        allLogs: battleState.allLogs,
        spectatorCount: battleState.spectatorCount
      });

      // Оставшийся таймер
      if (room.timerEndsAt) {
        const remainingMs = Math.max(0, room.timerEndsAt - Date.now());
        if (remainingMs > 0) {
          socket.emit('turn_timer_started', {
            durationMs: remainingMs,
            totalDurationMs: room.timerDurationMs,
            round: room.turnCount
          });
        }
      }

      console.log(`👁️ [SPECTATE] Зритель ${socket.id} подключился к ${roomId} (всего: ${core.getSpectatorCount(room)})`);

    } catch (err) {
      console.error('🚨 [battle_spectate]', err.message);
    }
  });

  // ==========================================================================
  // 3. ЗРИТЕЛЬ — ВЫХОД
  // ==========================================================================
  socket.on('battle_spectator_leave', ({ roomId }) => {
    const room = activeRooms[roomId];
    if (!room) return;

    core.removeSpectator(room, socket.id);
    socket.leave(roomId);

    console.log(`👁️ [SPECTATE] Зритель ${socket.id} вышел из ${roomId} (осталось: ${core.getSpectatorCount(room)})`);
  });

  // ==========================================================================
  // 4. ПРИЁМ ХОДА
  // ==========================================================================
  socket.on('battle_submit_turn', ({ roomId, targetUuid, attack, defends }) => {
    const room = activeRooms[roomId];
    if (!room) return;

    const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
    if (!fighter) return;

    const result = core.submitTurn(room, fighter.uuid, { targetUuid, attack, defends });
    if (!result.ok) return;

    console.log(`📥 [ХОД] ${fighter.name}`);

    if (core.isReadyForRound(room)) {
      clearTimeout(room.timeoutRef);
      room.isCalculating = true;
      executeRoundAndBroadcast(room, io);
    }
  });

 // ==========================================================================
  // 5. БАНКА
  // ==========================================================================
  socket.on('battle_use_potion', async ({ roomId }) => {
    try {
      const room = activeRooms[roomId];
      if (!room) return;

      // 🔥 АНТИЧИТ: нельзя пить банку после завершения боя
      if (room.state !== 'active') {
        console.log(`🚫 [БАНКА] Бой завершён (state=${room.state}) — отклонено`);
        return;
      }

      const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
      if (!fighter || fighter.currentHp <= 0) return;

      const potionSlot = fighter.equipped?.potion;
      if (!potionSlot || typeof potionSlot !== 'object' || !potionSlot.id || potionSlot.count <= 0) return;

      const itemConfig = dbHelper.findItemInAnyDatabase(potionSlot.id);

      let healAmount = 25;
      let potionName = 'Зелье HP';

      if (itemConfig) {
        potionName = itemConfig.name || 'Зелье HP';
        healAmount = itemConfig.heal || itemConfig.bonus?.heal || 0;
      }

      if (!healAmount) {
        if (potionSlot.id === 'hp_potion_small') { healAmount = 25; potionName = 'Малое зелье HP'; }
        if (potionSlot.id === 'hp_potion_big') { healAmount = 60; potionName = 'Большое зелье HP'; }
        if (potionSlot.id === 'fish_soup') { healAmount = 40; potionName = 'Уха из таверны'; }
      }

      fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + healAmount);
      potionSlot.count--;
      const remaining = potionSlot.count;
      if (potionSlot.count <= 0) fighter.equipped.potion = null;

      io.to(roomId).emit('battle_effect_potion', {
        uuid: fighter.uuid,
        currentHp: fighter.currentHp,
        equipped: fighter.equipped,
        logMsg: `🧪 <strong>${fighter.name}</strong> выпил ${potionName} (+${healAmount} HP)! Осталось: ${remaining} шт.`
      });

      await sb.from('players').update({
        hp: fighter.currentHp,
        equipped: fighter.equipped
      }).eq('id', Number(fighter.id));

    } catch (err) {
      console.error('🚨 [battle_use_potion]', err.message);
    }
  });

  // ==========================================================================
  // 6. СТАТЫ ДЛЯ ПОПОВЕРОВ
  // ==========================================================================
  socket.on('battle_get_stats', ({ roomId, targetUuid }, callback) => {
    try {
      const room = activeRooms[roomId];
      if (!room) return callback({ error: 'Комната не найдена' });

      const fighter = state.getFighter(room, targetUuid);
      if (!fighter) return callback({ error: 'Боец не найден' });

      const engine = require('./battle_engine');

      // ===== БАЗОВЫЕ СТАТЫ (без шмота) =====
      const baseStr  = Number(fighter.strength  ?? fighter.stats?.strength  ?? 1);
      const baseAgi  = Number(fighter.agility   ?? fighter.stats?.agility   ?? 1);
      const baseEnd  = Number(fighter.endurance ?? fighter.stats?.endurance ?? 1);
      const baseLuck = Number(fighter.luck      ?? fighter.stats?.luck      ?? 1);

      // ===== БОНУСЫ ШМОТА =====
      const gearStr  = engine.getEquipmentBonus(fighter, 'strength');
      const gearAgi  = engine.getEquipmentBonus(fighter, 'agility');
      const gearEnd  = engine.getEquipmentBonus(fighter, 'endurance');
      const gearLuck = engine.getEquipmentBonus(fighter, 'luck');

      // ===== ИТОГОВЫЕ ПРОИЗВОДНЫЕ =====
      const atk = engine.getAtk(fighter);
      const def = engine.getDef(fighter);

      // ===== МОДИФИКАТОРЫ (сырые очки) =====
      const totalAgi  = baseAgi  + gearAgi;
      const totalLuck = baseLuck + gearLuck;

      const mfInv      = (totalAgi  * 10) + engine.getEquipmentBonus(fighter, 'mf_inv');
      const mfAntiInv  = (totalAgi  * 4)  + engine.getEquipmentBonus(fighter, 'mf_antiinv');
      const mfCrit     = (totalLuck * 10) + engine.getEquipmentBonus(fighter, 'mf_crit');
      const mfAntiCrit = (totalLuck * 4)  + engine.getEquipmentBonus(fighter, 'mf_anticrit');

      // ===== ФОРМАТ "база (+шмот)" =====
      const fmt = (base, gear) => gear > 0 ? `${base} (+${gear})` : `${base}`;

      callback({
        success: true,
        stats: [
          // --- Основные характеристики ---
          { label: '💪 Сила',          value: fmt(baseStr,  gearStr) },
          { label: '🏹 Ловкость',      value: fmt(baseAgi,  gearAgi) },
          { label: '🛡️ Выносливость',  value: fmt(baseEnd,  gearEnd) },
          { label: '🍀 Удача',         value: fmt(baseLuck, gearLuck) },

          // --- Боевые производные ---
          { label: '⚔️ Атака',   value: atk },
          { label: '🛡️ Защита',  value: def },

          // --- Модификаторы (сырые очки) ---
          { label: '🏹 Мф. Увертывания',     value: `+${mfInv}%` },
          { label: '🎯 Мф. Против уворота',  value: `+${mfAntiInv}%` },
          { label: '💥 Мф. Крита',           value: `+${mfCrit}%` },
          { label: '🛡️ Мф. Против крита',   value: `+${mfAntiCrit}%` }
        ]
      });
    } catch (err) {
      console.error('🚨 [battle_get_stats]', err.message);
      callback({ error: 'Внутренняя ошибка' });
    }
  });

  // ==========================================================================
  // 7. РЕКОННЕКТ
  // ==========================================================================
  socket.on('battle_reconnect', ({ roomId, userId }) => {
    const room = activeRooms[roomId];
    if (!room) return socket.emit('error', 'Бой уже завершился.');

    const sUserId = String(userId);
    const fighter = [...room.teamA, ...room.teamB].find(f => String(f.id) === sUserId);
    if (!fighter) return socket.emit('error', 'Вы не в этой комнате');

// 🔥 Различаем реальный реконнект и первое подключение
    const isFirstJoin = !fighter.socketId || fighter.socketId === socket.id;
    const wasDisconnected = !isFirstJoin && fighter.disconnectedAt != null;

    fighter.socketId = socket.id;
    fighter.disconnectedAt = null;
    socket.join(roomId);

    if (wasDisconnected) {
      console.log(`♻️ [BATTLE] ${fighter.name} реально переподключился — оповещаем`);
      io.to(roomId).emit('opponent_reconnected', { name: fighter.name });
    } else {
      console.log(`✅ [BATTLE] ${fighter.name} первый раз в комнате`);
    }

    socket.emit('battle_init_data', {
        roomId: room.id,
        turnCount: room.turnCount,
        myUuid: fighter.uuid,
        teamA: state.serializeTeam(room.teamA),
        teamB: state.serializeTeam(room.teamB),
        isTower: room.battleType === 'tower',
        battleType: room.battleType,
        isSpectator: false,
        allLogs: core.getAllLogs(room),
        // 🔥 NEW: сигнал, что бой уже завершён
        isOver: room.state === 'finished',
        result: room.result || null
    });

    if (room.timerEndsAt) {
      const remainingMs = Math.max(0, room.timerEndsAt - Date.now());
      if (remainingMs > 0) {
        socket.emit('turn_timer_started', {
          durationMs: remainingMs,
          totalDurationMs: room.timerDurationMs,
          round: room.turnCount
        });
      }
    }
  });

  // ==========================================================================
  // 8. ПРОВЕРКА АКТИВНОГО БОЯ
  // ==========================================================================
  socket.on('battle_check_active', ({ userId }, callback) => {
    const sUserId = String(userId);
    const roomId = global.activeBattlesByUser.get(sUserId);

    if (typeof callback === 'function') {
      callback({ activeRoomId: (roomId && activeRooms[roomId]) ? roomId : null });
    } else if (roomId && activeRooms[roomId]) {
      socket.emit('arena_redirect_to_battle', { roomId });
    }
  });

  // ==========================================================================
  // 9. ПРОВЕРКА «В БОЮ ЛИ ИГРОК» (для профиля)
  // ==========================================================================
  socket.on('check_player_battle', ({ userId }, callback) => {
    const sUserId = String(userId);
    const roomId = global.activeBattlesByUser.get(sUserId);
    const room = roomId ? activeRooms[roomId] : null;

    if (typeof callback === 'function') {
      callback({
        inBattle: !!room,
        roomId: room ? room.id : null,
        spectatorCount: room ? core.getSpectatorCount(room) : 0
      });
    }
  });

  // ==========================================================================
  // 10. РАСЧЁТ РАУНДА + BROADCAST (участникам + зрителям)
  // ==========================================================================
  async function executeRoundAndBroadcast(room, io) {
    const result = core.executeRound(room);

    // 🔥 Сохраняем логи раунда в архив
    core.addRoundLogs(room, result.turnCount, result.logs);

    result.logs.forEach(l => console.log(`  └─ ${l.replace(/<[^>]+>/g, '')}`));

    // Broadcast всем в комнате (участники + зрители)
    if (room.battleType === 'arena_pvp') {
      const playerA = room.teamA[0];
      const playerB = room.teamB[0];

      if (playerA?.socketId) {
        io.to(playerA.socketId).emit('battle_round_result', { ...result, resultType: result.result });
      }
      if (playerB?.socketId) {
        const resB = result.result === 'win' ? 'lose' : (result.result === 'lose' ? 'win' : 'draw');
        io.to(playerB.socketId).emit('battle_round_result', { ...result, resultType: resB });
      }

      // Зрителям PvP — нейтрально
      room.spectators.forEach(sid => {
        io.to(sid).emit('battle_round_result', { ...result, resultType: 'spectator' });
      });

    } else {
      // PvE — всем в комнате
      io.to(room.id).emit('battle_round_result', result);
    }

    if (result.isOver) {
      clearTimeout(room.timeoutRef);
      await finishBattle(room, result);
    } else {
      room.isCalculating = false;
      startTurnTimer(room, io);
    }
  }

  // ==========================================================================
  // 11. ФИНАЛИЗАЦИЯ
  // ==========================================================================
  async function finishBattle(room, result) {
    const config = room.config;
    const finisher = router.getFinisher(config.finisher);

    if (!finisher || typeof finisher.finalize !== 'function') {
      console.error(`🚨 [FINISH] Финализатор не найден: ${config.finisher}`);
      return;
    }

    try {
      const finalData = await finisher.finalize(room, result.result, sb);

      if (finalData.logs && finalData.logs.length > 0) {
        // Добавляем финальные логи в архив
        core.addRoundLogs(room, 'final', finalData.logs);
        io.to(room.id).emit('battle_final_logs', { logs: finalData.logs });
      }

      console.log(`🏁 [ФИНАЛ] ${room.battleType} | ${result.result} | Комната: ${room.id}`);

    } catch (err) {
      console.error('🚨 [finishBattle]', err.message);
    }

    // Удаляем из индекса
    [...room.teamA, ...room.teamB].forEach(f => {
      if (!f.isBot) global.activeBattlesByUser.delete(String(f.id));
    });

    // Очистка комнаты через паузу
    setTimeout(() => {
      core.destroyRoom(room);
      delete activeRooms[room.id];
      console.log(`🗑️ [ОЧИСТКА] Комната ${room.id} удалена`);
    }, 5000);
  }

  // ==========================================================================
  // 12. ТАЙМЕР ХОДА
  // ==========================================================================
  function startTurnTimer(room, io) {
    if (room.timeoutRef) clearTimeout(room.timeoutRef);

    const config = room.config;
    const timerCfg = config.turnTimer || {};

    const aliveHumans = [...room.teamA, ...room.teamB].filter(f => !f.isBot && f.currentHp > 0);
    const maxAfk = aliveHumans.reduce((max, f) => Math.max(max, f.afkTurns || 0), 0);

    let durationMs = timerCfg.baseMs || 60000;
    if (maxAfk === 1 && timerCfg.penaltyPerAfk?.[1]) durationMs = timerCfg.penaltyPerAfk[1];
    if (maxAfk >= 2 && timerCfg.penaltyPerAfk?.[2]) durationMs = timerCfg.penaltyPerAfk[2];

    room.timerStartedAt = Date.now();
    room.timerDurationMs = durationMs;
    room.timerEndsAt = Date.now() + durationMs;

    io.to(room.id).emit('turn_timer_started', {
      durationMs,
      round: room.turnCount
    });

    room.timeoutRef = setTimeout(() => {
      if (!activeRooms[room.id]) return;

      console.log(`⏱️ [АФК] Время вышло в комнате ${room.id}`);

      const allFighters = [...room.teamA, ...room.teamB];
      allFighters.forEach(f => {
        if (f.isBot || f.currentHp <= 0) return;

        if (!f.turn) {
          f.afkTurns = (f.afkTurns || 0) + 1;
          f.missedLastTurn = true;
          console.log(`💤 ${f.name} пропустил ход (${f.afkTurns})`);
        } else {
          f.afkTurns = 0;
          f.missedLastTurn = false;
        }
      });

      room.isCalculating = true;
      executeRoundAndBroadcast(room, io);
    }, durationMs);
  }

 // ==========================================================================
  // 13. DISCONNECT (зрители + участники)
  // ==========================================================================
  socket.on('disconnect', () => {
    console.log(`❌ [BATTLE] Сокет отключён: ${socket.id}`);

    // Убираем из зрителей
    Object.keys(activeRooms).forEach(roomId => {
      const room = activeRooms[roomId];
      if (room.spectators && room.spectators.has(socket.id)) {
        core.removeSpectator(room, socket.id);
      }
    });

    // Помечаем участника как отключённого
    Object.keys(activeRooms).forEach(roomId => {
      const room = activeRooms[roomId];
      const fighter = [...room.teamA, ...room.teamB].find(f => f.socketId === socket.id);
      if (!fighter) return;

      fighter.socketId = null;
      fighter.disconnectedAt = Date.now();

      // 🔥 НЕ рассылаем "отключился", если бой уже завершён
      if (room.state === 'finished') {
        console.log(`✅ [BATTLE] ${fighter.name} вышел после боя — тост не отправляем`);
        return;
      }

      io.to(roomId).emit('opponent_disconnected', {
        name: fighter.name,
        graceSeconds: 60
      });
    });
  });
};
