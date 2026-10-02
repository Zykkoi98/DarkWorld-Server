// ============================================================================
// ===== 🌍 ФИНАЛИЗЕР БОЯ НА КАРТЕ МИРА (WORLD_FINISHER.JS) — v2 =====
// ===== Добавлено: applyResults в обеих ветках (победа / поражение) =====
// ============================================================================

const dbHelper = require('../../db_helper');

module.exports = {
  async finalize(room, result, sb) {
    const player = room.teamA[0];
    if (!player) {
      console.error('🚨 [WORLD FINISHER] Нет игрока в комнате');
      return { rewards: null, logs: [], applyResults: [] };
    }

    const { data: freshDb } = await sb.from('players')
      .select('*').eq('id', Number(player.id)).maybeSingle();

    if (!freshDb) {
      console.error('🚨 [WORLD FINISHER] Игрок не найден в БД');
      return { rewards: null, logs: [], applyResults: [] };
    }

    let gainedXp = 0;
    let gainedGold = 0;
    let dbHpPayload = Number(player.currentHp || 0);

    const logs = [];

    const liveInventory = freshDb.inventory || { equipment: [], resources: [], consumables: [] };
    const liveEquipped = freshDb.equipped || { rings: [null, null, null] };
    player.inventory = liveInventory;
    player.equipped = liveEquipped;

    dbHelper.autoRefillPotionsAfterBattle(player);

    if (result === 'win') {
      room.teamB.forEach(m => {
        gainedXp += Number(m.rewardXp || 0);
        gainedGold += Number(m.rewardGold || 0);
      });

      const oldLevel = Number(freshDb.level ?? 1);
      const newXp = Number(freshDb.xp || 0) + gainedXp;
      const newLevel = dbHelper.getServerCorrectLevelByXp(newXp);

      let pointsKey = freshDb.statpoints !== undefined ? 'statpoints' : 'statPoints';
      let newStatPoints = Number(freshDb[pointsKey] || 0);

      let levelUp = false;
      if (newLevel > oldLevel) {
        newStatPoints += (newLevel - oldLevel) * 5;
        player.currentHp = dbHelper.getServerMaxHp({
          level: Number(freshDb.level || 1),
          endurance: Number(freshDb.endurance || 1),
          equipped: liveEquipped
        });
        levelUp = true;
        logs.push(`🎉 <strong>УРОВЕНЬ ПОВЫШЕН!</strong> Вы достигли ${newLevel} уровня!`);
      }

      dbHpPayload = player.currentHp;

      await sb.from('players').update({
        gold: Number(freshDb.gold || 0) + gainedGold,
        xp: newXp,
        hp: Number(dbHpPayload),
        level: newLevel,
        inventory: player.inventory,
        equipped: player.equipped,
        [pointsKey]: newStatPoints
      }).eq('id', Number(player.id));

      logs.push(`🏁 <strong>ПОБЕДА!</strong> Награда: 💰 ${gainedGold} монет, ✨ ${gainedXp} опыта.`);

      return {
        rewards: { gold: gainedGold, xp: gainedXp },
        applyResults: [{
          uuid: player.uuid,
          name: player.name,
          level: oldLevel,
          isWinner: true,
          goldGained: gainedGold,
          xpGained: gainedXp,
          newLevel,
          levelUp,
          finalHp: dbHpPayload,
          maxHp: 0
        }],
        logs
      };

    } else {
      // Поражение — воскрешение в городе на 20%
      player.currentHp = 0;
      dbHpPayload = Math.max(1, Math.floor(dbHelper.getServerMaxHp({
        level: Number(freshDb.level || 1),
        endurance: Number(freshDb.endurance || 1),
        equipped: liveEquipped
      }) * 0.2));

      await sb.from('players').update({
        hp: dbHpPayload,
        inventory: player.inventory,
        equipped: player.equipped
      }).eq('id', Number(player.id));

      logs.push(`🏁 <strong>ВАС ОДОЛЕЛИ...</strong> Воскрешение в городе.`);

      return {
        rewards: { gold: 0, xp: 0 },
        applyResults: [{
          uuid: player.uuid,
          name: player.name,
          level: Number(freshDb.level || 1),
          isWinner: false,
          goldGained: 0,
          xpGained: 0,
          newLevel: Number(freshDb.level || 1),
          levelUp: false,
          finalHp: dbHpPayload,
          maxHp: 0
        }],
        logs
      };
    }
  }
};