// ============================================================================
// ===== ⚔️ ФИНАЛИЗЕР PvP-АРЕНЫ (ARENA_FINISHER.JS) =====
// ===== Награды за PvP: 25 монет + XP по формуле =====
// ============================================================================

const dbHelper = require('../../db_helper');

module.exports = {
  async finalize(room, result, sb) {
    const playerA = room.teamA[0];
    const playerB = room.teamB[0];
    if (!playerA || !playerB) {
      console.error('🚨 [ARENA FINISHER] Нет игроков');
      return { rewards: null, logs: [] };
    }

    const config = room.config || {};
    const goldReward = config.pvpReward?.gold || 25;
    const xpBase = config.pvpReward?.xpBase || 15;
    const xpUp = config.pvpReward?.xpMultiplierUp || 1.25;
    const xpDown = config.pvpReward?.xpMultiplierDown || 0.8;

    const calculateXp = (winnerLvl, loserLvl) => {
      const base = Number(loserLvl || 1) * xpBase;
      let mult = 1;
      if (loserLvl > winnerLvl) mult = 1 + ((loserLvl - winnerLvl) * (xpUp - 1));
      else if (loserLvl < winnerLvl) mult = Math.max(0.1, 1 - ((winnerLvl - loserLvl) * (1 - xpDown)));
      return Math.floor(base * mult);
    };

    const [resA, resB] = await Promise.all([
      sb.from('players').select('*').eq('id', Number(playerA.id)).maybeSingle(),
      sb.from('players').select('*').eq('id', Number(playerB.id)).maybeSingle()
    ]);

    if (!resA?.data || !resB?.data) {
      console.error('🚨 [ARENA FINISHER] Профили не найдены');
      return { rewards: null, logs: [] };
    }

    const rowA = resA.data;
    const rowB = resB.data;

    dbHelper.autoRefillPotionsAfterBattle(rowA);
    dbHelper.autoRefillPotionsAfterBattle(rowB);

    const safeRead = (row, field, def = 0) => {
      const low = field.toLowerCase();
      const cap = field.charAt(0).toUpperCase() + field.slice(1);
      return Number(row[low] ?? row[cap] ?? row[field] ?? def);
    };

    let pointsKeyA = rowA.statpoints !== undefined ? 'statpoints' : 'statPoints';
    let pointsKeyB = rowB.statpoints !== undefined ? 'statpoints' : 'statPoints';

    let goldA = safeRead(rowA, 'gold', 0);
    let xpA = safeRead(rowA, 'xp', 0);
    let levelA = safeRead(rowA, 'level', 1);
    let statPointsA = safeRead(rowA, pointsKeyA, 0);

    let goldB = safeRead(rowB, 'gold', 0);
    let xpB = safeRead(rowB, 'xp', 0);
    let levelB = safeRead(rowB, 'level', 1);
    let statPointsB = safeRead(rowB, pointsKeyB, 0);

    const maxHpA = dbHelper.getServerMaxHp({ endurance: safeRead(rowA, 'endurance', 1), equipped: rowA.equipped || {} });
    const maxHpB = dbHelper.getServerMaxHp({ endurance: safeRead(rowB, 'endurance', 1), equipped: rowB.equipped || {} });

    let endHpA = maxHpA;
    let endHpB = maxHpB;
    const logs = [];

    if (result === 'win') {
      const xpGained = calculateXp(levelA, levelB);
      goldA += goldReward;
      xpA += xpGained;

      const newLevelA = dbHelper.getServerCorrectLevelByXp(xpA);
      if (newLevelA > levelA) {
        statPointsA += (newLevelA - levelA) * 5;
        levelA = newLevelA;
      }

      endHpA = Math.max(1, Number(playerA.currentHp));
      endHpB = Math.max(1, Math.floor(maxHpB * 0.2));

      logs.push(`🏁 <strong>ПОБЕДА НА АРЕНЕ!</strong> ${playerA.name} поверг соперника! Награда: 💰 ${goldReward} монет, ✨ ${xpGained} опыта.`);

    } else if (result === 'lose') {
      const xpGained = calculateXp(levelB, levelA);
      goldB += goldReward;
      xpB += xpGained;

      const newLevelB = dbHelper.getServerCorrectLevelByXp(xpB);
      if (newLevelB > levelB) {
        statPointsB += (newLevelB - levelB) * 5;
        levelB = newLevelB;
      }

      endHpA = Math.max(1, Math.floor(maxHpA * 0.2));
      endHpB = Math.max(1, Number(playerB.currentHp));

      logs.push(`🏁 <strong>ПОБЕДА НА АРЕНЕ!</strong> ${playerB.name} одержал верх! Награда: 💰 ${goldReward} монет, ✨ ${xpGained} опыта.`);

    } else {
      endHpA = Math.max(1, Math.floor(maxHpA * 0.2));
      endHpB = Math.max(1, Math.floor(maxHpB * 0.2));
      logs.push(`🏁 <strong>НИЧЬЯ НА АРЕНЕ!</strong> Силы равны. Награды аннулированы.`);
    }

    await Promise.all([
      sb.from('players').update({
        gold: goldA, xp: xpA, level: levelA, hp: endHpA,
        inventory: rowA.inventory, equipped: rowA.equipped,
        [pointsKeyA]: statPointsA
      }).eq('id', Number(playerA.id)),

      sb.from('players').update({
        gold: goldB, xp: xpB, level: levelB, hp: endHpB,
        inventory: rowB.inventory, equipped: rowB.equipped,
        [pointsKeyB]: statPointsB
      }).eq('id', Number(playerB.id))
    ]);

    return {
      rewards: { winnerGold: goldReward, winnerXp: (result === 'win' ? calculateXp(levelA, levelB) : calculateXp(levelB, levelA)) },
      logs
    };
  }
};