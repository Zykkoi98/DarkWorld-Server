// ============================================================================
// ===== 🏰 МОДУЛЬ ФИНАЛИЗАЦИИ БОЕВ И НАГРАД БАШНИ (TOWER_BATTLE_FINISHER.JS) =====
// ============================================================================

const dbHelper = require('../db_helper');

/**
 * Функция финализации боя в Башне и безопасной записи в Supabase
 */
async function finalizeTowerBattleSecure(room, result, sb) {
  try {
    const player = (room && room.teamA && Array.isArray(room.teamA)) ? room.teamA[0] : (room ? room.teamA : null);
    if (!player) {
      console.error("🚨 [TOWER КРИТ] Профиль игрока в комнате Башни не найден!");
      return;
    }

    let gainedXp = 0; 
    let gainedGold = 0;
    let dbHpPayload = Number(player.currentHp || 0);

    // Подтягиваем из db_helper функцию автозаполнения баночек на кукле, если она есть
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
          gainedXp += Number(m.rewardXp || 0); 
          gainedGold += Number(m.rewardGold || 0); 
        });
      }
      player.gold = Number(player.gold || 0) + gainedGold;
      player.xp = Number(player.xp || 0) + gainedXp;
      
      const oldLevel = Number(player.level || 1);
      const correctLevel = dbHelper.getServerCorrectLevelByXp(player.xp);
      
      if (correctLevel > oldLevel) {
        const levelsGained = correctLevel - oldLevel;
        player.statpoints = Number(player.statpoints || player.statPoints || 0) + (levelsGained * 5);
        player.level = correctLevel;
        player.currentHp = dbHelper.getServerMaxHp(player);
      }
      
      dbHpPayload = player.currentHp;

      // НАЧИСЛЯЕМ СЛЕДУЮЩИЙ ЭТАЖ
      updatePayload.tower_floor = Number(room.towerFloor || 1) + 1;
      console.log(`🏰 [БАШНЯ УСПЕХ] Игрок ${player.name} прошел этаж ${room.towerFloor}. Открыт этаж: ${updatePayload.tower_floor}`);

    } else {
      // 💀 ИГРОК ПРОИГРАЛ ИЛИ НИЧЬЯ
      player.currentHp = 0;
      dbHpPayload = Math.max(1, Math.floor(dbHelper.getServerMaxHp(player) * 0.2)); // Воскрешаем на 20% ХП

      // ⏱️ ЗАПИСЫВАЕМ КД НА 3 ЧАСА В ТВОЮ НОВУЮ ТАБЛИЦУ ТАЙМЕРОВ
      const cooldownTime = new Date(Date.now() + 3 * 60 * 60 * 1000); // +3 часа
      
      await sb.from('player_timers').upsert({
        user_id: Number(player.id),
        timer_type: 'tower_cooldown',
        ends_at: cooldownTime.toISOString()
      }, { onConflict: 'user_id,timer_type' });

      console.log(`⏱️ [БД ТАЙМЕР] Записано поражение в Башне. КД повешено для ID ${player.id} до ${cooldownTime.toISOString()}`);
    }

    // Записываем ХП и пушим апдейт игрока в Supabase
    updatePayload.hp = Number(dbHpPayload);
    await sb.from('players').update(updatePayload).eq('id', Number(player.id));
    console.log(`☁️ [БД ТАШНЯ СИНХРОНИЗАЦИЯ] Все награды и КД зафиксированы в облаке.`);

  } catch (err) {
    console.error("❌ Фатальный сбой внутри tower_battle_finisher:", err.message);
  }
}

module.exports = {
  finalizeTowerBattleSecure
};