// ============================================================================
// ===== 🛡️ МОДУЛЬ СЕРВЕРНОГО АУДИТА, БАЗЫ ДАННЫХ И АНТИЧИТА (DB_HELPER.JS) =====
// ===== ЧАСТЬ 1 ИЗ 2: БАЗЫ ДАННЫХ, МАТЕМАТИКА И СИНХРОНИЗАЦИЯ ПРОФИЛЯ =====
// ============================================================================

// Глобальная серверная таблица порогов опыта (XP_TABLE)
const SERVER_XP_TABLE = [
  0, 0, 20, 70, 170, 370, 770, 1570, 3070, 5570, 9570
];

// База характеристик предметов для честного расчёта боевых параметров
const ITEMS_STAT_DB = {
  'rusty_sword':    { atk: 2 },
  'iron_sword':     { atk: 7 },
  'steel_mace':     { atk: 12 },
  'heavy_halberd':  { atk: 22 },
  'wooden_shield':  { def: 2 },
  'leather_cap':    { def: 1, agility: 1 },
  'leather_armor':  { def: 4 },
  'leather_boots':  { def: 1, agility: 2 },
  'leather_gloves': { def: 1, strength: 1 },
  'copper_ring':    { endurance: 1 },
  'wolf_amulet':    { strength: 2, luck: 1 },
  'lucky_ring':     { luck: 3 },
  'ruby_ring':      { strength: 3 }
};

// Функция расчета серверного уровня по опыту
function getServerCorrectLevelByXp(xp) {
  for (let lvl = SERVER_XP_TABLE.length - 1; lvl >= 1; lvl--) {
    if (xp >= SERVER_XP_TABLE[lvl]) return lvl;
  }
  return 1;
}

// Вспомогательная функция для сбора бонусов со всей куклы персонажа
function getEquipmentBonus(equipped, bonusKey) {
  if (!equipped) return 0;
  let totalBonus = 0;
  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand', 'extra'];
  
  slots.forEach(slot => {
    const itemId = equipped[slot];
    if (itemId && ITEMS_STAT_DB[itemId]) {
      const item = ITEMS_STAT_DB[itemId];
      if (item[bonusKey] !== undefined) totalBonus += item[bonusKey];
    }
  });

  if (equipped.rings && Array.isArray(equipped.rings)) {
    equipped.rings.forEach(itemId => {
      if (itemId && ITEMS_STAT_DB[itemId] && ITEMS_STAT_DB[itemId][bonusKey] !== undefined) {
        totalBonus += ITEMS_STAT_DB[itemId][bonusKey];
      }
    });
  }
  return totalBonus;
}

// Честный расчёт максимального здоровья на сервере
function getServerMaxHp(fighter) {
  const baseEndurance = Number(fighter.endurance || 1);
  const gearEndurance = getEquipmentBonus(fighter.equipped, 'endurance');
  const totalEndurance = baseEndurance + gearEndurance;
  const armorHp = getEquipmentBonus(fighter.equipped, 'hp');
  return (totalEndurance * 10) + armorHp;
}

// Утилита для чтения полей из Supabase без привязки к регистру букв
const safeReadField = (dbRow, fieldName, defaultValue = 0) => {
  if (!dbRow) return defaultValue;
  const lowerName = fieldName.toLowerCase();
  const upperName = fieldName.toUpperCase();
  const capitalizedName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  return Number(dbRow[lowerName] ?? dbRow[upperName] ?? dbRow[capitalizedName] ?? dbRow[fieldName] ?? defaultValue);
};

