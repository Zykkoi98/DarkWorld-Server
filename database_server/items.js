const WEAPON_DATABASE = {
  'rusty_sword': { name: 'Ржавый меч', icon: '🗡️', slotType: 'mainHand', price: 10, level: 1, bonus: { atk: 2 } },
  'iron_sword': { name: 'Железный меч', icon: '⚔️', slotType: 'mainHand', price: 45, level: 2, bonus: { atk: 7 } },
  'wooden_shield': { name: 'Щит новичка', icon: '🛡️', slotType: 'offHand', price: 15, level: 1, bonus: { def: 2 } },
  'steel_mace': { name: 'Стальная булава', icon: '🔨', slotType: 'mainHand', price: 90, level: 3, bonus: { atk: 12 } },
  'heavy_halberd': { name: 'Тяжелая алебарда', icon: '🔱', slotType: 'twoHanded', price: 120, level: 5, bonus: { atk: 22 } }
};

const ARMOR_DATABASE = {
  'leather_cap': { name: 'Кожаная шапка', icon: '🪖', slotType: 'head', price: 20, level: 1, bonus: { def: 1, stats: { agility: 1 } } },
  'leather_armor': { name: 'Кожаная куртка', icon: '👕', slotType: 'body', price: 30, level: 2, bonus: { def: 4 } },
  'leather_boots': { name: 'Кожаные сапоги', icon: '🥾', slotType: 'legs', price: 18, level: 1, bonus: { def: 1, stats: { agility: 2 } } },
  'leather_gloves': { name: 'Кожаные перчатки', icon: '🧤', slotType: 'gloves', price: 15, level: 2, bonus: { def: 1, stats: { strength: 1 } } }
};

const JEWELRY_DATABASE = {
  'copper_ring': { name: 'Медное кольцо', icon: '💍', slotType: 'ring', price: 25, level: 1, bonus: { stats: { endurance: 1 } } },
  'wolf_amulet': { name: 'Амулет Волка', icon: '📿', slotType: 'neck', price: 60, level: 3, bonus: { stats: { strength: 2, luck: 1 } } },
  'lucky_ring': { name: 'Кольцо Фортуны', icon: '🪙', slotType: 'ring', price: 75, level: 3, bonus: { stats: { luck: 3 } } },
  'ruby_ring': { name: 'Рубиновое кольцо', icon: '💎', slotType: 'ring', price: 80, level: 5, bonus: { stats: { strength: 3 } } }
};

const CONSUMABLE_DATABASE = {
  'hp_potion_small': { name: 'Малое зелье HP', icon: '🧪', heal: 25, price: 8, desc: 'Восстанавливает 25 единиц здоровья.' },
  'hp_potion_big':   { name: 'Большое зелье HP', icon: '🍯', heal: 60, price: 20, desc: 'Восстанавливает 60 единиц здоровья.' },
  'fish_soup':       { name: 'Уха из таверны', icon: '🥣', heal: 40, price: 15, desc: 'Ароматный суп. Восстанавливает 40 HP.' },
  'blessing_scroll': { name: 'Свиток Удачи', icon: '📜', duration: 3, price: 50, desc: 'Древний свиток.' }
};

// Функция сквозного поиска предмета по базам на сервере
function serverGetItemData(itemId) {
  if (!itemId) return null;
  if (WEAPON_DATABASE[itemId]) return WEAPON_DATABASE[itemId];
  if (ARMOR_DATABASE[itemId]) return ARMOR_DATABASE[itemId];
  if (JEWELRY_DATABASE[itemId]) return JEWELRY_DATABASE[itemId];
  if (CONSUMABLE_DATABASE[itemId]) return CONSUMABLE_DATABASE[itemId];
  return null;
}

module.exports = {
  WEAPON_DATABASE,
  ARMOR_DATABASE,
  JEWELRY_DATABASE,
  CONSUMABLE_DATABASE,
  serverGetItemData
};