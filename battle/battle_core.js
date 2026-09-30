// ============================================================================
// ===== 🧠 ЯДРО БОЯ (BATTLE_CORE.JS) =====
// ===== Управление комнатами: создание, ходы, раунд, финал =====
// ===== НЕ знает socket. Возвращает данные — эмитит их handlers. =====
// ============================================================================

const engine = require('./battle_engine');
const state = require('./battle_state');

// ============================================================================
// СОЗДАНИЕ КОМНАТЫ
// ============================================================================

function createRoom({ battleType, teamA, teamB, config, params = {} }) {
  const roomId = params.roomId || `room_${battleType}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const room = {
    id: roomId,
    battleType,
    config,
    teamA,
    teamB,
    fighters: state.createFighterMap(teamA, teamB),
    turnCount: 1,
    state: 'active',           // active | finished
    isCalculating: false,
    createdAt: Date.now(),

    // Таймер (заполняется позже — из handlers/systems)
    timerStartedAt: null,
    timerEndsAt: null,
    timerDurationMs: null,

    // Волны и фазы (заготовки)
    waves: null,
    currentWave: 0,
    phases: null,
    currentPhase: 0,

    // Для финализера
    result: null,
    logs: []
  };

  return room;
}

// ============================================================================
// ПРИЁМ ХОДА
// ============================================================================

function submitTurn(room, uuid, payload) {
  if (!room || room.state !== 'active') {
    return { ok: false, error: 'Бой неактивен' };
  }
  if (room.isCalculating) {
    return { ok: false, error: 'Расчёт раунда...' };
  }

  const fighter = state.getFighter(room, uuid);
  if (!fighter) return { ok: false, error: 'Боец не найден' };
  if (fighter.currentHp <= 0) return { ok: false, error: 'Боец мёртв' };
  if (fighter.turn) return { ok: false, error: 'Ход уже сделан' };

  const { targetUuid, attack, defends } = payload;

  // Античит по лимитам
  const { maxAttacks, maxDefends } = engine.getCombatLimits(fighter);

  let checkedAttack = attack;
  let checkedDefends = Array.isArray(defends) ? defends.filter(z => typeof z === 'string') : [];

  if (checkedDefends.length > maxDefends) {
    checkedDefends = checkedDefends.slice(0, maxDefends);
  }

  if (maxAttacks === 1 && Array.isArray(checkedAttack)) {
    checkedAttack = checkedAttack[0] || 'torso';
  } else if (maxAttacks === 2 && Array.isArray(checkedAttack) && checkedAttack.length > 2) {
    checkedAttack = checkedAttack.slice(0, 2);
  }

  fighter.turn = {
    targetUuid: String(targetUuid),
    attack: checkedAttack,
    defends: checkedDefends
  };
  fighter.afkTurns = 0;
  fighter.missedLastTurn = false;

  return { ok: true };
}

// ============================================================================
// ПРОВЕРКА, ГОТОВ ЛИ РАУНД
// ============================================================================

function isReadyForRound(room) {
  // Все живые игроки (не боты) сделали ход
  const aliveHumans = [...room.teamA, ...room.teamB]
    .filter(f => !f.isBot && f.currentHp > 0);

  return aliveHumans.every(f => f.turn !== null && f.turn !== undefined);
}

// ============================================================================
// РАСЧЁТ РАУНДА
// ============================================================================

function executeRound(room) {
  if (!room || room.state !== 'active') {
    return { logs: [], isOver: true, result: 'error', updates: [] };
  }

  const logs = [];
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const zoneNames = { head: 'Голову', breast: 'Грудь', torso: 'Торс', belt: 'Пояс', legs: 'Ноги' };

  // ──────── 1. ПРОВЕРКА АФК-ДИСКВАЛИФИКАЦИИ ────────
  const allHumans = [...room.teamA, ...room.teamB].filter(f => !f.isBot && f.currentHp > 0);
  const disqualified = allHumans.find(f => (f.afkTurns || 0) >= (room.config?.turnTimer?.maxAfkTurns || 3));

  if (disqualified) {
    logs.push(`🛑 <strong>${disqualified.name}</strong> застыл слишком долго. Техническое поражение.`);
    disqualified.currentHp = 0;
    return finalizeRound(room, logs);
  }

  // Логи о пропущенных ходах
  allHumans.forEach(f => {
    if (f.missedLastTurn && f.afkTurns > 0) {
      const remaining = (room.config?.turnTimer?.maxAfkTurns || 3) - f.afkTurns;
      if (remaining > 0) {
        logs.push(`💤 <strong>${f.name}</strong> пропустил ход. Осталось предупреждений: ${remaining}.`);
      }
    }
  });

  // ──────── 2. ИИ МОБОВ (заглушка — реально будет вызов ai.monster_ai) ────────
  room.teamB.forEach(bot => {
    if (bot.currentHp <= 0 || !bot.isBot) return;
    if (bot.turn) return;   // уже сделал ход

    const aliveTargets = room.teamA.filter(a => a.currentHp > 0);
    if (aliveTargets.length === 0) return;

    const target = aliveTargets[rand(0, aliveTargets.length - 1)];
    const zones = ['head', 'breast', 'torso', 'belt', 'legs'];
    const { maxAttacks, maxDefends } = engine.getCombatLimits(bot);

    const defends = [];
    while (defends.length < maxDefends) {
      const z = zones[rand(0, zones.length - 1)];
      if (!defends.includes(z)) defends.push(z);
    }

    let attackPayload;
    if (maxAttacks === 2) {
      attackPayload = [zones[rand(0, zones.length - 1)], zones[rand(0, zones.length - 1)]];
    } else {
      attackPayload = zones[rand(0, zones.length - 1)];
    }

    bot.turn = {
      targetUuid: target.uuid,
      attack: attackPayload,
      defends
    };
  });

  // ──────── 3. СБОРКА ОЧЕРЕДИ АТАК ────────
  const queue = [...room.teamA, ...room.teamB];
  const aliveAtStart = queue.filter(f => f.currentHp > 0).map(f => f.uuid);

  queue.forEach(attacker => {
    if (!aliveAtStart.includes(attacker.uuid)) return;
    if (!attacker.turn || !attacker.turn.targetUuid) return;

    let target = state.getFighter(room, attacker.turn.targetUuid);
    if (!target || target.currentHp <= 0) {
      target = state.findFirstAliveOpponent(room, attacker.uuid);
      if (!target) return;
    }

    if (attacker.uuid === target.uuid) return;

    // ─── Список зон атаки ───
    let attacksList = [];

    if (attacker.isBot) {
      attacksList = Array.isArray(attacker.turn.attack) ? attacker.turn.attack : [attacker.turn.attack];
    } else {
      const mainWeapon = attacker.equipped?.mainHand;
      const offWeapon = attacker.equipped?.offHand;

      if (engine.isTwoHanded(mainWeapon)) {
        attacksList = Array.isArray(attacker.turn.attack) ? attacker.turn.attack : [attacker.turn.attack];
      } else if (offWeapon && !engine.isShield(offWeapon)) {
        // Дуалы — 2 удара
        const primary = Array.isArray(attacker.turn.attack) ? attacker.turn.attack[0] : attacker.turn.attack;
        const zones = ['head', 'breast', 'torso', 'belt', 'legs'];
        const leftZone = zones[Math.floor(Math.random() * zones.length)];
        attacksList = [primary, leftZone];
      } else {
        const single = Array.isArray(attacker.turn.attack) ? attacker.turn.attack[0] : attacker.turn.attack;
        attacksList = [single];
      }
    }

    // ─── Расчёт ударов ───
    const damageFactor = attacksList.length === 2 ? 1.3 : 1.0;

    attacksList.forEach(zone => {
      if (!zone) return;

      const result = engine.calculateHit(attacker, target, zone, {
        rand,
        damageFactor,
        zoneNames
      });

      if (result.hit) {
        target.currentHp = Math.max(0, Number(target.currentHp || 0) - result.damage);
      }

      logs.push(result.log);
    });
  });

  // ──────── 4. СБРОС ХОДОВ ────────
  room.teamA.forEach(f => {
    f.turn = null;
    f.missedLastTurn = false;
  });
  room.teamB.forEach(f => {
    f.turn = null;
    f.missedLastTurn = false;
  });

  // ──────── 5. ПРОВЕРКА ФИНАЛА ────────
  return finalizeRound(room, logs);
}

// ============================================================================
// ЗАВЕРШЕНИЕ РАУНДА — проверка финала
// ============================================================================

function finalizeRound(room, logs) {
  const isATeamDead = !state.isTeamAlive(room, 'A');
  const isBTeamDead = !state.isTeamAlive(room, 'B');
  const currentRound = room.turnCount;

  room.turnCount++;

  let isOver = false;
  let result = null;

  if (isATeamDead || isBTeamDead || room.turnCount > 1000) {
    isOver = true;
    if (!isATeamDead && isBTeamDead) result = 'win';
    else if (isATeamDead && !isBTeamDead) result = 'lose';
    else result = 'draw';

    room.state = 'finished';
    room.result = result;
  }

  // Обновления для diff-протокола
  const updates = [...room.teamA, ...room.teamB].map(f => ({
    uuid: f.uuid,
    currentHp: f.currentHp,
    afkTurns: f.afkTurns || 0
  }));

  return {
    logs,
    isOver,
    result,
    turnCount: currentRound,
    updates,
    teamA: state.serializeTeam(room.teamA),
    teamB: state.serializeTeam(room.teamB)
  };
}

// ============================================================================
// УНИЧТОЖЕНИЕ КОМНАТЫ
// ============================================================================

function destroyRoom(room) {
  if (!room) return;
  room.state = 'finished';
  room.fighters.clear();
  room.teamA = [];
  room.teamB = [];
}

// ============================================================================
// ЭКСПОРТ
// ============================================================================

module.exports = {
  createRoom,
  submitTurn,
  isReadyForRound,
  executeRound,
  destroyRoom
};