// Функция-сборщик легального профиля для отправки на игровой клиент
async function triggerLoadGameSuccess(nUserId, socket, sb) {
  const { data } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
  if (!data) return;

  const currentXp = safeReadField(data, 'xp', 0);
  const cloudLevel = getServerCorrectLevelByXp(currentXp);
  let pointsKey = data.statpoints !== undefined ? 'statpoints' : 'statPoints';

  const playerProfile = {
    id: data.id,
    name: data.name,
    avatar: data.avatar || "assets/avatars/hero1.png",
    level: cloudLevel,
    gold: safeReadField(data, 'gold', 0),
    xp: currentXp,
    hp: safeReadField(data, 'hp', 10),
    statPoints: safeReadField(data, pointsKey, 0),
    currentTownIndex: safeReadField(data, 'currenttownindex', 0),
    stats: {
      strength: safeReadField(data, 'strength', 1),
      agility: safeReadField(data, 'agility', 1),
      endurance: safeReadField(data, 'endurance', 1),
      intellect: safeReadField(data, 'intellect', 1),
      luck: safeReadField(data, 'luck', 1)
    },
    inventory: data.inventory || { equipment: [], resources: [], consumables: [] },
    equipped: data.equipped || { rings: [null, null, null] }
  };

  socket.emit('load_game_success', { player: playerProfile });
}
// ============================================================================
// ===== 🛡️ МОДУЛЬ СЕРВЕРНОГО АУДИТА, БАЗЫ ДАННЫХ И АНТИЧИТА (DB_HELPER.JS) =====
// ===== ЧАСТЬ 2 ИЗ 2: СЛУШАТЕЛИ СОКЕТОВ И АЛГОРИТМЫ ПРОВЕРКИ АНТИЧИТА =====
// ============================================================================

