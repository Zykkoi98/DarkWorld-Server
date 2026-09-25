// ============================================================================
// ===== 🏰 МОДУЛЬ ФИНАЛИЗАЦИИ БОЕВ И НАГРАД БАШНИ (TOWER_BATTLE_FINISHER.JS) =====
// ============================================================================

const dbHelper = require('../db_helper');

/**
 * Функция финализации боя в Башне и безопасной записи в Supabase
 */
async function finalizeTowerBattleSecure(room, result, sb) {
  try {
    // 🔥 [ЖЕЛЕЗНЫЙ ФИКС БУФЕРА] Извлекаем строго первый объект игрока из массива команды А
    const player = (room && room.teamA && Array.isArray(room.teamA) && room.teamA.length > 0) ? room.teamA[0] : null;
    
    if (!player) {
      console.error("🚨 [TOWER КРИТ] Профиль игрока в комнате Башни не найден!");
      return;
    }

    let gainedXp = 0; 
    let gainedGold = 0;
    let dbHpPayload = Number(player.currentHp || 0);

    // Автодополнение банок на кукле
    if (global.autoRefillPotionsAfterBattle) {
      global.autoRefillPotionsAfterBattle(player);
    }

    // Собираем базовый пакет апдейта для таблицы игроков
    let pointsKey = (player.statpoints !== undefined) ? 'statpoints' : 'statPoints';
    let updatePayload = { 
      gold: Number(player.gold), 
      xp: Number(player.xp), 
      level: Number(player.level), 
      inventory: player.inventory, 
      equipped: player.equipped,   
      [pointsKey]: Number(player.statpoints || player.statPoints || 0) 
    };

    if (result === 'win') {
      // 🏆 ИГРОК ПОБЕДИЛ СТРАЖА
      let gainedXp = 0;
      let gainedGold = 0;
      let gainedTowerCoins = 0; // Наша новая фэнтези-валюта

      const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

      if (room.teamB && Array.isArray(room.teamB)) {
        room.teamB.forEach(m => { 
          const monsterLevel = Number(m.level || 1);

          // 1. ДИНАМИЧЕСКИЙ РАСЧЕТ ОПЫТА: База 5 + по 3 за каждый уровень моба
          const monsterXp = 5 + (monsterLevel * 3);
          gainedXp += monsterXp;

          // 2. ДИНАМИЧЕСКОЕ ЗОЛОТО: 10% шанс на выпадение суммы, равной уровню моба
          if (rand(1, 100) <= 10) {
            gainedGold += monsterLevel;
            console.log(`🎲 [КУБИК ЗОЛОТА] Сработал 10% шанс! Выпало ${monsterLevel} золота с моба ${m.name}`);
          }

          // 3. МОНЕТЫ БАШНИ (ДЛЯ ЛАВКИ ИНКВИЗИТОРА): 30% шанс, количество зависит от уровня
          if (rand(1, 100) <= 30) {
            const maxCoins = Math.max(1, Math.ceil(monsterLevel / 2));
            const coinsDropped = rand(1, maxCoins);
            gainedTowerCoins += coinsDropped;
            console.log(`🎲 [КУБИК МОНЕТ БАШНИ] Сработал 30% шанс! Выпало ${coinsDropped} Монет Башни с моба ${m.name}`);
          }
        });
      }
      
      // Считываем текущую валюту Башни из профиля (если поля ещё нет в БД — ставим 0)
      let currentTowerCoins = Number(player.tower_coins ?? 0);

      // Прибавляем награды к объекту игрока в ОЗУ
      player.gold = Number(player.gold || 0) + gainedGold;
      player.xp = Number(player.xp || 0) + gainedXp;
      player.tower_coins = currentTowerCoins + gainedTowerCoins;

      console.log(`🎁 [БАШНЯ ИТОГ НАГРАД] Собрано динамически: +${gainedGold} золота, +${gainedTowerCoins} монет Башни, +${gainedXp} опыта`);
      logs.push(`🏁 <strong>ПОБЕДА!</strong> Награда этажа: 💰 +${gainedGold} золота, 🪙 +${gainedTowerCoins} монет Башни, ✨ +${gainedXp} опыта.`);

      // Логика повышения уровня игрока (расчет по 5 статпоинтов за лвл)
      const oldLevel = Number(player.level || 1);
      const correctLevel = dbHelper.getServerCorrectLevelByXp(player.xp);
      
      if (correctLevel > oldLevel) {
        const levelsGained = correctLevel - oldLevel;
        let pKey = (player.statpoints !== undefined) ? 'statpoints' : 'statPoints';
        player[pKey] = Number(player[pKey] || 0) + (levelsGained * 5);
        player.level = correctLevel;
        player.currentHp = dbHelper.getServerMaxHp(player);
        logs.push(`🎉 <strong>УРОВЕНЬ ПОВЫШЕН!</strong> Вы достигли ${correctLevel} уровня!`);
      }
      
      dbHpPayload = player.currentHp;

      // Рассчитываем прогрессию этажей (переход на следующий)
      updatePayload.tower_floor = Number(room.towerFloor || 1) + 1;
      
      // Намертво упаковываем все обновленные параметры в payload для Supabase
      let pointsKey = (player.statpoints !== undefined) ? 'statpoints' : 'statPoints';
      updatePayload.gold = Number(player.gold);
      updatePayload.xp = Number(player.xp);
      updatePayload.level = Number(player.level);
      updatePayload[pointsKey] = Number(player[pointsKey] || 0);
      
      // 🔥 ВАЖНО: Добавляем новую колонку валюты Башни в запрос обновления!
      updatePayload.tower_coins = Number(player.tower_coins);

      console.log(`🏰 [БАШНЯ УСПЕХ] Игрок ${player.name} прошел этаж ${room.towerFloor}. Открыт этаж: ${updatePayload.tower_floor}`);

    } else {
      // 💀 ИГРОК ПРОИГРАЛ ИЛИ НИЧЬЯ
      player.currentHp = 0;
      dbHpPayload = Math.max(1, Math.floor(dbHelper.getServerMaxHp(player) * 0.2)); // Воскрешаем на 20% ХП

      // ⏱️ ЗАПИСЫВАЕМ КД НА 3 ЧАСА В ТВОЮ НОВУЮ ТАБЛИЦУ ТАЙМЕРОВ
      const cooldownTime = new Date(Date.now() + 3 * 60 * 60 * 1000); 
      
      await sb.from('player_timers').upsert({
        user_id: Number(player.id),
        timer_type: 'tower_cooldown',
        ends_at: cooldownTime.toISOString()
      }, { onConflict: 'user_id,timer_type' });
      updatePayload.tower_floor = 1; 
      player.tower_floor = 1; // Обнуляем и в ОЗУ комнаты для синхронизации
      console.log(`🏰 [БАШНЯ СБРОС] Прогресс штурма игрока ${player.name} сброшен на 1 этаж!`);
      console.log(`⏱️ [БД ТАЙМЕР] Записано поражение в Башне. КД повешено для ID ${player.id} до ${cooldownTime.toISOString()}`);
    }

    updatePayload.hp = Number(dbHpPayload);
    
    // Записываем финальный результат штурма в облако Supabase
    await sb.from('players').update(updatePayload).eq('id', Number(player.id));
    console.log(`☁️ [БД БАШНЯ СИНХРОНИЗАЦИЯ] Все награды и КД зафиксированы в облаке.`);

  } catch (err) {
    console.error("❌ Фатальный сбой внутри tower_battle_finisher:", err.message);
  }
}

module.exports = { finalizeTowerBattleSecure };