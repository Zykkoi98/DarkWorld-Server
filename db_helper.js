// ============================================================================
// ===== 🛡️ МОДУЛЬ СЕРВЕРНОГО АУДИТА, БАЗЫ ДАННЫХ И АНТИЧИТА (DB_HELPER.JS) =====
// ===== ЧАСТЬ 1 ИЗ 2: БАЗЫ ДАННЫХ, МАТЕМАТИКА И СИНХРОНИЗАЦИЯ ПРОФИЛЯ =====
// ============================================================================

const GAME_ITEMS_DATABASE = require('./shop/shop_items_config');

// Глобальная серверная таблица порогов опыта (XP_TABLE)
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

// 🔥 УНИВЕРСАЛЬНЫЙ ПОИСК ПРЕДМЕТА В ОБЕИХ БАЗАХ
function findItemInAnyDatabase(itemId) {
  if (!itemId) return null;
  return GAME_ITEMS_DATABASE[itemId] 
      || (global.SERVER_SHOP_DATABASE ? global.SERVER_SHOP_DATABASE[itemId] : null) 
      || null;
}

// 🔥 ИСПРАВЛЕНО: Вспомогательная утилита для сбора бонусов характеристик
// Теперь ищет предметы и в старой базе, и в новой глобальной SERVER_SHOP_DATABASE
function getEquipmentBonus(equipped, bonusKey) {
  if (!equipped) return 0;
  let totalBonus = 0;
  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand', 'extra', 'potion', 'scroll'];
  
  slots.forEach(slot => {
    const itemId = equipped[slot];
    if (!itemId) return;

    const item = findItemInAnyDatabase(itemId);
    if (item && item.bonus) {
      if (item.bonus[bonusKey] !== undefined) totalBonus += item.bonus[bonusKey];
      if (item.bonus.stats && item.bonus.stats[bonusKey] !== undefined) {
        totalBonus += item.bonus.stats[bonusKey];
      }
    }
  });

  // Обсчет колец в слотах бижутерии
  if (equipped.rings && Array.isArray(equipped.rings)) {
    equipped.rings.forEach(itemId => {
      if (!itemId) return;
      const item = findItemInAnyDatabase(itemId);
      if (item && item.bonus) {
        if (item.bonus[bonusKey] !== undefined) totalBonus += item.bonus[bonusKey];
        if (item.bonus.stats && item.bonus.stats[bonusKey] !== undefined) {
          totalBonus += item.bonus.stats[bonusKey];
        }
      }
    });
  }
  return totalBonus;
}

// 🔥 ИСПРАВЛЕНО: getServerMaxHp теперь корректно читает endurance
// и с верхнего уровня объекта, и из вложенного объекта stats
function getServerMaxHp(fighter) {
  if (!fighter) return 10;
  
  // Читаем выносливость с любого уровня: fighter.endurance или fighter.stats.endurance
  const rawEndurance = fighter.endurance 
                    ?? (fighter.stats && fighter.stats.endurance) 
                    ?? 1;
  const baseEndurance = Number(rawEndurance);
  
  const gearEnduranceBonus = getEquipmentBonus(fighter.equipped, 'endurance');
  const flatHpBonus = getEquipmentBonus(fighter.equipped, 'hp') || 0;
  
  return ((baseEndurance + gearEnduranceBonus) * 10) + flatHpBonus;
}

function getServerDef(fighter) {
  const rawEndurance = fighter.endurance ?? (fighter.stats && fighter.stats.endurance) ?? 1;
  const baseEndurance = Number(rawEndurance);
  return Math.floor((baseEndurance + getEquipmentBonus(fighter.equipped, 'endurance')) * 0.5) 
       + (getEquipmentBonus(fighter.equipped, 'def') || 0);
}

