// ============================================================================
// ===== 🛡️ МОДУЛЬ СЕРВЕРНОГО АУДИТА, БАЗЫ ДАННЫХ И АНТИЧИТА (DB_HELPER.JS) =====
// ===== ЧАСТЬ 1 ИЗ 2: БАЗЫ ДАННЫХ, МАТЕМАТИКА И СИНХРОНИЗАЦИЯ ПРОФИЛЯ =====
// ============================================================================

// Глобальная серверная таблица порогов опыта (XP_TABLE)
const SERVER_XP_TABLE = [
  0, 0, 20, 70, 170, 370, 770, 1570, 3070, 5570, 9570
];
// База характеристик предметов для честного расчёта боевых параметров на бэкенде
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
  'copper_ring':    { toughness: 1 }, // Кольцо теперь дает Стойкость вместо Выносливости
  'wolf_amulet':    { strength: 2, luck: 1 },
  'lucky_ring':     { luck: 3 },
  'ruby_ring':      { strength: 3 }
};

// Функция расчета серверного уровня по накопленному опыту
function getServerCorrectLevelByXp(xp) {
  for (let lvl = SERVER_XP_TABLE.length - 1; lvl >= 1; lvl--) {
    if (xp >= SERVER_XP_TABLE[lvl]) return lvl;
  }
  return 1;
}

// Вспомогательная утилита для сбора бонусов характеристик со всей экипировки куклы
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

// 🔥 ФИКС ВЫНОСЛИВОСТИ: Рассчитывает ТОЛЬКО чистые очки здоровья (HP), без влияния на защиту
function getServerMaxHp(fighter) {
  const baseEndurance = Number(fighter.endurance || 1);
  const gearEndurance = getEquipmentBonus(fighter.equipped, 'endurance');
  const totalEndurance = baseEndurance + gearEndurance;
  const armorHp = getEquipmentBonus(fighter.equipped, 'hp');
  return (totalEndurance * 10) + armorHp;
}

// 🔥 ВНЕДРЕНИЕ СТОЙКОСТИ: Базовая броня (def) теперь зависит строго от Toughness (или интеллекта как кэша)
function getServerDef(fighter) {
  const baseToughness = Number(fighter.toughness || 1);
  const gearToughness = getEquipmentBonus(fighter.equipped, 'toughness');
  const totalToughness = baseToughness + gearToughness;

  // Каждая единица Стойкости увеличивает защиту на 1.0 ед.
  const baseDef = Math.floor(totalToughness * 1.0); 
  const armorDef = getEquipmentBonus(fighter.equipped, 'def');
  return baseDef + armorDef;
}

// Робот-сканер для безопасного чтения полей Supabase в любом регистре букв
const safeReadField = (dbRow, fieldName, defaultValue = 0) => {
  if (!dbRow) return defaultValue;
  const lowerName = fieldName.toLowerCase();
  const upperName = fieldName.toUpperCase();
  const capitalizedName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  return Number(dbRow[lowerName] ?? dbRow[upperName] ?? dbRow[capitalizedName] ?? dbRow[fieldName] ?? defaultValue);
};
// Функция-сборщик легального профиля для отправки на игровой клиент
async function triggerLoadGameSuccess(nUserId, socket, sb) {
  try {
    const { data, error } = await sb.from('players').select('*').eq('id', nUserId);
    if (error || !data || data.length === 0) {
      console.error("❌ Игрок не найден в БД при триггере успеха:", error);
      return;
    }

    const row = data[0]; // Исправлено: читаем первый элемент массива
    const currentXp = safeReadField(row, 'xp', 0);
    const cloudLevel = getServerCorrectLevelByXp(currentXp);
    let pointsKey = row.statpoints !== undefined ? 'statpoints' : 'statPoints';

    const playerProfile = {
      id: row.id,
      name: row.name,
      avatar: row.avatar || "assets/avatars/hero1.png",
      level: cloudLevel,
      gold: safeReadField(row, 'gold', 0),
      xp: currentXp,
      hp: safeReadField(row, 'hp', 10),
      statPoints: safeReadField(row, pointsKey, 0),
      currentTownIndex: safeReadField(row, 'currenttownindex', 0),
      stats: {
        strength: safeReadField(row, 'strength', 1),
        agility: safeReadField(row, 'agility', 1),
        endurance: safeReadField(row, 'endurance', 1),
        toughness: safeReadField(row, 'toughness', 1), // Чистая стойкость
        luck: safeReadField(row, 'luck', 1)
      },
      inventory: row.inventory || { equipment: [], resources: [], consumables: [] },
      equipped: row.equipped || { rings: [null, null, null] }
    };

    console.log(`📤 [УСПЕХ] Профиль отправлен клиенту: ${playerProfile.name} (Ур. ${playerProfile.level})`);
    socket.emit('load_game_success', { player: playerProfile });
  } catch (err) {
    console.error("❌ Критический сбой внутри триггера load_game_success:", err);
  }
}

