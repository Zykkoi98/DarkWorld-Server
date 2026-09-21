// ============================================================================
// ===== 🛡️ МОДУЛЬ СЕРВЕРНОЙ ЛОГИКИ ИНВЕНТАРЯ И ЭКИПИРОВКИ (INVENTORY_LOGIC.JS) =====
// ===== ЧАСТЬ 1 ИЗ 2: СЕРВЕРНЫЕ БАЗЫ ДАННЫХ И НАЧАЛО МОДУЛЯ ЭКИПИРОВКИ =====
// ============================================================================

const dbHelper = require('./db_helper');

const SERVER_CONSUMABLES_SLOTS = {
  'hp_potion_small': 'potion',
  'hp_potion_big': 'potion',
  'fish_soup': 'potion',
  'blessing_scroll': 'scroll'
};

const CONSUMABLE_DATABASE = {
  'hp_potion_small': { name: 'Малое зелье HP', heal: 25 },
  'hp_potion_big':   { name: 'Большое зелье HP', heal: 60 },
  'fish_soup':       { name: 'Уха из таверны', heal: 40 }
};

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

// Экспортируем функцию инициализации модуля
module.exports = function(io, socket, sb) {
  
  // Достаем вспомогательные функции из db_helper
  const triggerLoadGameSuccess = dbHelper.triggerLoadGameSuccess;
  const safeReadField = dbHelper.safeReadField;

  // --- ОБРАБОТЧИК А: ЭКИПИРОВАТЬ ПРЕДМЕТ ЧЕРЕЗ СЕРВЕР ---
  socket.on('equip_item_secure', async ({ userId, itemId }) => {
    try {
      const nUserId = Number(userId);
      const { data: dbPlayer, error: fetchErr } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      if (fetchErr || !dbPlayer) return socket.emit('error', 'Персонаж не найден в БД.');

      let inventory = dbPlayer.inventory || { equipment: [], resources: [], consumables: [] };
      let equipped = dbPlayer.equipped || { rings: [null, null, null] };
      const cloudLevel = safeReadField(dbPlayer, 'level', 1);

      let slotType = null;
      let requiredLevel = 1;

      if (ITEMS_STAT_DB[itemId]) {
        const id = itemId;
        if (id.includes('sword') || id.includes('mace')) slotType = 'mainHand';
        if (id.includes('halberd')) slotType = 'twoHanded';
        if (id.includes('shield')) slotType = 'offHand';
        if (id.includes('cap')) slotType = 'head';
        if (id.includes('armor')) slotType = 'body';
        if (id.includes('boots')) slotType = 'legs';
        if (id.includes('gloves')) slotType = 'gloves';
        if (id.includes('amulet')) slotType = 'neck';
        if (id.includes('ring')) slotType = 'ring';

        if (id === 'iron_sword' || id === 'leather_armor' || id === 'leather_gloves') requiredLevel = 2;
        if (id === 'steel_mace' || id === 'wolf_amulet' || id === 'lucky_ring') requiredLevel = 3;
        if (id === 'heavy_halberd' || id === 'ruby_ring') requiredLevel = 5;
      } else if (SERVER_CONSUMABLES_SLOTS[itemId]) {
        slotType = SERVER_CONSUMABLES_SLOTS[itemId];
      }

      if (!slotType) return socket.emit('error', 'Этот предмет нельзя экипировать!');
      if (cloudLevel < requiredLevel) return socket.emit('error', `🔒 Требуется уровень: ${requiredLevel}`);

      const invTab = (slotType === 'potion' || slotType === 'scroll') ? 'consumables' : 'equipment';
      if (!inventory[invTab]) inventory[invTab] = [];
      
      const inv = inventory[invTab];
      const itemIdx = inv.findIndex(i => i.id === itemId);

      if (itemIdx === -1) return socket.emit('error', 'У вас нет этого предмета в рюкзаке!');

      // Логика расходников (зелья и свитки со стаком до 5 штук)
      if (slotType === 'potion' || slotType === 'scroll') {
        const currentEquipped = equipped[slotType];
        const availableInInv = Number(inv[itemIdx].count || 1);
        let alreadyEquippedCount = 0;

        if (currentEquipped && typeof currentEquipped === 'object' && currentEquipped.id) {
          if (currentEquipped.id === itemId) {
            alreadyEquippedCount = Number(currentEquipped.count || 0);
            if (alreadyEquippedCount >= 5) return socket.emit('error', 'В этот слот уже взят максимальный стак!');
          } else {
            const oldId = currentEquipped.id;
            const oldQty = Number(currentEquipped.count || 1);
            const existOld = inv.find(i => i.id === oldId);
            if (existOld) existOld.count = (existOld.count || 1) + oldQty;
            else inv.push({ id: oldId, count: oldQty });
          }
        }

        const spaceLeft = 5 - alreadyEquippedCount;
        const countToEquip = Math.min(spaceLeft, availableInInv);

        equipped[slotType] = { id: itemId, count: alreadyEquippedCount + countToEquip };

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
              const existRing = inventory.equipment.find(i => i.id === oldRingId);
              if (existRing) existRing.count = (existRing.count || 1) + 1;
              else inventory.equipment.push({ id: oldRingId, count: 1 });
            }
          }
          equipped.rings[ringIndex] = itemId;
        } else {
          if (slotType === 'twoHanded') {
            if (equipped.offHand) {
              const oldOff = equipped.offHand;
              const existOff = inventory.equipment.find(i => i.id === oldOff);
              if (existOff) existOff.count = (existOff.count || 1) + 1;
              else inventory.equipment.push({ id: oldOff, count: 1 });
              equipped.offHand = null;
            }
            targetSlot = 'mainHand';
          }

          if (slotType === 'offHand' && equipped.mainHand === 'heavy_halberd') {
            return socket.emit('error', '⚠️ Нельзя взять щит с двуручным оружием!');
          }

          const oldItemId = equipped[targetSlot];
          if (oldItemId) {
            const existOld = inventory.equipment.find(i => i.id === oldItemId);
            if (existOld) existOld.count = (existOld.count || 1) + 1;
            else inventory.equipment.push({ id: oldItemId, count: 1 });
          }

          equipped[targetSlot] = itemId;
        }

        if (Number(inv[itemIdx].count || 1) > 1) inv[itemIdx].count--;
        else inv.splice(itemIdx, 1);
      }

      await sb.from('players').update({ inventory, equipped }).eq('id', nUserId);
      await triggerLoadGameSuccess(nUserId, socket, sb);

    } catch (e) {
      console.error(e);
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

      const exists = inventory[invTab].find(i => i.id === itemId);
      if (!exists && inventory[invTab].length >= 30) {
        return socket.emit('error', '⚠️ Сумка переполнена! Некуда снять вещь.');
      }

      if (exists) {
        exists.count = (exists.count || 1) + countToReturn;
      } else {
        let name = itemId; let icon = '📦';
        if (itemId === 'iron_sword') { name = 'Железный меч'; icon = '⚔️'; }
        if (itemId === 'rusty_sword') { name = 'Ржавый меч'; icon = '🗡️'; }
        if (itemId === 'leather_cap') { name = 'Кожаная шапка'; icon = '🪖'; }
        if (itemId === 'leather_armor') { name = 'Кожаная куртка'; icon = '👕'; }
        if (itemId === 'leather_boots') { name = 'Кожаные сапоги'; icon = '🥾'; }
        if (itemId === 'leather_gloves') { name = 'Кожаные перчатки'; icon = '🧤'; }
        if (itemId === 'wooden_shield') { name = 'Щит новичка'; icon = '🛡️'; }
        if (itemId === 'copper_ring') { name = 'Медное кольцо'; icon = '💍'; }
        if (itemId === 'wolf_amulet') { name = 'Амулет Волка'; icon = '📿'; }
        
        inventory[invTab].push({ id: itemId, name: name, icon: icon, count: countToReturn });
      }

      if (slotKey === 'ring' && ringIndex !== null) {
        equipped.rings[ringIndex] = null;
      } else {
        equipped[slotKey] = null;
      }

      await sb.from('players').update({ inventory, equipped }).eq('id', nUserId);
      await triggerLoadGameSuccess(nUserId, socket, sb);

    } catch (e) {
      console.error(e);
      socket.emit('error', 'Ошибка сервера при снятии экипировки.');
    }
  });

};