// ============================================================================
// ===== 🛡️ МОДУЛЬ СЕРВЕРНОГО АУДИТА, БАЗЫ ДАННЫХ И АНТИЧИТА (DB_HELPER.JS) =====
// ===== ЧАСТЬ 1 ИЗ 2: БАЗЫ ДАННЫХ, МАТЕМАТИКА И СИНХРОНИЗАЦИЯ ПРОФИЛЯ =====
// ============================================================================

// Глобальная серверная таблица порогов опыта (XP_TABLE)
const GAME_ITEMS_DATABASE = require('./shop/shop_items_config');
const SERVER_XP_TABLE = [
  0, 
  0,     // 1 ур
  200,    // 2 ур
  700,    // 3 ур
  1700,   // 4 ур
  3700,   // 5 ур
  7700,   // 6 ур
  15700,  // 7 ур
  30700,  // 8 ур
  55700,  // 9 ур
  95700,  // 10 ур
  155700, // 11 ур
  235700, // 12 ур
  345700, // 13 ур
  495700, // 14 ур
  695700, // 15 ур
  945700, // 16 ур. 
  1295700,// 17 ур
  1745700,// 18 ур
  2345700,// 19 ур
  3145700 // 20 ур
];

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
  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand', 'extra', 'potion', 'scroll'];
  
  slots.forEach(slot => {
    const itemId = equipped[slot];
    if (!itemId) return;

    // 🔥 ФИКС: Ищем предмет сначала в старой базе, а затем в нашем новом глобальном конфиге
    let item =  GAME_ITEMS_DATABASE[itemId];

    if (item) {
      // Проверяем старый формат (если статы лежат на верхнем уровне объекта)
      if (item[bonusKey] !== undefined) totalBonus += item[bonusKey];
      
      // 🔥 Проверяем новый формат (если статы лежат внутри объекта bonus, как на фронтенде)
      if (item.bonus) {
        if (item.bonus[bonusKey] !== undefined) totalBonus += item.bonus[bonusKey];
        if (item.bonus.stats && item.bonus.stats[bonusKey] !== undefined) {
          totalBonus += item.bonus.stats[bonusKey];
        }
      }
    }
  });

  // Обсчет колец в слотах бижутерии
  if (equipped.rings && Array.isArray(equipped.rings)) {
    equipped.rings.forEach(itemId => {
      if (!itemId) return;
      let item =  GAME_ITEMS_DATABASE[itemId];
      if (item) {
        if (item[bonusKey] !== undefined) totalBonus += item[bonusKey];
        if (item.bonus) {
          if (item.bonus[bonusKey] !== undefined) totalBonus += item.bonus[bonusKey];
          if (item.bonus.stats && item.bonus.stats[bonusKey] !== undefined) {
            totalBonus += item.bonus.stats[bonusKey];
          }
        }
      }
    });
  }
  return totalBonus;
}

// 🔥 ФИКС ВЫНОСЛИВОСТИ: Рассчитывает ТОЛЬКО чистые очки здоровья (HP), без влияния на защиту
function getServerMaxHp(fighter) {
  const baseEndurance = Number(fighter.endurance || 1);
  return ((baseEndurance + getEquipmentBonus(fighter.equipped, 'endurance')) * 10) + (getEquipmentBonus(fighter.equipped, 'hp') || 0);
}

