// ============================================================================
// ===== 🔌 SOCKET-СЛОЙ БОЯ (BATTLE_HANDLERS.JS) =====
// ===== Связка между ядром и клиентом через socket.io =====
// ============================================================================

const dbHelper = require('../db_helper');
const core = require('./battle_core');
const state = require('./battle_state');
const router = require('./battle_router');

module.exports = function(io, socket, sb, activeRooms) {
  if (!socket) return;

  const getServerMaxHp = dbHelper.getServerMaxHp;

  // ==========================================================================
  // 1. СТАРТ БОЯ (PvE с мобами на карте, башня)
  // ==========================================================================
  socket.on('battle_start', async ({ battleType, params = {}, playerData = {} }) => {
    try {
      const config = router.getConfig(battleType);
      if (!config) return socket.emit('error', `Неизвестный тип боя: ${battleType}`);

      // Проверка кулдауна (если у конфига есть)
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

      // Загружаем игрока из БД
      const { data: dbPlayer } = await sb.from('players')
        .select('*').eq('id', Number(playerData.id)).maybeSingle();

      if (!dbPlayer) return socket.emit('error', 'Игрок не найден');

      // Собираем команду игрока
      const teamA = router.buildPlayerTeam(playerData, dbPlayer);
      teamA[0].maxHp = getServerMaxHp(teamA[0]);
      teamA[0].currentHp = Math.min(teamA[0].currentHp, teamA[0].maxHp);

      // Собираем мобов
      let teamB = [];
      if (battleType === 'world' || battleType === 'tower') {
        const monsterIds = params.monsterIds || [];
        const { data: allBots } = await sb.from('bots')
          .select('*').in('id', monsterIds);

        if (!allBots || allBots.length === 0) {
          return socket.emit('error', 'Мобы не найдены');
        }

        teamB = router.buildMonsterTeam(allBots, config, {
          count: params.count || monsterIds.length
        });

        // HP + скалирование
        teamB.forEach(m => {
          m.maxHp = getServerMaxHp(m);
          m.currentHp = m.maxHp;
        });
      }

      // Создаём комнату
      const room = core.createRoom({
        battleType,
        teamA,
        teamB,
        config,
        params: { roomId: params.roomId }
      });

      // Заполняем доп. поля для башни
      if (battleType === 'tower') {
        room.config.towerFloor = params.currentFloor || 1;
      }

      activeRooms[room.id] = room;
      socket.join(room.id);

      // Отправляем init_data
      socket.emit('battle_init_data', {
        roomId: room.id,
        turnCount: 1,
        myUuid: teamA[0].uuid,
        teamA: state.serializeTeam(room.teamA),
        teamB: state.serializeTeam(room.teamB),
        isTower: battleType === 'tower',
        battleType
      });

      // Запускаем таймер хода
      startTurnTimer(room, io);

      console.log(`🎬 [BATTLE START] ${battleType} | Комната: ${room.id} | Игрок: ${teamA[0].name}`);

    } catch (err) {
      console.error('🚨 [battle_start]', err.message);
      socket.emit('error', `Ошибка старта боя: ${err.message}`);
    }
  });

  // ==========================================================================
  // 2. ПРИЁМ ХОДА
  // ==========================================================================
  socket.on('battle_submit_turn', ({ roomId, targetUuid, attack, defends }) => {
    const room = activeRooms[roomId];
    if (!room) return;

    const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
    if (!fighter) return;

    const result = core.submitTurn(room, fighter.uuid, { targetUuid, attack, defends });
    if (!result.ok) {
      console.log(`⚠️ [ХОД ОТКЛОНЁН] ${result.error}`);
      return;
    }

    console.log(`📥 [ХОД] ${fighter.name} | Удар: ${JSON.stringify(attack)} | Блок: ${JSON.stringify(defends)}`);

    // Проверяем, все ли сделали ход
    if (core.isReadyForRound(room)) {
      clearTimeout(room.timeoutRef);
      room.isCalculating = true;
      executeRoundAndBroadcast(room, io);
    }
  });

  // ==========================================================================
  // 3. ИСПОЛЬЗОВАНИЕ ЗЕЛИЙ
  // ==========================================================================
  socket.on('battle_use_potion', async ({ roomId }) => {
    try {
      const room = activeRooms[roomId];
      if (!room) return;

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
  // 4. ПОПОВЕРЫ СТАТОВ (для клиента)
  // ==========================================================================
  socket.on('battle_get_stats', ({ roomId, targetUuid }, callback) => {
    try {
      const room = activeRooms[roomId];
      if (!room) return callback({ error: 'Комната не найдена' });

      const fighter = state.getFighter(room, targetUuid);
      if (!fighter) return callback({ error: 'Боец не найден' });

      const engine = require('./battle_engine');

      const totalAgi = engine.getAgility(fighter);
      const totalLuck = engine.getLuck(fighter);

      const mfInv = (totalAgi * 10) + engine.getEquipmentBonus(fighter, 'mf_inv');
      const mfAntiInv = (totalAgi * 4) + engine.getEquipmentBonus(fighter, 'mf_antiinv');
      const mfCrit = (totalLuck * 10) + engine.getEquipmentBonus(fighter, 'mf_crit');
      const mfAntiCrit = (totalLuck * 4) + engine.getEquipmentBonus(fighter, 'mf_anticrit');

      callback({
        success: true,
        stats: [
          { label: '💪 Сила', value: engine.getAtk(fighter) },
          { label: '🏹 Ловкость', value: totalAgi },
          { label: '🛡️ Выносливость', value: engine.getDef(fighter) },
          { label: '🍀 Удача', value: totalLuck },
          { label: '🏹 Мф. Уворота', value: `+${mfInv}%` },
          { label: '🎯 Мф. Антиуворота', value: `+${mfAntiInv}%` },
          { label: '💥 Мф. Крита', value: `+${mfCrit}%` },
          { label: '🛡️ Мф. Антикрита', value: `+${mfAntiCrit}%` }
        ]
      });
    } catch (err) {
      console.error('🚨 [battle_get_stats]', err.message);
      callback({ error: 'Внутренняя ошибка' });
    }
  });

  // ==========================================================================
  // 5. РЕКОННЕКТ
  // ==========================================================================
  socket.on('battle_reconnect', ({ roomId, userId }) => {
    const room = activeRooms[roomId];
    if (!room) return socket.emit('error', 'Бой уже завершился.');

    const sUserId = String(userId);
    const fighter = [...room.teamA, ...room.teamB].find(f => String(f.id) === sUserId);
    if (!fighter) return socket.emit('error', 'Вы не в этой комнате');

    const wasDisconnected = fighter.disconnectedAt !== null && fighter.disconnectedAt !== undefined;
    fighter.socketId = socket.id;
    fighter.disconnectedAt = null;
    socket.join(roomId);

    if (wasDisconnected) {
      io.to(roomId).emit('opponent_reconnected', { name: fighter.name });
    }

    socket.emit('battle_init_data', {
      roomId: room.id,
      turnCount: room.turnCount,
      myUuid: fighter.uuid,
      teamA: state.serializeTeam(room.teamA),
      teamB: state.serializeTeam(room.teamB),
      isTower: room.battleType === 'tower',
      battleType: room.battleType
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
  });

  // ==========================================================================
  // 6. ПРОВЕРКА АКТИВНОГО БОЯ
  // ==========================================================================
  socket.on('battle_check_active', ({ userId }, callback) => {
    const sUserId = String(userId);
    const roomId = Object.keys(activeRooms).find(id => {
      const r = activeRooms[id];
      return [...r.teamA, ...r.teamB].some(f => String(f.id) === sUserId);
    });

    if (typeof callback === 'function') {
      callback({ activeRoomId: roomId || null });
    } else if (roomId) {
      socket.emit('arena_redirect_to_battle', { roomId });
    }
  });

  // ==========================================================================
  // 7. РАСЧЁТ РАУНДА + РАССЫЛКА
  // ==========================================================================
  async function executeRoundAndBroadcast(room, io) {
    // 1. Ядро считает раунд
    const result = core.executeRound(room);

    // 2. Логи (пока только в консоль — потом в БД)
    result.logs.forEach(l => console.log(`  └─ ${l.replace(/<[^>]+>/g, '')}`));

    // 3. Рассылка
    if (room.battleType === 'arena_pvp') {
      // Для PvP — отдельные сообщения
      const playerA = room.teamA[0];
      const playerB = room.teamB[0];

      if (playerA?.socketId) {
        io.to(playerA.socketId).emit('battle_round_result', {
          ...result,
          resultType: result.result
        });
      }
      if (playerB?.socketId) {
        const resB = result.result === 'win' ? 'lose' : (result.result === 'lose' ? 'win' : 'draw');
        io.to(playerB.socketId).emit('battle_round_result', {
          ...result,
          resultType: resB
        });
      }
    } else {
      // Для PvE — всем в комнате
      io.to(room.id).emit('battle_round_result', result);
    }

    // 4. Финал
    if (result.isOver) {
      clearTimeout(room.timeoutRef);
      await finishBattle(room, result);
    } else {
      // 5. Новый таймер
      room.isCalculating = false;
      startTurnTimer(room, io);
    }
  }

  // ==========================================================================
  // 8. ФИНАЛИЗАЦИЯ БОЯ
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

      // Добавляем логи финала в результат
      if (finalData.logs && finalData.logs.length > 0) {
        io.to(room.id).emit('battle_final_logs', { logs: finalData.logs });
      }

      console.log(`🏁 [ФИНАЛ] ${room.battleType} | ${result.result} | Комната: ${room.id}`);

    } catch (err) {
      console.error('🚨 [finishBattle]', err.message);
    }

    // Удаляем комнату через паузу
    setTimeout(() => {
      core.destroyRoom(room);
      delete activeRooms[room.id];
      console.log(`🗑️ [ОЧИСТКА] Комната ${room.id} удалена`);
    }, 3000);
  }

  // ==========================================================================
  // 9. ТАЙМЕР ХОДА (динамический)
  // ==========================================================================
  function startTurnTimer(room, io) {
    if (room.timeoutRef) clearTimeout(room.timeoutRef);

    const config = room.config;
    const timerCfg = config.turnTimer || {};

    // Считаем макс. afkTurns среди живых
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

      // АФК-обработка
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
};