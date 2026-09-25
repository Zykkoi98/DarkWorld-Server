// ============================================================================
// ===== 🛡️ МОДУЛЬ СЕРВЕРНОЙ ЛОГИКИ ИНВЕНТАРЯ И ЭКИПИРОВКИ (INVENTORY_LOGIC.JS) =====
// ===== ЧАСТЬ 1 ИЗ 2: БРОНИРОВАННАЯ ЭКИПИРОВКА С ВАЛИДАЦИЕЙ КОНФИГА =====
// ============================================================================

const dbHelper = require('./db_helper');
const GAME_ITEMS_DATABASE = require('./shop/shop_items_config'); 

function getConsumableSlotType(itemId) {
  if (!itemId) return null;
  const id = String(itemId).toLowerCase();
  if (id.includes('potion') || id.includes('soup') || id.includes('elixir')) return 'potion';
  if (id.includes('scroll') || id.includes('parchment')) return 'scroll';
  return null;
}

module.exports = function(io, socket, sb) {
  const triggerLoadGameSuccess = dbHelper.triggerLoadGameSuccess;
  const safeReadField = dbHelper.safeReadField;

  socket.on('equip_item_secure', async ({ userId, itemId: itemUuidOrId }) => {
    try {
      const nUserId = Number(userId);
      const { data: dbPlayer, error: fetchErr } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      if (fetchErr || !dbPlayer) return socket.emit('error', 'Персонаж не найден в БД.');

      let inventory = dbPlayer.inventory || { equipment: [], resources: [], consumables: [] };
      let equipped = dbPlayer.equipped || { rings: [null, null, null] };
      const currentXp = safeReadField(dbPlayer, 'xp', 0);
      const cloudLevel = getServerCorrectLevelByXp(currentXp); 
      
      console.log(`🛡️ [КОНТРОЛЬ НАДЕВАНИЯ] Игрок ${dbPlayer.name} (Опыт: ${currentXp} -> Расчетный Ур: ${cloudLevel}). Предмет: ${cleanItemId}`);

      // Извлекаем базовый ID предмета из UUID
      let cleanItemId = itemUuidOrId;
      if (itemUuidOrId && itemUuidOrId.includes('_')) {
        const parts = itemUuidOrId.split('_');
        if (parts.length > 2 && !itemUuidOrId.includes('potion') && !itemUuidOrId.includes('soup')) {
          cleanItemId = parts.slice(0, -2).join('_');
        }
      }

      let slotType = getConsumableSlotType(cleanItemId);
      let requiredLevel = 1;

      if (!slotType) {
        let itemConfig = GAME_ITEMS_DATABASE[cleanItemId] || (global.SERVER_SHOP_DATABASE ? global.SERVER_SHOP_DATABASE[cleanItemId] : null);
        if (itemConfig) {
          requiredLevel = itemConfig.level || 1;
          slotType = itemConfig.slotType;
        }
      }

      // Запасной текстовый определитель слота брони/оружия
      if (!slotType) {
        const id = cleanItemId.toLowerCase();
        if (id.includes('sword') || id.includes('mace') || id.includes('dagger') || id.includes('knife') || id.includes('glaive') || id.includes('pillar') || id.includes('warhammer')) slotType = 'mainHand';
        if (id.includes('halberd') || id.includes('claymore') || id.includes('broadsword') || id.includes('splitter')) slotType = 'twoHanded';
        if (id.includes('shield') || id.includes('buckler') || id.includes('parry') || id.includes('aegis')) slotType = 'offHand';
        if (id.includes('cap') || id.includes('hood') || id.includes('mask') || id.includes('helm')) slotType = 'head';
        if (id.includes('armor') || id.includes('vest') || id.includes('jacket') || id.includes('coat') || id.includes('cuirass')) slotType = 'body';
        if (id.includes('boots') || id.includes('shoes') || id.includes('greaves')) slotType = 'legs';
        if (id.includes('gloves') || id.includes('wraps') || id.includes('gauntlets')) slotType = 'gloves';
        if (id.includes('amulet') || id.includes('talisman') || id.includes('neck') || id.includes('necklace')) slotType = 'neck';
        if (id.includes('ring') || id.includes('loop') || id.includes('band') || id.includes('seal')) slotType = 'ring';
      }

      if (!slotType) return socket.emit('error', 'Этот предмет нельзя экипировать!');
      if (cloudLevel < requiredLevel) return socket.emit('error', `🔒 Требуется уровень: ${requiredLevel}`);
      let itemConfig = GAME_ITEMS_DATABASE[cleanItemId] || (global.SERVER_SHOP_DATABASE ? global.SERVER_SHOP_DATABASE[cleanItemId] : null);
      // Античит на надевание вещей
      if (itemConfig && itemConfig.req) {
        // Считываем чистые статы игрока из БД с помощью твоей утилиты safeReadField
        const myStr = safeReadField(dbPlayer, 'strength', 1);
        const myAgi = safeReadField(dbPlayer, 'agility', 1);
        const myEnd = safeReadField(dbPlayer, 'endurance', 1);
        const myLuck = safeReadField(dbPlayer, 'luck', 1);

        // Вытаскиваем требования вещи, защищаясь от любого регистра
        const reqStr = itemConfig.req.strength ?? itemConfig.req.Strength ?? itemConfig.reqStrength ?? 0;
        const reqAgi = itemConfig.req.agility ?? itemConfig.req.Agility ?? itemConfig.reqAgility ?? 0;
        const reqEnd = itemConfig.req.endurance ?? itemConfig.req.Endurance ?? itemConfig.reqEndurance ?? 0;
        const reqLuck = itemConfig.req.luck ?? itemConfig.req.Luck ?? itemConfig.reqLuck ?? 0;

        let isLegal = true;
        let failReason = "";

        if (reqStr > 0 && myStr < Number(reqStr)) { isLegal = false; failReason = `Не хватает Силы! Нужно ${reqStr} (у вас ${myStr})`; }
        if (reqAgi > 0 && myAgi < Number(reqAgi)) { isLegal = false; failReason = `Не хватает Ловкости! Нужно ${reqAgi} (у вас ${myAgi})`; }
        if (reqEnd > 0 && myEnd < Number(reqEnd)) { isLegal = false; failReason = `Не хватает Выносливости! Нужно ${reqEnd} (у вас ${myEnd})`; }
        if (reqLuck > 0 && myLuck < Number(reqLuck)) { isLegal = false; failReason = `Не хватает Удачи! Нужно ${reqLuck} (у вас ${myLuck})`; }

        // Если статы не подходят — намертво рубим выполнение функции!
        if (!isLegal) {
          console.warn(`🚨 [АНТИЧИТ НАДЕВАНИЯ] Игрок ${dbPlayer.name} пытался обойти требования для "${itemConfig.name || cleanItemId}".`);
          return socket.emit('error', `🔒 ${failReason}`);
        }
      }
      const invTab = (slotType === 'potion' || slotType === 'scroll') ? 'consumables' : 'equipment';
      if (!inventory[invTab]) inventory[invTab] = [];
      const inv = inventory[invTab];

      // Защищенный поиск индекса
      const itemIdx = inv.findIndex(i => {
        if (invTab === 'consumables') return i.id === cleanItemId;
        return i.uuid === itemUuidOrId || i.id === itemUuidOrId;
      });

      if (itemIdx === -1) return socket.emit('error', 'У вас нет этого предмета в рюкзаке!');
            // Обработка расходников (зелья и свитки) со стаком до 5 штук
      if (slotType === 'potion' || slotType === 'scroll') {
        const currentEquipped = equipped[slotType];
        const availableInInv = Number(inv[itemIdx].count || 1);
        let alreadyEquippedCount = 0;

        if (currentEquipped && typeof currentEquipped === 'object' && currentEquipped.id) {
          if (currentEquipped.id === cleanItemId) {
            alreadyEquippedCount = Number(currentEquipped.count || 0);
            if (alreadyEquippedCount >= 5) return socket.emit('error', 'В этот слот уже взят максимальный стак!');
          } else {
            // Возвращаем старый стак зелий обратно в рюкзак расходников
            const oldId = currentEquipped.id;
            const oldQty = Number(currentEquipped.count || 1);
            const existOld = inv.find(i => i.id === oldId);
            if (existOld) existOld.count = (existOld.count || 1) + oldQty;
            else inv.push({ id: oldId, count: oldQty });
          }
        }

        const spaceLeft = 5 - alreadyEquippedCount;
        const countToEquip = Math.min(spaceLeft, availableInInv);

        equipped[slotType] = { id: cleanItemId, count: alreadyEquippedCount + countToEquip };

        if (availableInInv > countToEquip) inv[itemIdx].count -= countToEquip;
        else inv.splice(itemIdx, 1);
      }
      // Обычная логика оружия, щитов и элементов брони
      else {
        let targetSlot = slotType;

        if (slotType === 'ring') {
          if (!Array.isArray(equipped.rings)) equipped.rings = [null, null, null];
          let ringIndex = equipped.rings.findIndex(r => r === null);
          
          if (ringIndex === -1) {
            ringIndex = 0;
            const oldRingId = equipped.rings[0];
            if (oldRingId) {
              inventory.equipment.push({
                uuid: `${oldRingId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                id: oldRingId, count: 1
              });
            }
          }
          equipped.rings[ringIndex] = cleanItemId;
        } else {
          if (slotType === 'twoHanded') {
            if (equipped.offHand) {
              const oldOff = equipped.offHand;
              inventory.equipment.push({
                uuid: `${oldOff}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                id: oldOff, count: 1
              });
              equipped.offHand = null;
            }
            targetSlot = 'mainHand';
          }

          if (slotType === 'offHand' && (equipped.mainHand === 'heavy_halberd' || String(equipped.mainHand).includes('twoHanded'))) {
            return socket.emit('error', '⚠️ Нельзя взять щит или второе оружие с двуручником!');
          }

          // 🔥 БЕЗОПАСНОЕ ВЫТЕСНЕНИЕ СТАРЫХ ВЕЩЕЙ ИЗ СЛОТА
          const oldItemId = equipped[targetSlot];
          if (oldItemId) {
            inventory.equipment.push({
              uuid: `${oldItemId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
              id: oldItemId, count: 1
            });
          }

          equipped[targetSlot] = cleanItemId;
        }

        if (Number(inv[itemIdx].count || 1) > 1) inv[itemIdx].count--;
        else inv.splice(itemIdx, 1);
      }

      await sb.from('players').update({ inventory, equipped }).eq('id', nUserId);
      await triggerLoadGameSuccess(nUserId, socket, sb);

    } catch (e) {
      console.error("❌ Критический сбой при экипировке:", e);
      socket.emit('error', 'Ошибка сервера при смене экипировки.');
    }
  });

  // --- ОБРАБОТЧИК Б: СНЯТЬ ПРЕДМЕТ ЧЕРЕЗ СЕРВЕР ---
  socket.on('unequip_item_secure', async ({ userId, slotKey, ringIndex }) => {
    try {
      const nUserId = Number(userId);
      const { data: dbPlayer, error: fetchErr } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      if (fetchErr || !dbPlayer) return socket.emit('error', 'Персонаж не найден.');

      let inventory = dbPlayer.inventory || { equipment: [], resources: [], consumables: [] };
      let equipped = dbPlayer.equipped || { rings: [null, null, null] };

      let itemId = null;
      let countToReturn = 1;

      if (slotKey === 'ring' && ringIndex !== null) {
        if (Array.isArray(equipped.rings)) itemId = equipped.rings[ringIndex];
      } else {
        const equippedData = equipped[slotKey];
        itemId = (equippedData && typeof equippedData === 'object') ? equippedData.id : equippedData;
        countToReturn = (equippedData && typeof equippedData === 'object') ? Number(equippedData.count || 1) : 1;
      }

      if (!itemId) return; 

      const invTab = (slotKey === 'potion' || slotKey === 'scroll') ? 'consumables' : 'equipment';
      if (!inventory[invTab]) inventory[invTab] = [];

      if (invTab === 'equipment' && inventory.equipment.length >= 30) {
        return socket.emit('error', '⚠️ Сумка переполнена! Некуда снять вещь.');
      }

      if (invTab === 'consumables') {
        const exists = inventory.consumables.find(i => i.id === itemId);
        if (exists) {
          exists.count = (exists.count || 1) + countToReturn;
        } else {
          inventory.consumables.push({ id: itemId, count: countToReturn });
        }
      } 
      else {
        inventory.equipment.push({
          uuid: `${itemId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          id: itemId, count: 1
        });
      }

      if (slotKey === 'ring' && ringIndex !== null) {
        equipped.rings[ringIndex] = null;
      } else {
        equipped[slotKey] = null;
      }

      await sb.from('players').update({ inventory, equipped }).eq('id', nUserId);
      await triggerLoadGameSuccess(nUserId, socket, sb);

    } catch (e) {
      console.error("❌ Критический сбой при снятии экипировки:", e);
      socket.emit('error', 'Ошибка сервера при снятии экипировки.');
    }
  });
   // --- ОБРАБОТЧИК В: НАВСЕГДА УНИЧТОЖИТЬ / ВЫБРОСИТЬ ПРЕДМЕТ ИЗ БД ---
   socket.on('destroy_item_secure', async ({ userId, itemUuidOrId, isConsumable }) => {
    try {
      const nUserId = Number(userId);
      const { data: dbPlayer, error: fetchErr } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      if (fetchErr || !dbPlayer) return socket.emit('error', 'Персонаж не найден в БД.');

      let inventory = dbPlayer.inventory || { equipment: [], resources: [], consumables: [] };
      const invTab = isConsumable ? 'consumables' : 'equipment';
      if (!inventory[invTab]) inventory[invTab] = [];
      const inv = inventory[invTab];

      // Ищем вещь в массиве по UUID или базовому ID
      const itemIdx = inv.findIndex(i => {
        if (isConsumable) return i.id === itemUuidOrId;
        return i.uuid === itemUuidOrId || i.id === itemUuidOrId;
      });

      if (itemIdx === -1) {
        return socket.emit('error', 'Предмет не найден в вашем рюкзаке!');
      }

      // 🔥 ИСПРАВЛЕНО: Удалили сломанную строку с itemName, которая приводила к крашу бэкенда!
      
      // Удаляем предмет из массива инвентаря
      if (isConsumable) {
        if (Number(inv[itemIdx].count || 1) > 1) {
          inv[itemIdx].count--;
        } else {
          inv.splice(itemIdx, 1);
        }
      } else {
        inv.splice(itemIdx, 1); // Полностью вырезаем шмотку по её UUID
      }

      // Синхронизируем очищенный инвентарь обратно в Supabase
      await sb.from('players').update({ inventory }).eq('id', nUserId);
      
      console.log(`🗑️ [БЭКЕНД] Игрок ${nUserId} успешно выбросил предмет: ${itemUuidOrId}`);
      
      // Мгновенно пушим игроку обновленный профиль для перерисовки инвентаря в реальном времеи
      await triggerLoadGameSuccess(nUserId, socket, sb);

    } catch (e) {
      console.error("❌ Критический сбой при уничтожении предмета:", e);
      socket.emit('error', 'Ошибка сервера при попытке выбросить предмет.');
    }
  });
};