function getServerDef(fighter) {
  const baseEndurance = Number(fighter.endurance || 1);
  return Math.floor((baseEndurance + getEquipmentBonus(fighter.equipped, 'endurance')) * 0.5) + (getEquipmentBonus(fighter.equipped, 'def') || 0);
}
// Новые функции сбора скрытых боевых модификаторов (статы + шмот)
function getServerMfInv(fighter) { return (Number(fighter.agility || 1) * 10) + getEquipmentBonus(fighter.equipped, 'mf_inv'); }
function getServerMfAntiInv(fighter) { return (Number(fighter.agility || 1) * 4) + getEquipmentBonus(fighter.equipped, 'mf_antiinv'); }
function getServerMfCrit(fighter) { return (Number(fighter.luck || 1) * 10) + getEquipmentBonus(fighter.equipped, 'mf_crit'); }
function getServerMfAntiCrit(fighter) { return (Number(fighter.luck || 1) * 4) + getEquipmentBonus(fighter.equipped, 'mf_anticrit'); }

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
      equipped: row.equipped || { rings: [null, null, null] },
      tower_coins: safeReadField(row, 'tower_coins', 0)
    };

    console.log(`📤 [УСПЕХ] Профиль отправлен клиенту: ${playerProfile.name} (Ур. ${playerProfile.level})`);
    socket.emit('load_game_success', { player: playerProfile });
  } catch (err) {
    console.error("❌ Критический сбой внутри триггера load_game_success:", err);
  }
}
// 🔥 [АНТИЧИТ-ФИКС]: Серверная проверка куклы. Снимает вещи в рюкзак, если статы игрока упали!
function enforceEquipmentRequirements(cloudPlayer) {
  if (!cloudPlayer || !cloudPlayer.equipped) return false;

  let equipped = cloudPlayer.equipped;
  if (!cloudPlayer.inventory) cloudPlayer.inventory = { equipment: [], resources: [], consumables: [] };
  let inventory = cloudPlayer.inventory;
  if (!Array.isArray(inventory.equipment)) inventory.equipment = [];

  // 🔥 ЖЕЛЕЗНЫЙ ФИКС ЧТЕНИЯ: Вызываем твою безопасную утилиту safeReadField!
  // Теперь статы гарантированно прочитаются из Supabase как точные числа, без undefined!
  const myStr = safeReadField(cloudPlayer, 'strength', 1);
  const myAgi = safeReadField(cloudPlayer, 'agility', 1);
  const myEnd = safeReadField(cloudPlayer, 'endurance', 1);
  const myLuck = safeReadField(cloudPlayer, 'luck', 1);
  const myLvl = safeReadField(cloudPlayer, 'level', 1);

  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand', 'extra'];
  let wasAnythingUnequipped = false;

  slots.forEach(slot => {
    const itemId = equipped[slot];
    if (!itemId) return;

    const itemData = GAME_ITEMS_DATABASE[itemId];
    if (!itemData) return;

    let isItemLegal = true;

    // 1. Проверяем требование по уровню
    if (itemData.level && myLvl < Number(itemData.level)) isItemLegal = false;

    // 2. 🔥 БРОНИРОВАННАЯ ПРОВЕРА СТАТОВ: Считываем требования и из объекта req, 
    // и по старым плоским ключам (reqAgility, reqEndurance) из конфигов магазина!
    const reqStr = itemData.req?.strength ?? itemData.reqStrength ?? 0;
    const reqAgi = itemData.req?.agility ?? itemData.reqAgility ?? 0;
    const reqEnd = itemData.req?.endurance ?? itemData.reqEndurance ?? 0;
    const reqLuck = itemData.req?.luck ?? itemData.reqLuck ?? 0;

    if (reqStr > 0 && myStr < Number(reqStr)) isItemLegal = false;
    if (reqAgi > 0 && myAgi < Number(reqAgi)) isItemLegal = false;
    if (reqEnd > 0 && myEnd < Number(reqEnd)) isItemLegal = false;
    if (reqLuck > 0 && myLuck < Number(reqLuck)) isItemLegal = false;

    // Если вещь не подходит по характеристикам — принудительно снимаем
    if (!isItemLegal) {
      console.warn(`🚨 [АНТИЧИТ КУКЛЫ] Снимаем "${itemData.name}" из слота ${slot}. Статы: 💪${myStr} 🏹${myAgi} 🛡️${myEnd} 🍀${myLuck}`);
      inventory.equipment.push({ uuid: `${itemId}_force_${Date.now()}`, id: itemId });
      equipped[slot] = null;
      wasAnythingUnequipped = true;
    }
  });

  // Проверка 3 слотов колец
  if (equipped.rings && Array.isArray(equipped.rings)) {
    for (let i = 0; i < equipped.rings.length; i++) {
      const itemId = equipped.rings[i];
      if (!itemId) continue;

      const itemData = GAME_ITEMS_DATABASE[itemId];
      if (itemData) {
        let isRingLegal = true;
        if (itemData.level && myLvl < Number(itemData.level)) isRingLegal = false;
        
        const reqStr = itemData.req?.strength ?? itemData.reqStrength ?? 0;
        const reqAgi = itemData.req?.agility ?? itemData.reqAgility ?? 0;
        const reqEnd = itemData.req?.endurance ?? itemData.reqEndurance ?? 0;
        const reqLuck = itemData.req?.luck ?? itemData.reqLuck ?? 0;

        if (reqStr > 0 && myStr < Number(reqStr)) isRingLegal = false;
        if (reqAgi > 0 && myAgi < Number(reqAgi)) isRingLegal = false;
        if (reqEnd > 0 && myEnd < Number(reqEnd)) isRingLegal = false;
        if (reqLuck > 0 && myLuck < Number(reqLuck)) isRingLegal = false;

        if (!isRingLegal) {
          console.warn(`🚨 [АНТИЧИТ КУКЛЫ] Снято кольцо "${itemData.name}" из слота №${i}`);
          inventory.equipment.push({ uuid: `${itemId}_force_${Date.now()}`, id: itemId });
          equipped.rings[i] = null;
          wasAnythingUnequipped = true;
        }
      }
    }
  }

  return wasAnythingUnequipped;
}
// Экспортируем методы наружу для использования в других файлах бэкенда
module.exports = {
  getServerMaxHp,
  getServerDef,
  getServerCorrectLevelByXp,
  getServerMfInv,
  getServerMfAntiInv,
  getServerMfCrit,
  getServerMfAntiCrit,
  safeReadField,
  triggerLoadGameSuccess,
  
  // Главный инициализатор сокет-обработчиков
  init: function(io, socket, sb) {

  // --- 1. ЗАЩИЩЕННАЯ ЗАГРУЗКА И АНТИЧИТ-АУДИТ ПРИ ВХОДЕ ---
    socket.on('load_game_secure', async ({ userId, username }) => {
      try {
        const nUserId = Number(userId);
        const sUserId = String(userId);
        console.log(`🔍 [АУДИТ ВХОДА] Проверка игрока ID: ${nUserId} (${username})...`);

        // 🔥 ФИКС РЕКОННЕКТА В ГОРОДЕ: Если игрок переподключился, и у него поменялся сокет,
        // мы пробегаемся по ОЗУ сервера и принудительно прописываем ему НОВЫЙ живой ID сокета в активных комнатах!
        if (global.activeRooms) {
          Object.keys(global.activeRooms).forEach(roomId => {
            const room = global.activeRooms[roomId];
            const fighter = [...room.teamA, ...room.teamB].find(f => String(f.id) === sUserId);
            if (fighter) {
              console.log(`🔄 [РЕКОННЕКТ ФИКС] Боец ${fighter.name} переподключился в бою. Новый сокет: ${socket.id}`);
              fighter.socketId = socket.id;
              socket.join(roomId); // Автоматически возвращаем его сокет в комнату Socket.io
            }
          });
        }

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
          // Если статы были сброшены в БД, функция сама очистит куклу в памяти cloudPlayer!
          const unequippedDone = enforceEquipmentRequirements(cloudPlayer);
          if (unequippedDone) {
            updatePayload.equipped = cloudPlayer.equipped;
            updatePayload.inventory = cloudPlayer.inventory;
            
            // Если вещи слетели, на всякий случай пересчитываем текущее ХП, чтобы оно не превышало новый кап куклы
            const maxHpWithNewGear = getServerMaxHp(cloudPlayer);
            if (Number(cloudPlayer.hp) > maxHpWithNewGear) {
              updatePayload.hp = maxHpWithNewGear;
            }
            needsDbSync = true;
          }
          // ============================================================================

          if (needsDbSync) {
            // Отправляем атомарный апдейт со сброшенными шмотками в Supabase
            await sb.from('players').update(updatePayload).eq('id', nUserId);
            
            // Важно: Перезаписываем поля в объекте cloudPlayer, чтобы triggerLoadGameSuccess 
            // отправил на клиент уже чистую куклу без багов!
            if (updatePayload.equipped) cloudPlayer.equipped = updatePayload.equipped;
            if (updatePayload.inventory) cloudPlayer.inventory = updatePayload.inventory;
            if (updatePayload.hp) cloudPlayer.hp = updatePayload.hp;
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
          equipped: player.equipped || { rings: [null, null, null] },
          tower_floor: Number(player.tower_floor ?? player.stats?.tower_floor ?? 1)
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