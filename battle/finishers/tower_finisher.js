// ============================================================================
// ===== 🏰 ФИНАЛИЗЕР БАШНИ (TOWER_FINISHER.JS) — v2 =====
// ===== Награды + возврат в башню + КД =====
// ============================================================================

const dbHelper = require('../../db_helper');

module.exports = {
  async finalize(room, result, sb) {
    const player = room.teamA[0];
    if (!player) {
      console.error('🚨 [TOWER FINISHER] Нет игрока в комнате');
      return { rewards: null, logs: [] };
    }

    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    // Этаж — откуда пришёл бой
    const currentFloor = Number(room.config?.towerFloor || 1);

    // 🔥 Свежий профиль из БД (защита от откатов)
    const { data: freshDb } = await sb.from('players')
      .select('*').eq('id', Number(player.id)).maybeSingle();

    if (!freshDb) {
      console.error('🚨 [TOWER FINISHER] Игрок не найден в БД');
      return { rewards: null, logs: [] };
    }

    let baseGold = Number(freshDb.gold || 0);
    let baseXp = Number(freshDb.xp || 0);
    let baseTowerCoins = Number(freshDb.tower_coins || 0);
    let currentDbLevel = Number(freshDb.level ?? 1);

    // Свежий инвентарь/кукла
    const liveInventory = freshDb.inventory || { equipment: [], resources: [], consumables: [] };
    const liveEquipped = freshDb.equipped || { rings: [null, null, null] };
    player.inventory = liveInventory;
    player.equipped = liveEquipped;

    dbHelper.autoRefillPotionsAfterBattle(player);

    let pointsKey = freshDb.statpoints !== undefined ? 'statpoints' : 'statPoints';
    let currentDbStatPoints = Number(freshDb[pointsKey] || 0);

    let gainedXp = 0;
    let gainedGold = 0;
    let gainedCoins = 0;
    const logs = [];

    const updatePayload = {
      inventory: player.inventory,
      equipped: player.equipped
    };

    if (result === 'win') {
      // 🔥 РАСЧЁТ НАГРАД
      room.teamB.forEach(m => {
        const mLevel = Number(m.level ?? 1);
        gainedXp += Number(m.rewardXp || (5 + mLevel * 3));

        // 10% золото
        if (rand(1, 100) <= 10) {
          const goldDrop = m.rewardGold !== undefined ? Number(m.rewardGold) : mLevel;
          gainedGold += goldDrop;
        }

        // 30% монеты Башни
        if (rand(1, 100) <= 30) {
          let maxCoins = 1 + Math.floor((mLevel - 1) / 5);
          const isBoss = String(m.id || '').includes('boss');
          if (isBoss) maxCoins *= 2;
          gainedCoins += rand(1, Math.max(1, maxCoins));
        }
      });

      // Начисляем всё к свежим значениям из БД
      updatePayload.gold = baseGold + gainedGold;
      updatePayload.xp = baseXp + gainedXp;
      updatePayload.tower_coins = baseTowerCoins + gainedCoins;

      // Проверка левелапа
      const correctLevel = dbHelper.getServerCorrectLevelByXp(updatePayload.xp);
      if (correctLevel > currentDbLevel) {
        updatePayload[pointsKey] = currentDbStatPoints + (correctLevel - currentDbLevel) * 5;
        updatePayload.level = correctLevel;
        updatePayload.hp = dbHelper.getServerMaxHp({
          endurance: Number(freshDb.endurance || 1),
          equipped: player.equipped
        });
        logs.push(`🎉 <strong>УРОВЕНЬ ПОВЫШЕН!</strong> Вы достигли ${correctLevel} уровня!`);
      } else {
        updatePayload.level = currentDbLevel;
        updatePayload[pointsKey] = currentDbStatPoints;
        updatePayload.hp = player.currentHp;
      }

      // 🔥 Открываем следующий этаж
      updatePayload.tower_floor = currentFloor + 1;

      let rewardText = `🏁 <strong>ПОБЕДА В БАШНЕ!</strong> Этаж ${currentFloor}. Награда: ✨ +${gainedXp} опыта`;
      if (gainedGold > 0) rewardText += `, 💰 +${gainedGold} золота`;
      if (gainedCoins > 0) rewardText += `, 🪙 +${gainedCoins} монет Башни`;
      rewardText += '.';
      logs.push(rewardText);

    } else {
      // 🔥 ПОРАЖЕНИЕ — КД 3 часа
      const cooldownTime = new Date(Date.now() + 3 * 60 * 60 * 1000);

      await sb.from('player_timers').upsert({
        user_id: Number(player.id),
        timer_type: 'tower_cooldown',
        ends_at: cooldownTime.toISOString()
      }, { onConflict: 'user_id,timer_type' });

      updatePayload.gold = baseGold;
      updatePayload.xp = baseXp;
      updatePayload.tower_coins = baseTowerCoins;
      updatePayload.level = currentDbLevel;
      updatePayload[pointsKey] = currentDbStatPoints;
      updatePayload.hp = Math.max(1, Math.floor(dbHelper.getServerMaxHp({
        endurance: Number(freshDb.endurance || 1),
        equipped: player.equipped
      }) * 0.2));
      updatePayload.tower_floor = 1;

      logs.push(`🏁 <strong>ВАС ОДОЛЕЛИ...</strong> Башня сброшена на 1 этаж. КД 3 часа.`);
    }

    // Запись в БД
    await sb.from('players').update(updatePayload).eq('id', Number(player.id));

    return {
      rewards: { xp: gainedXp, gold: gainedGold, coins: gainedCoins },
      logs
    };
  }
};