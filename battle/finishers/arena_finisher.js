// ============================================================================
// ===== 🏆 ФИНАЛИЗЕР PVP АРЕНЫ (ARENA_FINISHER.JS) — v3 =====
// ===== Исправлено: levelUp объявлен, maxHp в applyResults =====
// ============================================================================

const dbHelper = require('./../../db_helper');
const rewards = require('./../../arena/arena_rewards');

module.exports = {
  async finalize(room, result, sb) {
    console.log(`🏆 [ARENA FINISHER] Старт финализации. result=${result}`);

    // ========================================================================
    // 1. СЧИТАЕМ НАГРАДЫ
    // ========================================================================
    const damageStats = room.damageStats || {};
    const rewardMap = rewards.calculateBattleRewards(room, damageStats);

    console.log(`📊 [ARENA FINISHER] Награды рассчитаны для ${Object.keys(rewardMap).length} игроков`);

    // ========================================================================
    // 2. ЧИТАЕМ ПРОФИЛИ ИЗ БД
    // ========================================================================
    const allFighters = [...room.teamA, ...room.teamB];
    const dbProfiles = {};

    for (const fighter of allFighters) {
      if (fighter.isBot) continue;
      try {
        const { data } = await sb.from('players').select('*').eq('id', Number(fighter.id)).maybeSingle();
        if (data) dbProfiles[fighter.uuid] = data;
      } catch (err) {
        console.error(`🚨 Не удалось прочитать профиль ${fighter.name}:`, err.message);
      }
    }

    // ========================================================================
    // 3. ПРИМЕНЯЕМ НАГРАДЫ И ОБНОВЛЯЕМ БД
    // ========================================================================
    const logs = [];
    const applyResults = [];

    for (const fighter of allFighters) {
      if (fighter.isBot) continue;

      const reward = rewardMap[fighter.uuid];
      const dbRow = dbProfiles[fighter.uuid];

      if (!reward || !dbRow) {
        console.warn(`⚠️ Пропускаем ${fighter.name} — нет reward или dbRow`);
        continue;
      }

      const currentGold = dbHelper.safeReadField(dbRow, 'gold', 0);
      const currentXp = dbHelper.safeReadField(dbRow, 'xp', 0);
      const currentLevel = dbHelper.safeReadField(dbRow, 'level', 1);
      const pointsKey = dbRow.statpoints !== undefined ? 'statpoints' : 'statPoints';
      const currentStatPoints = dbHelper.safeReadField(dbRow, pointsKey, 0);

      const newGold = currentGold + reward.gold;
      const newXp = currentXp + reward.xp;
      const newLevel = dbHelper.getServerCorrectLevelByXp(newXp);

      // 🔥 Статпоинты за повышение
      let newStatPoints = currentStatPoints;
      let levelUp = false;
      if (newLevel > currentLevel) {
        const gainedLevels = newLevel - currentLevel;
        newStatPoints += gainedLevels * 5;
        levelUp = true;
      }

      const maxHp = dbHelper.getServerMaxHp({
        level: dbHelper.safeReadField(dbRow, 'level', 1),      // 🔥 добавить
        endurance: dbHelper.safeReadField(dbRow, 'endurance', 1),
        equipped: dbRow.equipped || {}
      });

      let finalHp;
      if (reward.isWinner) {
        finalHp = Math.max(1, Math.floor(Number(fighter.currentHp || 1)));
      } else {
        finalHp = Math.max(1, Math.floor(maxHp * 0.2));
      }

      // Автопополнение банок
      const playerObjForPotion = {
        equipped: dbRow.equipped || {},
        inventory: dbRow.inventory || { equipment: [], resources: [], consumables: [] }
      };
      dbHelper.autoRefillPotionsAfterBattle(playerObjForPotion);

      try {
        await sb.from('players').update({
          gold: newGold,
          xp: newXp,
          level: newLevel,
          hp: finalHp,
          [pointsKey]: newStatPoints,
          equipped: playerObjForPotion.equipped,
          inventory: playerObjForPotion.inventory
        }).eq('id', Number(fighter.id));
      } catch (err) {
        console.error(`🚨 Ошибка обновления ${fighter.name}:`, err.message);
      }

      applyResults.push({
        uuid: fighter.uuid,
        name: fighter.name,
        level: fighter.level,
        isWinner: reward.isWinner,
        goldGained: reward.gold,
        xpGained: reward.xp,
        newLevel,
        levelUp,
        finalHp,
        maxHp
      });
    }

    // ========================================================================
    // 4. ЛОГИ ФИНАЛА
    // ========================================================================
    for (const r of applyResults) {
      const tag = r.isWinner ? '🏆 ПОБЕДА' : '💀 ПОРАЖЕНИЕ';
      const parts = [];
      if (r.goldGained > 0) parts.push(`💰 +${r.goldGained} золота`);
      if (r.xpGained > 0) parts.push(`✨ +${r.xpGained} XP`);

      let line = `${tag} <strong>${r.name}</strong> (Lv ${r.level})`;
      if (parts.length > 0) {
        line += `: ${parts.join(', ')}`;
      } else {
        line += `: без наград`;
      }
      logs.push(line);
    }

    for (const r of applyResults) {
      if (r.levelUp) {
        logs.push(`🎉 <strong>УРОВЕНЬ ПОВЫШЕН!</strong> ${r.name} → ${r.newLevel} уровень!`);
      }
    }

    if (result === 'draw') {
      logs.push(`🤝 <strong>НИЧЬЯ НА АРЕНЕ!</strong> Силы равны.`);
    }

    console.log(`✅ [ARENA FINISHER] Готово. Логов: ${logs.length}`);
    applyResults.forEach(r => {
      console.log(`  ${r.isWinner ? '🏆' : '💀'} ${r.name}: +${r.goldGained}g, +${r.xpGained}xp`);
    });

    return {
      rewards: rewardMap,
      applyResults,
      logs
    };
  }
};