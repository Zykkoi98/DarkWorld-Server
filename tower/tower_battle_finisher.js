// ============================================================================
// ===== 🏰 ИСПРАВЛЕННЫЙ МОДУЛЬ ФИНАЛИЗАЦИИ БОЕВ БАШНИ (TOWER_BATTLE_FINISHER.JS) =====
// ============================================================================

const dbHelper = require('../db_helper');

async function finalizeTowerBattleSecure(room, result, sb) {
  try {
    const player = (room && room.teamA && Array.isArray(room.teamA) && room.teamA.length > 0) ? room.teamA[0] : null;
    
    if (!player) {
      console.error("🚨 [TOWER КРИТ] Профиль игрока в комнате Башни не найден!");
      return;
    }

    // Подстраховка: если массива логов в комнате нет, создаем его, чтобы сервер не падал
    if (!room.logs) room.logs = [];

    let gainedXp = 0; 
    let gainedGold = 0;
    let gainedTowerCoins = 0;
    let dbHpPayload = Number(player.currentHp || 0);

    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

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
      if (room.teamB && Array.isArray(room.teamB)) {
        room.teamB.forEach(m => { 
          const monsterLevel = Number(m.level || 1);

          // 1. Динамический опыт: База 5 + 3 за уровень
          const monsterXp = 5 + (monsterLevel * 3);
          gainedXp += monsterXp;

          // 2. Динамическое золото: 10% шанс
          if (rand(1, 100) <= 10) {
            gainedGold += monsterLevel;
          }

          // 3. Монеты башни: 30% шанс
          if (rand(1, 100) <= 30) {
            const maxCoins = Math.max(1, Math.ceil(monsterLevel / 2));
            gainedTowerCoins += rand(1, maxCoins);
          }
        });
      }
      
   // 🔥 Запрашиваем из Supabase самый свежий баланс кошелька прямо в секунду триумфа!
const { data: freshPlayerRow } = await sb.from('players')
  .select('gold, xp, tower_coins')
  .eq('id', Number(player.id))
  .maybeSingle();

    // Если база что-то вернула — берем оттуда, если нет — подстраховываемся ОЗУ
    let baseGold = freshPlayerRow ? Number(freshPlayerRow.gold || 0) : Number(player.gold || 0);
    let baseXp = freshPlayerRow ? Number(freshPlayerRow.xp || 0) : Number(player.xp || 0);
    let baseTowerCoins = freshPlayerRow ? Number(freshPlayerRow.tower_coins || 0) : Number(player.tower_coins || 0);

    // Плюсуем заработанный в бою лут строго к СВЕЖИМ цифрам из базы данных
    player.gold = baseGold + gainedGold;
    player.xp = baseXp + gainedXp;
    player.tower_coins = baseTowerCoins + gainedTowerCoins;

    console.log(`🎁 [БАШНЯ ИТОГ НАГРАД] Успешный перерасчет. Свежая база: ${baseTowerCoins}. Награда: +${gainedTowerCoins}. Итог в БД: ${player.tower_coins}`);
      
      // 🔥 ФИКС: Безопасно пишем в room.logs вместо logs
      //room.logs.push(`🏁 <strong>ПОБЕДА!</strong> Награда этажа: 💰 +${gainedGold} золота, 🪙 +${gainedTowerCoins} монет Башни, ✨ +${gainedXp} опыта.`);

      const oldLevel = Number(player.level || 1);
      const correctLevel = dbHelper.getServerCorrectLevelByXp(player.xp);
      
      if (correctLevel > oldLevel) {
        const levelsGained = correctLevel - oldLevel;
        player[pointsKey] = Number(player[pointsKey] || 0) + (levelsGained * 5);
        player.level = correctLevel;
        player.currentHp = dbHelper.getServerMaxHp(player);
        room.logs.push(`🎉 <strong>УРОВЕНЬ ПОВЫШЕН!</strong> Вы достигли ${correctLevel} уровня!`);
      }
      
      dbHpPayload = player.currentHp;

      // НАЧИСЛЯЕМ СЛЕДУЮЩИЙ ЭТАЖ И ПИШЕМ В PAYLOAD
      updatePayload.tower_floor = Number(room.towerFloor || 1) + 1;
      console.log(`🏰 [БАШНЯ УСПЕХ] Игрок ${player.name} прошел этаж ${room.towerFloor}. Открыт этаж: ${updatePayload.tower_floor}`);

      } else {
      // 💀 ИГРОК ПРОИГРАЛ ИЛИ НИЧЬЯ
      player.currentHp = 0;
      dbHpPayload = Math.max(1, Math.floor(dbHelper.getServerMaxHp(player) * 0.2)); // Воскрешаем на 20% ХП

      // 🔥 Запрашиваем из Supabase свежий баланс перед проигрышем, чтобы не списать монеты в NULL
      const { data: freshPlayerRowLose } = await sb.from('players')
        .select('gold, xp, tower_coins')
        .eq('id', Number(player.id))
        .maybeSingle();

      // Намертво фиксируем текущий кошелек, защищая от NULL и NaN
      player.gold = freshPlayerRowLose ? Number(freshPlayerRowLose.gold || 0) : Number(player.gold || 0);
      player.xp = freshPlayerRowLose ? Number(freshPlayerRowLose.xp || 0) : Number(player.xp || 0);
      player.tower_coins = freshPlayerRowLose ? Number(freshPlayerRowLose.tower_coins || 0) : Number(player.tower_coins || 0);

      // ⏱️ ЗАПИСЫВАЕМ КД НА 3 ЧАСА В ТАБЛИЦУ ТАЙМЕРОВ
      const cooldownTime = new Date(Date.now() + 3 * 60 * 60 * 1000); 
      await sb.from('player_timers').upsert({
        user_id: Number(player.id),
        timer_type: 'tower_cooldown',
        ends_at: cooldownTime.toISOString()
      }, { onConflict: 'user_id,timer_type' });

      console.log(`⏱️ [БД ТАЙМЕР] Записано поражение в Башне. КД повешено для ID ${player.id} до ${cooldownTime.toISOString()}`);

      updatePayload.tower_floor = 1; 
      player.tower_floor = 1;
      
      // Пишем лог поражения прямо в комнату
      room.logs.push(`🏁 <strong>ВАС ОДОЛЕЛИ...</strong> Башня сброшена на 1 этаж. Повешено КД на 3 часа.`);
    }
    // Собираем финальный пакет для Supabase со всеми свежими данными
    updatePayload.gold = Number(player.gold);
    updatePayload.xp = Number(player.xp);
    updatePayload.level = Number(player.level);
    updatePayload.hp = Number(dbHpPayload);
    updatePayload.tower_coins = Number(player.tower_coins);
    updatePayload[pointsKey] = Number(player[pointsKey] || 0);
    
    // Записываем финальный результат штурма в облако Supabase
    const { error: dbUpdateErr } = await sb.from('players').update(updatePayload).eq('id', Number(player.id));
    
    if (dbUpdateErr) {
      console.error("🚨 [Supabase SQL Error при сохранении Башни]:", dbUpdateErr.message);
    } else {
      console.log(`☁️ [БД БАШНЯ СИНХРОНИЗАЦИЯ] Все награды, КД и ХП (${dbHpPayload}) зафиксированы в облаке.`);
    }

  } catch (err) {
    console.error("❌ Фатальный сбой внутри tower_battle_finisher:", err.message);
  }
}

module.exports = { finalizeTowerBattleSecure };