// Экспорт серверных слушателей сокетов и привязка к ядру
module.exports = function(io, socket, sb) {
  
  // Экспортируем внутренние методы модуля для использования в других файлах бэкенда
  module.exports.getServerMaxHp = getServerMaxHp;
  module.exports.triggerLoadGameSuccess = triggerLoadGameSuccess;
  module.exports.getServerCorrectLevelByXp = getServerCorrectLevelByXp;
  module.exports.safeReadField = safeReadField;

  // --- 1. ЗАЩИЩЕННАЯ ЗАГРУЗКА И АНТИЧИТ-АУДИТ ПРИ ВХОДЕ ---
  socket.on('load_game_secure', async ({ userId, username }) => {
    try {
      const nUserId = Number(userId);
      console.log(`🔍 [АУДИТ ВХОДА] Проверка игрока ID: ${nUserId} (${username})...`);

      const { data, error } = await sb.from('players').select('*').eq('id', nUserId);
      if (error) return socket.emit('load_game_failed', { message: error.message });

      if (data && data.length > 0) {
        let cloudPlayer = data[0]; 
        
        const currentXp = safeReadField(cloudPlayer, 'xp', 0);
        const correctLevel = getServerCorrectLevelByXp(currentXp);
        const dbLevel = safeReadField(cloudPlayer, 'level', 1);

        const str = safeReadField(cloudPlayer, 'strength', 1);
        const agi = safeReadField(cloudPlayer, 'agility', 1);
        const end = safeReadField(cloudPlayer, 'endurance', 1);
        const int = safeReadField(cloudPlayer, 'intellect', 1);
        const lck = safeReadField(cloudPlayer, 'luck', 1);
        
        let pointsKey = cloudPlayer.statpoints !== undefined ? 'statpoints' : 'statPoints';
        const freePoints = safeReadField(cloudPlayer, pointsKey, 0);

        const totalFighterPoints = str + agi + end + int + lck + freePoints;
        const maxLegalPoints = 5 + 5 + ((correctLevel - 1) * 5); // 5 базовых + 5 стартовых + 5 за каждый левел-ап

        let needsDbSync = false;
        let updatePayload = {};

        // Проверка накрутки очков или несоответствия уровня
        if (dbLevel !== correctLevel || totalFighterPoints > maxLegalPoints) {
          console.warn(`🚨 [АНТИЧИТ ЗАРЕГИСТРИРОВАЛ ЧИТ/СБОЙ] Сброс на легальную норму уровня ${correctLevel}`);
          
          let levelKey = cloudPlayer.level !== undefined ? 'level' : 'Level';
          let hpKey = cloudPlayer.hp !== undefined ? 'hp' : 'hp';
          const statsKeys = ['strength', 'agility', 'endurance', 'intellect', 'luck'];
          
          statsKeys.forEach(key => {
            let finalKey = cloudPlayer[key] !== undefined ? key : key.toLowerCase();
            updatePayload[finalKey] = 1;
          });

          updatePayload[levelKey] = correctLevel;
          updatePayload[pointsKey] = maxLegalPoints - 5; // Все свободные очки возвращаются искателю
          
          const freshMaxHp = getServerMaxHp({ endurance: 1, equipped: cloudPlayer.equipped || {} });
          updatePayload[hpKey] = freshMaxHp;

          needsDbSync = true;
        }

        if (needsDbSync) {
          await sb.from('players').update(updatePayload).eq('id', nUserId);
        }

        await triggerLoadGameSuccess(nUserId, socket, sb);
      } else {
        socket.emit('player_not_found', { userId, username });
      }
    } catch (err) {
      console.error(err);
      socket.emit('load_game_failed', { message: err.message });
    }
  });

  // --- 2. БЕЗОПАСНОЕ РАСПРЕДЕЛЕНИЕ ХАРАКТЕРИСТИК ИЗ БУФЕРА ---
  socket.on('confirm_stat_distribution_secure', async ({ userId, distribution }) => {
    try {
      const nUserId = Number(userId);
      if (!distribution) return socket.emit('stat_distribution_error', 'Данные распределения пусты.');

      const { data: dbPlayer } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      if (!dbPlayer) return socket.emit('stat_distribution_error', 'Персонаж не найден.');

      const currentXp = safeReadField(dbPlayer, 'xp', 0);
      const cloudLevel = getServerCorrectLevelByXp(currentXp);

      let totalSpentNow = 0;
      const statsKeys = ['strength', 'agility', 'endurance', 'intellect', 'luck'];
      for (const key of statsKeys) {
        const spent = Number(distribution[key] || 0);
        if (spent < 0) return socket.emit('stat_distribution_error', '🚨 Обнаружено отрицательное значение стата!');
        totalSpentNow += spent;
      }

      if (totalSpentNow === 0) return socket.emit('stat_distribution_error', 'Вы не выбрали статы.');

      const totalDbStatsSum = safeReadField(dbPlayer, 'strength', 1) + safeReadField(dbPlayer, 'agility', 1) + 
                             safeReadField(dbPlayer, 'endurance', 1) + safeReadField(dbPlayer, 'intellect', 1) + 
                             safeReadField(dbPlayer, 'luck', 1);
      
      let finalPointsKey = dbPlayer.statpoints !== undefined ? 'statpoints' : 'statPoints';
      const currentDbFreePoints = safeReadField(dbPlayer, finalPointsKey, 0);
      const maxLegalTotalPoints = 5 + 5 + ((cloudLevel - 1) * 5);
      const projectedTotal = totalDbStatsSum + totalSpentNow + (currentDbFreePoints - totalSpentNow);

      if (projectedTotal > maxLegalTotalPoints || totalSpentNow > currentDbFreePoints) {
        return socket.emit('stat_distribution_error', '🚨 Ошибка безопасности: Лимит очков превышен!');
      }

      const updatePayload = { [finalPointsKey]: currentDbFreePoints - totalSpentNow };

      statsKeys.forEach(key => {
        let finalKey = dbPlayer[key] !== undefined ? key : key.toLowerCase();
        updatePayload[finalKey] = safeReadField(dbPlayer, key, 1) + (Number(distribution[key]) || 0);
      });

      const addedEnd = Number(distribution.endurance) || 0;
      if (addedEnd > 0) {
        let hpKey = dbPlayer.hp !== undefined ? 'hp' : 'hp';
        updatePayload[hpKey] = safeReadField(dbPlayer, 'hp', 10) + (addedEnd * 10);
      }

      await sb.from('players').update(updatePayload).eq('id', nUserId);
      await triggerLoadGameSuccess(nUserId, socket, sb);
    } catch (err) {
      console.error(err);
      socket.emit('stat_distribution_error', 'Внутренняя ошибка сервера.');
    }
  });
};
