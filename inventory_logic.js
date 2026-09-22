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
socket.on('equip_item_secure', async ({ userId, itemId: itemUuidOrId }) => {
    try {
      const nUserId = Number(userId);
      const { data: dbPlayer, error: fetchErr } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      if (fetchErr || !dbPlayer) return socket.emit('error', 'Персонаж не найден в БД.');

      let inventory = dbPlayer.inventory || { equipment: [], resources: [], consumables: [] };
      let equipped = dbPlayer.equipped || { rings: [null, null, null] };
      const cloudLevel = safeReadField(dbPlayer, 'level', 1);

      // 🔥 ШАГ 1: Извлекаем чистый ID предмета из прилетевшего UUID (например, rogue_buckler_1)
      let cleanItemId = itemUuidOrId;
      if (itemUuidOrId && itemUuidOrId.includes('_') && !ITEMS_STAT_DB[itemUuidOrId]) {
        const parts = itemUuidOrId.split('_');
        if (parts.length > 2) {
          cleanItemId = parts.slice(0, -2).join('_');
        }
      }

      let slotType = null;
      let requiredLevel = 1;

      // 🔥 ШАГ 2: Ищем характеристики шмотки сначала в старой базе, затем в глобальной базе Магазина
      let currentItemConfig = ITEMS_STAT_DB[cleanItemId];
      if (!currentItemConfig && global.SERVER_SHOP_DATABASE && global.SERVER_SHOP_DATABASE[cleanItemId]) {
        currentItemConfig = global.SERVER_SHOP_DATABASE[cleanItemId];
      }

      if (currentItemConfig) {
        // Автоматически определяем требуемый уровень из конфига магазина
        if (currentItemConfig.level) requiredLevel = currentItemConfig.level;

        // Если в конфиге магазина (SERVER_SHOP_DATABASE) уже записан slotType — берем его!
        if (currentItemConfig.slotType) {
          slotType = currentItemConfig.slotType;
        } else {
          // Запасной старый парсер слотов по ключевым словам в имени ID
          const id = cleanItemId;
          if (id.includes('sword') || id.includes('mace') || id.includes('dagger') || id.includes('knife') || id.includes('glaive') || id.includes('pillar') || id.includes('warhammer') || id.includes('breaker') || id.startsWith('assassin_stiletto')) slotType = 'mainHand';
          if (id.includes('halberd') || id.includes('claymore') || id.includes('broadsword') || id.includes('splitter') || id.includes('cleaver') || id.includes('harvester') || id.includes('scythe') || id.includes('maul')) slotType = 'twoHanded';
          if (id.includes('shield') || id.includes('buckler') || id.includes('parry') || id.includes('aegis') || id.includes('screen') || id.includes('mirror') || id.includes('wall') || id.includes('bulwark') || id.includes('scutum')) slotType = 'offHand';
          if (id.includes('cap') || id.includes('hood') || id.includes('mask') || id.includes('goggles') || id.includes('visage') || id.includes('crown') || id.includes('helm') || id.includes('barbute') || id.includes('visor') || id.includes('galea') || id.includes('armet')) slotType = 'head';
          if (id.includes('armor') || id.includes('vest') || id.includes('jacket') || id.includes('coat') || id.includes('shroud') || id.includes('harness') || id.includes('garb') || id.includes('robes') || id.includes('cuirass') || id.includes('gi') || id.includes('plate') || id.includes('chain') || id.includes('hauberk') || id.includes('breastplate') || id.includes('lorica') || id.includes('carapace')) slotType = 'body';
          if (id.includes('boots') || id.includes('shoes') || id.includes('treads') || id.includes('greaves') || id.includes('tabi') || id.includes('caligae') || id.includes('sabatons') || id.includes('sollerets')) slotType = 'legs';
          if (id.includes('gloves') || id.includes('wraps') || id.includes('bracers') || id.includes('grips') || id.includes('claws') || id.includes('hands') || id.includes('touch') || id.includes('gauntlets') || id.includes('manica') || id.includes('fists') || id.includes('crags')) slotType = 'gloves';
          if (id.includes('amulet') || id.includes('talisman') || id.includes('choker') || id.includes('chain') || id.includes('collar') || id.includes('pendant') || id.includes('necklace') || id.includes('gorget') || id.includes('torc') || id.includes('relic')) slotType = 'neck';
          if (id.includes('ring') || id.includes('loop') || id.includes('band') || id.includes('seal') || id.includes('coil') || id.includes('cyclone') || id.includes('signet')) slotType = 'ring';
        }

        // Ручные старые перегрузки уровней для совместимости
        if (cleanItemId === 'iron_sword' || cleanItemId === 'leather_armor' || cleanItemId === 'leather_gloves') requiredLevel = 2;
        if (cleanItemId === 'steel_mace' || cleanItemId === 'wolf_amulet' || cleanItemId === 'lucky_ring') requiredLevel = 3;
        if (cleanItemId === 'heavy_halberd' || cleanItemId === 'ruby_ring') requiredLevel = 5;
      } else if (SERVER_CONSUMABLES_SLOTS[cleanItemId]) {
        slotType = SERVER_CONSUMABLES_SLOTS[cleanItemId];
      }

      if (!slotType) return socket.emit('error', 'Этот предмет нельзя экипировать!');
      if (cloudLevel < requiredLevel) return socket.emit('error', `🔒 Требуется уровень: ${requiredLevel}`);

      const invTab = (slotType === 'potion' || slotType === 'scroll') ? 'consumables' : 'equipment';
      if (!inventory[invTab]) inventory[invTab] = [];
      
      const inv = inventory[invTab];

      // 🔥 ШАГ 3: Ищем предмет в рюкзаке по UUID, а если пришел старый сырой ID — ищем по ID
      const itemIdx = inv.findIndex(i => i.uuid === itemUuidOrId || i.id === itemUuidOrId);

      if (itemIdx === -1) return socket.emit('error', 'У вас нет этого предмета в рюкзаке!');

      // Логика расходников (зелья и свитки со стаком до 5 штук)
      if (slotType === 'potion' || slotType === 'scroll') {
        const currentEquipped = equipped[slotType];
        const availableInInv = Number(inv[itemIdx].count || 1);
        let alreadyEquippedCount = 0;

        if (currentEquipped && typeof currentEquipped === 'object' && currentEquipped.id) {
          if (currentEquipped.id === cleanItemId) {
            alreadyEquippedCount = Number(currentEquipped.count || 0);
            if (alreadyEquippedCount >= 5) return socket.emit('error', 'В этот слот уже взят maximal стак!');
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
              const existRing = inventory.equipment.find(i => i.id === oldRingId);
              if (existRing) existRing.count = (existRing.count || 1) + 1;
              else inventory.equipment.push({ id: oldRingId, count: 1 });
            }
          }
          equipped.rings[ringIndex] = cleanItemId;
        } else {
          // Если вещь двуручная (mainHand + левая рука блокируется) или одевается в левую руку как леворучное оружие (offHand)
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

          if (slotType === 'offHand' && (equipped.mainHand === 'heavy_halberd' || cleanItemId.includes('twoHanded'))) {
            return socket.emit('error', '⚠️ Нельзя взять щит или второе оружие с двуручником!');
          }

          const oldItemId = equipped[targetSlot];
          if (oldItemId) {
            const existOld = inventory.equipment.find(i => i.id === oldItemId);
            if (existOld) existOld.count = (existOld.count || 1) + 1;
            else inventory.equipment.push({ id: oldItemId, count: 1 });
          }

          // Записываем чистый ID на куклу
          equipped[targetSlot] = cleanItemId;
        }

        // Удаляем конкретный экземпляр шмотки из рюкзака по индексу UUID
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

      // 🛡️ Проверяем лимит сумки перед снятием шмотки
      const exists = inventory[invTab].find(i => i.id === itemId);
      if (inventory[invTab].length >= 30 && (invTab !== 'consumables' && invTab !== 'resources')) {
        return socket.emit('error', '⚠️ Сумка переполнена! Некуда снять вещь.');
      }

      // 🔥 ИСПРАВЛЕНО: Расходники и ресурсы стакаем, а для ШМОТОК всегда создаем новый уникальный UUID
      if (exists && (invTab === 'consumables' || invTab === 'resources')) {
        exists.count = (exists.count || 1) + countToReturn;
      } else {
        // Подстраховка названий и эмодзи для дефолтных вещей города
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
        
        // Генерируем новый легальный UUID для шмотки, чтобы её можно было переодеть без F5
        const returnedInstance = {
          uuid: `${itemId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          id: itemId,
          name: name,
          icon: icon,
          count: 1
        };

        inventory[invTab].push(returnedInstance);
      }

      // Снимаем вещь с куклы в ОЗУ сервера
      if (slotKey === 'ring' && ringIndex !== null) {
        equipped.rings[ringIndex] = null;
      } else {
        equipped[slotKey] = null;
      }

      // Записываем чистые транзакции в облако Supabase
      await sb.from('players').update({ inventory, equipped }).eq('id', nUserId);
      await triggerLoadGameSuccess(nUserId, socket, sb);

    } catch (e) {
      console.error("❌ Критический сбой при снятии экипировки:", e);
      socket.emit('error', 'Ошибка сервера при снятии экипировки.');
    }
  });

};