// Новые функции сбора скрытых боевых модификаторов
function getServerMfInv(fighter) { 
  const agi = Number(fighter.agility ?? (fighter.stats && fighter.stats.agility) ?? 1);
  return (agi * 10) + getEquipmentBonus(fighter.equipped, 'mf_inv'); 
}
function getServerMfAntiInv(fighter) { 
  const agi = Number(fighter.agility ?? (fighter.stats && fighter.stats.agility) ?? 1);
  return (agi * 4) + getEquipmentBonus(fighter.equipped, 'mf_antiinv'); 
}
function getServerMfCrit(fighter) { 
  const luck = Number(fighter.luck ?? (fighter.stats && fighter.stats.luck) ?? 1);
  return (luck * 10) + getEquipmentBonus(fighter.equipped, 'mf_crit'); 
}
function getServerMfAntiCrit(fighter) { 
  const luck = Number(fighter.luck ?? (fighter.stats && fighter.stats.luck) ?? 1);
  return (luck * 4) + getEquipmentBonus(fighter.equipped, 'mf_anticrit'); 
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

    const row = data[0];
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
      tower_floor: safeReadField(row, 'tower_floor', 1),
      tower_coins: safeReadField(row, 'tower_coins', 0),
      stat_resets: safeReadField(row, 'stat_resets', 3),
      stats: {
        strength: safeReadField(row, 'strength', 1),
        agility: safeReadField(row, 'agility', 1),
        endurance: safeReadField(row, 'endurance', 1),
        toughness: safeReadField(row, 'toughness', 1),
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

// 🔥 [АНТИЧИТ-ФИКС]: Серверная проверка куклы. Снимает вещи в рюкзак, если статы игрока упали!
function enforceEquipmentRequirements(cloudPlayer) {
  if (!cloudPlayer || !cloudPlayer.equipped) return false;

  let equipped = cloudPlayer.equipped;
  if (!cloudPlayer.inventory) cloudPlayer.inventory = { equipment: [], resources: [], consumables: [] };
  let inventory = cloudPlayer.inventory;
  if (!Array.isArray(inventory.equipment)) inventory.equipment = [];

  const myStr = safeReadField(cloudPlayer, 'strength', 1);
  const myAgi = safeReadField(cloudPlayer, 'agility', 1);
  const myEnd = safeReadField(cloudPlayer, 'endurance', 1);
  const myLuck = safeReadField(cloudPlayer, 'luck', 1);
  const myLvl = safeReadField(cloudPlayer, 'level', 1);

  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand', 'extra'];
  let wasAnythingUnequipped = false;

  const checkAndUnequip = (itemId, assignNullFn, slotLabel) => {
    if (!itemId) return;
    const itemData = findItemInAnyDatabase(itemId);
    if (!itemData) return;

    let isItemLegal = true;
    if (itemData.level && myLvl < Number(itemData.level)) isItemLegal = false;

    const reqStr = itemData.req?.strength ?? itemData.reqStrength ?? 0;
    const reqAgi = itemData.req?.agility ?? itemData.reqAgility ?? 0;
    const reqEnd = itemData.req?.endurance ?? itemData.reqEndurance ?? 0;
    const reqLuck = itemData.req?.luck ?? itemData.reqLuck ?? 0;

    if (reqStr > 0 && myStr < Number(reqStr)) isItemLegal = false;
    if (reqAgi > 0 && myAgi < Number(reqAgi)) isItemLegal = false;
    if (reqEnd > 0 && myEnd < Number(reqEnd)) isItemLegal = false;
    if (reqLuck > 0 && myLuck < Number(reqLuck)) isItemLegal = false;

    if (!isItemLegal) {
      console.warn(`🚨 [АНТИЧИТ КУКЛЫ] Снимаем "${itemData.name}" из слота ${slotLabel}. Статы: 💪${myStr} 🏹${myAgi} 🛡️${myEnd} 🍀${myLuck}`);
      inventory.equipment.push({ uuid: `${itemId}_force_${Date.now()}`, id: itemId, count: 1 });
      assignNullFn();
      wasAnythingUnequipped = true;
    }
  };

  slots.forEach(slot => {
    const itemId = equipped[slot];
    checkAndUnequip(itemId, () => { equipped[slot] = null; }, slot);
  });

  if (equipped.rings && Array.isArray(equipped.rings)) {
    for (let i = 0; i < equipped.rings.length; i++) {
      const itemId = equipped.rings[i];
      checkAndUnequip(itemId, () => { equipped.rings[i] = null; }, `ring[${i}]`);
    }
  }

  return wasAnythingUnequipped;
}

// 🔥 СЕРВЕРНЫЙ КАЛЬКУЛЯТОР АВТОДОПОЛНЕНИЯ БАНОК (ЕДИНАЯ ВЕРСИЯ)
function autoRefillPotionsAfterBattle(playerRow) {
  try {
    if (!playerRow || !playerRow.equipped || !playerRow.inventory) return;

    let equipped = playerRow.equipped;
    let inventory = playerRow.inventory;
    
    if (!inventory.consumables) inventory.consumables = [];
    let consumables = inventory.consumables;

    const validPotions = ['hp_potion_big', 'hp_potion_small', 'fish_soup'];

    // СЦЕНАРИЙ А: Слот банок полностью пустой
    if (!equipped.potion || equipped.potion === null || typeof equipped.potion !== 'object') {
      let foundPotionId = null;
      let invIdx = -1;

      for (const pId of validPotions) {
        invIdx = consumables.findIndex(c => c && c.id === pId && Number(c.count || 0) > 0);
        if (invIdx !== -1) {
          foundPotionId = pId;
          break;
        }
      }

      if (foundPotionId && invIdx !== -1) {
        const availableInInv = Number(consumables[invIdx].count || 0);
        const takeQty = Math.min(5, availableInInv);

        equipped.potion = { id: foundPotionId, count: takeQty };

        if (availableInInv > takeQty) {
          consumables[invIdx].count -= takeQty;
        } else {
          consumables.splice(invIdx, 1);
        }
        console.log(`🧪 [БД АВТОДОПОЛНЕНИЕ] Слот банок был пуст. Взято из рюкзака ${takeQty} шт. (${foundPotionId})`);
        return;
      }
    }

    // СЦЕНАРИЙ Б: На кукле уже есть стак, но он не полный
    if (equipped.potion && typeof equipped.potion === 'object' && equipped.potion.id) {
      let potionSlot = equipped.potion;
      let currentCount = Number(potionSlot.count || 0);
      
      if (currentCount < 5) {
        const needQty = 5 - currentCount;
        const invPotionIdx = consumables.findIndex(c => c && c.id === potionSlot.id);
        
        if (invPotionIdx !== -1) {
          const availableInInv = Number(consumables[invPotionIdx].count || 0);
          const takeQty = Math.min(needQty, availableInInv);
          
          if (takeQty > 0) {
            potionSlot.count = currentCount + takeQty;
            if (availableInInv > takeQty) {
              consumables[invPotionIdx].count -= takeQty;
            } else {
              consumables.splice(invPotionIdx, 1);
            }
            console.log(`🧪 [БД АВТОДОПОЛНЕНИЕ] К стаку на кукле доложено +${takeQty} шт. банок (${potionSlot.id})`);
          }
        }
      }
    }
  } catch (err) {
    console.error("🚨 Фатальный сбой при автодополнении банок:", err.message);
  }
}

// Экспортируем методы наружу
module.exports = {
  // Математика и расчеты
  getServerMaxHp,
  getServerDef,
  getServerCorrectLevelByXp,
  getServerMfInv,
  getServerMfAntiInv,
  getServerMfCrit,
  getServerMfAntiCrit,
  getEquipmentBonus,          // 🔥 ЭКСПОРТИРУЕМ для battle_logic
  findItemInAnyDatabase,      // 🔥 НОВАЯ утилита
  safeReadField,
  triggerLoadGameSuccess,
  autoRefillPotionsAfterBattle,
  enforceEquipmentRequirements, // 🔥 ЭКСПОРТИРУЕМ для переиспользования
  
  // Главный инициализатор сокет-обработчиков
  init: function(io, socket, sb) {

    // --- 1. ЗАЩИЩЕННАЯ ЗАГРУЗКА И АНТИЧИТ-АУДИТ ПРИ ВХОДЕ ---
    socket.on('load_game_secure', async ({ userId, username }) => {
      try {
        const nUserId = Number(userId);
        const sUserId = String(userId);
        console.log(`🔍 [АУДИТ ВХОДА] Проверка игрока ID: ${nUserId} (${username})...`);

        // 🔥 ФИКС РЕКОННЕКТА В ГОРОДЕ
        if (global.activeRooms) {
          Object.keys(global.activeRooms).forEach(roomId => {
            const room = global.activeRooms[roomId];
            const fighter = [...room.teamA, ...room.teamB].find(f => String(f.id) === sUserId);
            if (fighter) {
              console.log(`🔄 [РЕКОННЕКТ ФИКС] Боец ${fighter.name} переподключился. Новый сокет: ${socket.id}`);
              fighter.socketId = socket.id;
              socket.join(roomId);
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
            statsKeys.forEach(key => { updatePayload[key] = 1; });

            updatePayload['level'] = correctLevel;
            updatePayload[pointsKey] = maxLegalPoints - 5; 
            updatePayload['hp'] = getServerMaxHp({ endurance: 1, equipped: cloudPlayer.equipped || {} });
            updatePayload['tower_floor'] = safeReadField(cloudPlayer, 'tower_floor', 1);

            needsDbSync = true;
          }
          
          const unequippedDone = enforceEquipmentRequirements(cloudPlayer);
          if (unequippedDone) {
            updatePayload.equipped = cloudPlayer.equipped;
            updatePayload.inventory = cloudPlayer.inventory;
            
            const maxHpWithNewGear = getServerMaxHp(cloudPlayer);
            if (Number(cloudPlayer.hp) > maxHpWithNewGear) {
              updatePayload.hp = maxHpWithNewGear;
            }
            needsDbSync = true;
          }

          if (needsDbSync) {
            await sb.from('players').update(updatePayload).eq('id', nUserId);
            
            if (updatePayload.equipped) cloudPlayer.equipped = updatePayload.equipped;
            if (updatePayload.inventory) cloudPlayer.inventory = updatePayload.inventory;
            if (updatePayload.hp) cloudPlayer.hp = updatePayload.hp;
          }

          await triggerLoadGameSuccess(nUserId, socket, sb);

        } else {
          console.log(`🆕 Игрок не найден. Отправляем сигнал 'player_not_found'...`);
          socket.emit('player_not_found', { userId: nUserId, username: username });
        }

      } catch (err) {
        console.error("❌ Критическая ошибка при загрузке игры:", err);
        socket.emit('load_game_failed', { message: err.message });
      }
    });

    // ОБРАБОТЧИК: БЕЗОПАСНОЕ СОХРАНЕНИЕ / СОЗДАНИЕ ПЕРСОНАЖА В БД
    socket.on('save_game_secure', async ({ player }) => {
      try {
        if (!player || !player.id) return;
        const nUserId = Number(player.id);
        
        console.log(`💾 [БД СОХРАНЕНИЕ] Запись профиля игрока ID: ${nUserId} (${player.name})...`);

        const payload = {
          id: nUserId,
          name: player.name,
          avatar: player.avatar || "assets/avatars/hero1.png",
          level: Number(player.level || 1),
          gold: Number(player.gold || 200),
          xp: Number(player.xp || 0),
          hp: Number(player.hp || 10),
          statpoints: Number(player.statPoints || player.statpoints || 5),
          currenttownindex: Number(player.currentTownIndex || 0),
          strength: Number(player.stats?.strength || 1),
          agility: Number(player.stats?.agility || 1),
          endurance: Number(player.stats?.endurance || 1),
          luck: Number(player.stats?.luck || 1),
          inventory: player.inventory || { equipment: [], resources: [], consumables: [] },
          equipped: player.equipped || { 
            head: null, body: null, legs: null, neck: null, gloves: null,
            mainHand: null, offHand: null, potion: null, scroll: null,
            rings: [null, null, null] 
          },
          tower_floor: Number(player.tower_floor ?? player.stats?.tower_floor ?? 1)
        };

        const { error } = await sb.from('players').upsert(payload).eq('id', nUserId);
        
        if (error) {
          console.error(`🚨 Ошибка сохранения в Supabase для ID ${nUserId}:`, error.message);
        } else {
          console.log(`✨ [БД УСПЕХ] Персонаж ${player.name} сохранен/создан.`);
        }
      } catch (err) {
        console.error("❌ Критический сбой в save_game_secure:", err);
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
          updatePayload['hp'] = safeReadField(dbPlayer, 'hp', 10) + (addedEnd * 10);
        }

        await sb.from('players').update(updatePayload).eq('id', nUserId);
        await triggerLoadGameSuccess(nUserId, socket, sb);
      } catch (err) {
        console.error(err);
        socket.emit('stat_distribution_error', 'Внутренняя ошибка сервера.');
      }
    });

    // --- 3. СБРОС ХАРАКТЕРИСТИК ---
    socket.on('request_stat_reset_secure', async ({ userId }) => {
      try {
        const nUserId = Number(userId);
        const { data: dbPlayer } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
        if (!dbPlayer) return socket.emit('stat_distribution_error', 'Персонаж не найден.');

        const resetsLeft = safeReadField(dbPlayer, 'stat_resets', 3);
        if (resetsLeft <= 0) {
          return socket.emit('stat_distribution_error', '❌ У вас закончились свитки сброса характеристик!');
        }

        const currentXp = safeReadField(dbPlayer, 'xp', 0);
        const cloudLevel = getServerCorrectLevelByXp(currentXp);
        const maxLegalFreePoints = 5 + ((cloudLevel - 1) * 5);

        let pointsKey = dbPlayer.statpoints !== undefined ? 'statpoints' : 'statPoints';
        
        const updatePayload = {
          strength: 1,
          agility: 1,
          endurance: 1,
          luck: 1,
          [pointsKey]: maxLegalFreePoints,
          stat_resets: resetsLeft - 1
        };

        dbPlayer.strength = 1;
        dbPlayer.agility = 1;
        dbPlayer.endurance = 1;
        dbPlayer.luck = 1;
        dbPlayer.level = cloudLevel;

        // 🔥 ИСПРАВЛЕНО: используем общую функцию из db_helper
        enforceEquipmentRequirements(dbPlayer);

        updatePayload.equipped = dbPlayer.equipped;
        updatePayload.inventory = dbPlayer.inventory;
        updatePayload.hp = getServerMaxHp(dbPlayer);

        await sb.from('players').update(updatePayload).eq('id', nUserId);
        
        console.log(`🧹 [БД СБРОС СТАТОВ] Игрок ${dbPlayer.name} сброшен. Вещи в рюкзаке.`);
        
        await triggerLoadGameSuccess(nUserId, socket, sb);

      } catch (err) {
        console.error("🚨 Ошибка при сбросе характеристик:", err.message);
        socket.emit('stat_distribution_error', 'Ошибка сервера при попытке сброса.');
      }
    });
  }
};