// Экспортируем методы наружу для использования в других файлах бэкенда
module.exports = {
  getServerMaxHp,
  getServerDef,
  getServerCorrectLevelByXp,
  safeReadField,
  triggerLoadGameSuccess,
  
  // Главный инициализатор сокет-обработчиков
  init: function(io, socket, sb) {

     // --- 1. ЗАЩИЩЕННАЯ ЗАГРУЗКА И АНТИЧИТ-АУДИТ ПРИ ВХОДЕ ---
    socket.on('load_game_secure', async ({ userId, username }) => {
      try {
        const nUserId = Number(userId);
        console.log(`🔍 [АУДИТ ВХОДА] Проверка игрока ID: ${nUserId} (${username})...`);

        // 🔥 ИСПРАВЛЕНО: Используем .maybeSingle() вместо .single()
        // Теперь если в базе пусто, код не вылетит, а пойдет дальше!
        const { data: cloudPlayer, error } = await sb.from('players')
          .select('*')
          .eq('id', nUserId)
          .maybeSingle();

        if (error) {
          console.error("🚨 Ошибка запроса к Supabase:", error.message);
          return socket.emit('load_game_failed', { message: error.message });
        }

        // Если нашли персонажа в базе — загружаем и проверяем античитом
        if (cloudPlayer) {
          
          const currentXp = safeReadField(cloudPlayer, 'xp', 0);
          const correctLevel = getServerCorrectLevelByXp(currentXp);
          const dbLevel = safeReadField(cloudPlayer, 'level', 1);

          const str = safeReadField(cloudPlayer, 'strength', 1);
          const agi = safeReadField(cloudPlayer, 'agility', 1);
          const end = safeReadField(cloudPlayer, 'endurance', 1);
          const lck = safeReadField(cloudPlayer, 'luck', 1);
          
          let pointsKey = cloudPlayer.statpoints !== undefined ? 'statpoints' : 'statPoints';
          const freePoints = safeReadField(cloudPlayer, pointsKey, 0);

          const totalFighterPoints = str + agi + end + lck + freePoints;
          const maxLegalPoints = 5 + 5 + ((correctLevel - 1) * 5); 

          let needsDbSync = false;
          let updatePayload = {};

          if (dbLevel !== correctLevel || totalFighterPoints > maxLegalPoints) {
            console.warn(`🚨 [АНТИЧИТ] Сброс на легальную норму уровня ${correctLevel}`);
            const statsKeys = ['strength', 'agility', 'endurance', 'luck'];
            
            statsKeys.forEach(key => {
              updatePayload[key] = 1;
            });

            updatePayload[cloudPlayer.level !== undefined ? 'level' : 'level'] = correctLevel;
            updatePayload[pointsKey] = maxLegalPoints - 5; 
            updatePayload['hp'] = getServerMaxHp({ endurance: 1, equipped: cloudPlayer.equipped || {} });

            needsDbSync = true;
          }

          if (needsDbSync) {
            await sb.from('players').update(updatePayload).eq('id', nUserId);
          }

          await triggerLoadGameSuccess(nUserId, socket, sb);

        } else {
          // 🔥 ТЕПЕРЬ СРАБОТАЕТ СЮДА: Если записей в БД вообще нет, шлём клиенту сигнал создать новичка!
          console.log(`🆕 Игрок не найден в базе. Отправляем сигнал 'player_not_found'...`);
          socket.emit('player_not_found', { userId: nUserId, username: username });
        }

      } catch (err) {
        console.error("❌ Критическая ошибка при загрузке игры на сервере:", err);
        socket.emit('load_game_failed', { message: err.message });
      }
    });
    // ОБРАБОТЧИК: БЕЗОПАСНОЕ СОХРАНЕНИЕ / СОЗДАНИЕ ПЕРСОНАЖА В БД
    socket.on('save_game_secure', async ({ player }) => {
      try {
        if (!player || !player.id) return;
        const nUserId = Number(player.id);
        
        console.log(`💾 [БД СОХРАНЕНИЕ] Запись профиля игрока ID: ${nUserId} (${player.name})...`);

        // Готовим чистый пакет для вставки/обновления в Supabase
        const payload = {
          id: nUserId,
          name: player.name,
          avatar: player.avatar || "assets/avatars/hero1.png",
          level: Number(player.level || 1),
          gold: Number(player.gold || 50),
          xp: Number(player.xp || 0),
          hp: Number(player.hp || 10),
          statpoints: Number(player.statPoints || player.statpoints || 5),
          currenttownindex: Number(player.currentTownIndex || 0),
          strength: Number(player.stats?.strength || 1),
          agility: Number(player.stats?.agility || 1),
          endurance: Number(player.stats?.endurance || 1),
          luck: Number(player.stats?.luck || 1),
          inventory: player.inventory || { equipment: [], resources: [], consumables: [] },
          equipped: player.equipped || { rings: [null, null, null] }
        };

        // Делаем атомарный upsert (если нет строки — создаст, если есть — обновит)
        const { error } = await sb.from('players').upsert(payload).eq('id', nUserId);
        
        if (error) {
          console.error(`🚨 Ошибка сохранения в Supabase для ID ${nUserId}:`, error.message);
        } else {
          console.log(`✨ [БД УСПЕХ] Персонаж ${player.name} успешно сохранен/создан в Supabase.`);
        }
      } catch (err) {
        console.error("❌ Критический сбой при обработке save_game_secure:", err);
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
        const statsKeys = ['strength', 'agility', 'endurance', 'toughness', 'luck'];
        for (const key of statsKeys) {
          const spent = Number(distribution[key] || 0);
          if (spent < 0) return socket.emit('stat_distribution_error', '🚨 Обнаружено отрицательное значение стата!');
          totalSpentNow += spent;
        }

        if (totalSpentNow === 0) return socket.emit('stat_distribution_error', 'Вы не выбрали статы.');

        const totalDbStatsSum = safeReadField(dbPlayer, 'strength', 1) + safeReadField(dbPlayer, 'agility', 1) + 
                               safeReadField(dbPlayer, 'endurance', 1) + safeReadField(dbPlayer, 'toughness', 1) + safeReadField(dbPlayer, 'luck', 1);
        
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
          let spent = Number(distribution[key]) || 0;
          
          const currentVal = safeReadField(dbPlayer, key, 1);
          updatePayload[finalKey] = currentVal + spent;
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
  }
};