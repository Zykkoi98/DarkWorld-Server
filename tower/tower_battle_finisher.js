const dbHelper = require('../db_helper');

async function finalizeTowerBattleSecure(room, result, sb) {
  try {
    const player = (room && room.teamA && Array.isArray(room.teamA) && room.teamA.length > 0) ? room.teamA[0] : null;
    
    if (!player) {
      console.error("🚨 [TOWER КРИТ] Профиль игрока в комнате Башни не найден!");
      return;
    }

    if (!room.logs) room.logs = [];

    let gainedXp = 0; 
    let gainedGold = 0;
    let gainedTowerCoins = 0;
    let dbHpPayload = Number(player.currentHp || 0);

    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    // 1. 🔥 [ЖЕЛЕЗНЫЙ АНТИ-ОТКАТ]: Запрашиваем САМЫЙ свежий профиль игрока из Supabase
    // прямо в секунду триумфа/поражения, чтобы не затереть покупки из Магазина!
    const { data: freshDbPlayer, error: fetchErr } = await sb.from('players')
      .select('*')
      .eq('id', Number(player.id))
      .maybeSingle();

    if (fetchErr || !freshDbPlayer) {
      console.error("🚨 [TOWER КРИТ] Не удалось прочитать свежий профиль из БД для синхронизации!");
      return;
    }

    // Извлекаем актуальные на эту микросекунду данные кошелька и инвентаря
    let baseGold = Number(freshDbPlayer.gold || 0);
    let baseXp = Number(freshDbPlayer.xp || 0);
    let baseTowerCoins = Number(freshDbPlayer.tower_coins || 0);
    let currentDbLevel = Number(freshDbPlayer.level || 1);
    
    // Берем актуальный инвентарь и куклу из базы, а не из старого ОЗУ боя!
    let liveInventory = freshDbPlayer.inventory || { equipment: [], resources: [], consumables: [] };
    let liveEquipped = freshDbPlayer.equipped || { rings: [null, null, null] };

    // Подменяем ссылки в ОЗУ комнаты, чтобы автодополнение банок работало с живой сумкой
    player.inventory = liveInventory;
    player.equipped = liveEquipped;
    
    if (global.autoRefillPotionsAfterBattle) {
      global.autoRefillPotionsAfterBattle(player);
    }

    let pointsKey = (freshDbPlayer.statpoints !== undefined) ? 'statpoints' : 'statPoints';
    let currentDbStatPoints = Number(freshDbPlayer[pointsKey] || 0);

    // Готовим базовый пакет апдейта
    let updatePayload = {
      inventory: player.inventory, // Теперь тут легально дополненные банки без отката шмота!
      equipped: player.equipped
    };

    if (result === 'win') {
      // 🏆 РАСЧЕТ НАГРАДЫ ПРИ ПОБЕДЕ
      if (room.teamB && Array.isArray(room.teamB)) {
        room.teamB.forEach(m => { 
          const monsterLevel = Number(m.level || 1);
          const monsterXp = (m.rewardXp !== undefined) ? Number(m.rewardXp) : (5 + (monsterLevel * 3));
          gainedXp += monsterXp;

          if (m.rewardGold !== undefined) {
            gainedGold += Number(m.rewardGold);
          } else if (rand(1, 100) <= 10) {
            gainedGold += monsterLevel;
          }

          if (rand(1, 100) <= 30) {
            let maxCoins = 1 + Math.floor((monsterLevel - 1) / 5);
            const isBoss = (m.rewardXp !== undefined && String(m.id).includes('boss'));
            if (isBoss) maxCoins = maxCoins * 2;
            gainedTowerCoins += rand(1, Math.max(1, maxCoins));
          }
        });
      }

      room.gainedXpLocal = gainedXp;
      room.gainedGoldLocal = gainedGold;
      room.gainedCoinsLocal = gainedTowerCoins;

      // Плюсуем лут строго к СВЕЖИМ цифрам из базы данных
      updatePayload.gold = baseGold + gainedGold;
      updatePayload.xp = baseXp + gainedXp;
      updatePayload.tower_coins = baseTowerCoins + gainedTowerCoins;

      // Проверка левелапа по свежему опыту
      const correctLevel = dbHelper.getServerCorrectLevelByXp(updatePayload.xp);
      if (correctLevel > currentDbLevel) {
        const levelsGained = correctLevel - currentDbLevel;
        updatePayload[pointsKey] = currentDbStatPoints + (levelsGained * 5);
        updatePayload.level = correctLevel;
        
        // Восстанавливаем ХП до фулла при левелапе
        const virtualPlayer = { endurance: Number(freshDbPlayer.endurance || 1), equipped: player.equipped };
        updatePayload.hp = dbHelper.getServerMaxHp(virtualPlayer);
      } else {
        updatePayload.level = currentDbLevel;
        updatePayload[pointsKey] = currentDbStatPoints;
        updatePayload.hp = player.currentHp; // Игрок выжил, сохраняем остаток ХП
      }

      // Начисляем следующий этаж Башни
      updatePayload.tower_floor = Number(room.towerFloor || 1) + 1;
      console.log(` Lancaster 🏰 [БАШНЯ УСПЕХ] Открыт новый этаж: ${updatePayload.tower_floor}`);

    } else {
      // 💀 РАСЧЕТ ПРИ ПОРАЖЕНИИ
      // Записываем КД на 3 часа в таблицу таймеров
      const cooldownTime = new Date(Date.now() + 3 * 60 * 60 * 1000); 
      await sb.from('player_timers').upsert({
        user_id: Number(player.id),
        timer_type: 'tower_cooldown',
        ends_at: cooldownTime.toISOString()
      }, { onConflict: 'user_id,timer_type' });

      // Защищаем кошелек от откатов при проигрыше
      updatePayload.gold = baseGold;
      updatePayload.xp = baseXp;
      updatePayload.tower_coins = baseTowerCoins;
      updatePayload.level = currentDbLevel;
      updatePayload[pointsKey] = currentDbStatPoints;
      
      // Воскрешаем на 20% ХП от свежего капа выносливости
      const virtualPlayerLose = { endurance: Number(freshDbPlayer.endurance || 1), equipped: player.equipped };
      updatePayload.hp = Math.max(1, Math.floor(dbHelper.getServerMaxHp(virtualPlayerLose) * 0.2));

      // Башня сбрасывается на 1 этаж
      updatePayload.tower_floor = 1; 
    }

    // Записываем финальный бронированный пакет в облако Supabase
    const { error: dbUpdateErr } = await sb.from('players').update(updatePayload).eq('id', Number(player.id));
    
    if (dbUpdateErr) {
      console.error("🚨 [Supabase SQL Error при сохранении Башни]:", dbUpdateErr.message);
    } else {
      console.log(`☁️ [БД БАШНЯ СИНХРОНИЗАЦИЯ] Успешно сохранено без откатов Магазина.`);
    }

  } catch (err) {
    console.error("❌ Фатальный сбой внутри файла tower_battle_finisher:", err.message);
  }
}

module.exports = { finalizeTowerBattleSecure };