// ============================================================================
// ===== 🏆 РАСЧЁТ НАГРАД PVP АРЕНЫ (ARENA_REWARDS.JS) =====
// ===== Combat Power, XP, золото =====
// ============================================================================

const GAME_ITEMS_DATABASE = require('./../shop/shop_items_config');

// ============================================================================
// COMBAT POWER — эффективная боевая мощь (Lv + шмот)
// ============================================================================
function getGearContribution(player) {
  if (!player || !player.equipped) return 0;

  const eq = player.equipped;
  let total = 0;

  // Обычные слоты
  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand'];
  slots.forEach(slot => {
    const raw = eq[slot];
    const itemId = (raw && typeof raw === 'object') ? raw.id : raw;
    if (!itemId) return;

    const item = GAME_ITEMS_DATABASE[itemId];
    if (item && item.level) total += item.level * 2;
  });

  // Кольца
  if (Array.isArray(eq.rings)) {
    eq.rings.forEach(raw => {
      const itemId = (raw && typeof raw === 'object') ? raw.id : raw;
      if (!itemId) return;
      const item = GAME_ITEMS_DATABASE[itemId];
      if (item && item.level) total += item.level * 2;
    });
  }

  return total;
}

function getCombatPower(player) {
  const baseLevel = Number(player.level || 1) * 10;
  const gearCP = getGearContribution(player);
  return baseLevel + gearCP;
}

// ============================================================================
// XP — базовое значение за уровень врага
// ============================================================================
function getBaseXp(level) {
  return 50 + ((Number(level) || 1) - 1) * 25;
}

// ============================================================================
// Множитель от разницы Combat Power
// ============================================================================
function getCpMultiplier(cpWinner, cpLoser) {
  const diff = cpLoser - cpWinner;
  const raw = 1.0 + diff / 100;
  return Math.max(0.3, Math.min(2.0, raw));
}

// ============================================================================
// ОСНОВНАЯ ФУНКЦИЯ: расчёт наград для всех участников боя
// ============================================================================
/**
 * @param {Object} room - комната боя (teamA, teamB, result: 'win'|'lose'|'draw')
 * @param {Object} damageStats - { [uuid]: { damageByTarget: { [targetUuid]: N }, totalDamage: N } }
 * @returns {Object} - { [uuid]: { xp, gold, isWinner, breakdown } }
 */
function calculateBattleRewards(room, damageStats) {
  const rewards = {};

  // Определяем кто победил
  // room.result: 'win' (teamA победила), 'lose' (teamB победила), 'draw'
  const result = room.result;

  let winners, losers;
  if (result === 'win') {
    winners = room.teamA;
    losers = room.teamB;
  } else if (result === 'lose') {
    winners = room.teamB;
    losers = room.teamA;
  } else {
    // Ничья — все получают только XP по урону, без золота
    winners = [];
    losers = [...room.teamA, ...room.teamB];
  }

  const totalPlayers = room.teamA.length + room.teamB.length;

  // ============================================================================
  // ЗОЛОТО — пул и делёж поровну
  // ============================================================================
  let goldPerWinner = 0;
  let goldPerLoser = 0;

  if (winners.length > 0 && losers.length > 0) {
    const rawGoldPool = losers.reduce((sum, l) => sum + (5 * Number(l.level || 1)), 0);
    const goldPool = Math.min(rawGoldPool, totalPlayers * 50);

    goldPerWinner = Math.floor((goldPool * 0.8) / winners.length);
    goldPerLoser  = Math.floor((goldPool * 0.2) / losers.length);
  }

  // ============================================================================
  // XP — индивидуально по каждому врагу
  // ============================================================================
  function calcXpFor(fighter, opponents, teammates, isWinner) {
    let totalXp = 0;
    const breakdown = [];

    opponents.forEach(enemy => {
      const myDmg = damageStats[fighter.uuid]?.damageByTarget?.[enemy.uuid] || 0;
      if (myDmg === 0) return;   // не бил этого врага — 0 XP за него

      // Общий урон МОЕЙ КОМАНДЫ по этому врагу
      const teamDmg = teammates.reduce((sum, m) => {
        return sum + (damageStats[m.uuid]?.damageByTarget?.[enemy.uuid] || 0);
      }, 0);

      if (teamDmg === 0) return;

      const contribution = myDmg / teamDmg;

      // Combat Power
      const cpMe = getCombatPower(fighter);
      const cpEnemy = getCombatPower(enemy);

      // Потенциальная XP за убийство/урон этому врагу
      const baseXp = getBaseXp(enemy.level);
      const mult = getCpMultiplier(cpMe, cpEnemy);
      const potentialXp = baseXp * mult;

      // Моя доля
      const xpForThisEnemy = potentialXp * contribution;
      totalXp += xpForThisEnemy;

      breakdown.push({
        enemyUuid: enemy.uuid,
        enemyName: enemy.name,
        enemyLevel: Number(enemy.level || 1),
        myDamage: Math.floor(myDmg),
        teamDamage: Math.floor(teamDmg),
        contribution: Number(contribution.toFixed(3)),
        baseXp: Math.floor(baseXp),
        cpMultiplier: Number(mult.toFixed(2)),
        potentialXp: Math.floor(potentialXp),
        xpEarned: Math.floor(xpForThisEnemy)
      });
    });

    // Проигравшим — штраф 20%
    const finalXpRaw = isWinner ? totalXp : totalXp * 0.2;

    // Cap: level × 100
    const cap = Number(fighter.level || 1) * 100;
    const finalXp = Math.min(Math.floor(finalXpRaw), cap);

    return { finalXp, totalXpRaw: Math.floor(finalXpRaw), cap, breakdown };
  }

  // ============================================================================
  // Победители
  // ============================================================================
  winners.forEach(w => {
    const { finalXp, breakdown } = calcXpFor(w, losers, winners, true);

    rewards[w.uuid] = {
      uuid: w.uuid,
      name: w.name,
      level: Number(w.level || 1),
      xp: finalXp,
      gold: goldPerWinner,
      isWinner: true,
      breakdown
    };
  });

  // ============================================================================
  // Проигравшие
  // ============================================================================
  losers.forEach(l => {
    const opponents = winners.length > 0 ? winners : [...room.teamA, ...room.teamB].filter(f => f.uuid !== l.uuid);
    const teammates = [...room.teamA, ...room.teamB].filter(f =>
      (room.teamA.includes(l) && room.teamA.includes(f)) ||
      (room.teamB.includes(l) && room.teamB.includes(f))
    );

    const { finalXp, breakdown } = calcXpFor(l, opponents, teammates, false);

    rewards[l.uuid] = {
      uuid: l.uuid,
      name: l.name,
      level: Number(l.level || 1),
      xp: finalXp,
      gold: goldPerLoser,
      isWinner: false,
      breakdown
    };
  });

  return rewards;
}

module.exports = {
  getCombatPower,
  getGearContribution,
  getBaseXp,
  getCpMultiplier,
  calculateBattleRewards
};