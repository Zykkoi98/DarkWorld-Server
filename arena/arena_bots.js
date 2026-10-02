// ============================================================================
// ===== 🤖 ГЕНЕРАТОР PVP-БОТОВ (ARENA_BOTS.JS) =====
// ===== Создаёт бойцов-ботов, скалированных под уровень игрока =====
// ============================================================================

const GAME_ITEMS_DATABASE = require('./../shop/shop_items_config');

// ============================================================================
// КОНСТАНТЫ
// ============================================================================

// Классы ботов → ID шаблона в таблице bots
const BOT_CLASSES = {
  dodger:  { templateId: 'pvp_bot_dodger',  label: 'Ловкач',  icon: '🗡️' },
  critter: { templateId: 'pvp_bot_critter', label: 'Критовик', icon: '🪓' },
  tank:    { templateId: 'pvp_bot_tank',    label: 'Танк',    icon: '🛡️' }
};

// Префиксы сета по классу (используются в shop_items_config.js)
const CLASS_GEAR_PREFIXES = {
  dodger:  ['rogue_', 'bandit_', 'thief_', 'mercenary_', 'assassin_', 'stalker_', 'shadow_', 'phantom_', 'gale_', 'grandmaster_'],
  critter: ['scratched_', 'savage_', 'barbarian_', 'fury_', 'seeker_', 'highland_', 'slasher_', 'ravager_', 'berserk_', 'blood_', 'reaper_', 'hellfire_', 'executioner_', 'warlord_'],
  tank:    ['wooden_', 'recruit_', 'militia_', 'iron_', 'guard_', 'knight_', 'order_', 'guardian_', 'centurion_', 'ancient_', 'gothic_', 'titan_', 'paladin_', 'immortal_']
};

// ============================================================================
// УТИЛИТЫ
// ============================================================================

function getRandomClass() {
  const classes = Object.keys(BOT_CLASSES);   // ['dodger', 'critter', 'tank']
  return classes[Math.floor(Math.random() * classes.length)];
}

/**
 * Ближайший уровень сета для заданного уровня бота.
 * Сеты идут: 1, 3, 5, 7, 9, 11, 13, 15, 17, 19
 */
function getGearSetLevel(botLevel) {
  if (botLevel <= 1) return 1;
  if (botLevel >= 19) return 19;
  // Округляем вниз до нечётного
  return Math.floor((botLevel - 1) / 2) * 2 + 1;
}

function getMaxKey(obj) {
  let maxKey = null;
  let maxVal = -Infinity;
  for (const k in obj) {
    if (obj[k] > maxVal) {
      maxVal = obj[k];
      maxKey = k;
    }
  }
  return maxKey;
}

// ============================================================================
// СКАЛИРОВАНИЕ СТАТОВ
// ============================================================================

/**
 * Скалирует статы шаблона под уровень.
 * Итоговая сумма всегда = 4 + (targetLevel × 5)
 */
function scaleBotStats(templateStats, targetLevel) {
  const targetTotal = 4 + (targetLevel * 5);

  const templateTotal =
    (templateStats.strength || 1) +
    (templateStats.agility || 1) +
    (templateStats.endurance || 1) +
    (templateStats.luck || 1);

  const ratio = targetTotal / templateTotal;

  let scaled = {
    strength:  Math.max(1, Math.round((templateStats.strength  || 1) * ratio)),
    agility:   Math.max(1, Math.round((templateStats.agility   || 1) * ratio)),
    endurance: Math.max(1, Math.round((templateStats.endurance || 1) * ratio)),
    luck:      Math.max(1, Math.round((templateStats.luck      || 1) * ratio))
  };

  // 🔥 Подгоняем сумму чтобы была РОВНО targetTotal
  let diff = targetTotal - (scaled.strength + scaled.agility + scaled.endurance + scaled.luck);

  let safety = 1000;   // защита от бесконечного цикла
  while (diff > 0 && safety-- > 0) {
    const k = getMaxKey(scaled);
    scaled[k]++;
    diff--;
  }
  while (diff < 0 && safety-- > 0) {
    const k = getMaxKey(scaled);
    if (scaled[k] > 1) {
      scaled[k]--;
      diff++;
    } else {
      // не можем уменьшить — распределяем по остальным
      let decreased = false;
      for (const key of ['strength', 'agility', 'endurance', 'luck']) {
        if (scaled[key] > 1) {
          scaled[key]--;
          diff++;
          decreased = true;
          break;
        }
      }
      if (!decreased) break;
    }
  }

  return scaled;
}

// ============================================================================
// ПОДБОР ШМОТА
// ============================================================================

/**
 * Найти все предметы класса по слоту и уровню сета.
 */
function findItemsBySlot(classType, slotType, setLevel) {
  const prefixes = CLASS_GEAR_PREFIXES[classType] || [];
  const result = [];

  for (const id in GAME_ITEMS_DATABASE) {
    const item = GAME_ITEMS_DATABASE[id];
    if (!item) continue;
    if (item.slotType !== slotType) continue;
    if (item.level !== setLevel) continue;

    // Проверяем принадлежность классу по префиксу
    const belongs = prefixes.some(p => id.startsWith(p));
    if (!belongs) continue;

    result.push({ id, ...item });
  }

  return result;
}

/**
 * Случайный элемент из массива.
 */
function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Собрать комплект шмота бота.
 */
function pickGearSet(classType, botLevel) {
  const setLevel = getGearSetLevel(botLevel);

  const equipped = {
    head: null, body: null, legs: null, gloves: null, neck: null,
    mainHand: null, offHand: null,
    rings: [null, null, null],
    potion: null, scroll: null
  };

  // Базовые слоты
  const slots = ['head', 'body', 'legs', 'gloves', 'neck'];
  slots.forEach(slot => {
    const items = findItemsBySlot(classType, slot, setLevel);
    const picked = pickRandom(items);
    if (picked) equipped[slot] = picked.id;
  });

  // 🔥 Оружие — рандомно
  if (classType === 'dodger') {
    // Ловкач: дуалы (mainHand + offHand) ИЛИ одноруч + щит
    const mainWeapons = findItemsBySlot(classType, 'mainHand', setLevel);
    const offWeapons = findItemsBySlot(classType, 'offHand', setLevel);

    const mainPicked = pickRandom(mainWeapons);
    if (mainPicked) equipped.mainHand = mainPicked.id;

    const useShield = Math.random() < 0.5;
    if (useShield) {
      // Ищем щит (по name содержит "щит" или slotType "offHand" с бонусом def)
      const shields = offWeapons.filter(w => {
        const name = (w.name || '').toLowerCase();
        return name.includes('щит') || name.includes('баклер') || name.includes('эгида') ||
               name.includes('оберег') || name.includes('бастион') || name.includes('зеркало');
      });
      const shield = pickRandom(shields.length > 0 ? shields : offWeapons);
      if (shield) equipped.offHand = shield.id;
    } else {
      // Дуалы — обычное оффхенд оружие
      const daggers = offWeapons.filter(w => {
        const name = (w.name || '').toLowerCase();
        return name.includes('кинжал') || name.includes('нож') || name.includes('крис') ||
               name.includes('клинок') || name.includes('тесак') || name.includes('кортик');
      });
      const off = pickRandom(daggers.length > 0 ? daggers : offWeapons);
      if (off) equipped.offHand = off.id;
    }

  } else if (classType === 'critter') {
    // Критовик: двуруч ИЛИ одноруч + оффхенд
    const useTwoHanded = Math.random() < 0.5;

    if (useTwoHanded) {
      const twoHanded = findItemsBySlot(classType, 'twoHanded', setLevel);
      const picked = pickRandom(twoHanded);
      if (picked) {
        equipped.mainHand = picked.id;
        equipped.offHand = null;
      } else {
        // Fallback — если двуруча нет
        const mainWeapons = findItemsBySlot(classType, 'mainHand', setLevel);
        const mainPicked = pickRandom(mainWeapons);
        if (mainPicked) equipped.mainHand = mainPicked.id;
      }
    } else {
      const mainWeapons = findItemsBySlot(classType, 'mainHand', setLevel);
      const offWeapons = findItemsBySlot(classType, 'offHand', setLevel);

      const mainPicked = pickRandom(mainWeapons);
      if (mainPicked) equipped.mainHand = mainPicked.id;

      const offPicked = pickRandom(offWeapons);
      if (offPicked) equipped.offHand = offPicked.id;
    }

  } else if (classType === 'tank') {
    // Танк: всегда одноруч + щит
    const mainWeapons = findItemsBySlot(classType, 'mainHand', setLevel);
    const offWeapons = findItemsBySlot(classType, 'offHand', setLevel);

    const mainPicked = pickRandom(mainWeapons);
    if (mainPicked) equipped.mainHand = mainPicked.id;

    const shields = offWeapons.filter(w => {
      const name = (w.name || '').toLowerCase();
      return name.includes('щит') || name.includes('баклер') || name.includes('эгида') ||
             name.includes('бастион') || name.includes('обруч');
    });
    const shield = pickRandom(shields.length > 0 ? shields : offWeapons);
    if (shield) equipped.offHand = shield.id;
  }

  // 🔥 Кольца — 3 штуки (как у игрока)
  const rings = findItemsBySlot(classType, 'ring', setLevel);
  for (let i = 0; i < 3; i++) {
    const r = pickRandom(rings);
    if (r) equipped.rings[i] = r.id;
  }

  return equipped;
}

// ============================================================================
// ГЛАВНАЯ ФУНКЦИЯ
// ============================================================================

/**
 * Создать бота под заданный уровень.
 * @param {number} targetLevel — уровень бота
 * @param {number} slotIndex — индекс для уникального UUID и имени
 * @param {string} forcedClass — принудительный класс (опционально)
 * @returns {Promise<Object>} fighter-объект для battle_core
 */
async function createBotForLevel(targetLevel, slotIndex = 0, forcedClass = null) {
  const classType = forcedClass || getRandomClass();
  const classInfo = BOT_CLASSES[classType];

  // 1. Статы (используем шаблон из константы — не из БД, чтобы не ждать)
  // Базовый шаблон Lv 1 для каждого класса
  const baseTemplates = {
    dodger:  { strength: 2, agility: 4, endurance: 2, luck: 1 },
    critter: { strength: 2, agility: 1, endurance: 2, luck: 4 },
    tank:    { strength: 3, agility: 1, endurance: 4, luck: 1 }
  };

  const template = baseTemplates[classType];
  const scaled = scaleBotStats(template, targetLevel);

  // 2. Шмот
  const equipped = pickGearSet(classType, targetLevel);

  // 3. UUID — уникальный
  const uuid = `bot_pvp_${classType}_${slotIndex}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  // 4. Имя
  const name = `${classInfo.label} ${classInfo.icon} #${slotIndex + 1}`;

    // 5. HP — через общий dbHelper (единая формула)
    const dbHelper = require('./../db_helper');
    const maxHp = dbHelper.getServerMaxHp({
        level: targetLevel,
        endurance: scaled.endurance,
        equipped: equipped
    });

  return {
    uuid,
    id: `pvp_bot_${classType}_${slotIndex}`,
    name,
    icon: classInfo.icon,
    isBot: true,
    level: targetLevel,
    strength: scaled.strength,
    agility: scaled.agility,
    endurance: scaled.endurance,
    luck: scaled.luck,
    currentHp: maxHp,
    maxHp: maxHp,
    equipped: equipped,
    inventory: { equipment: [], resources: [], consumables: [] },
    avatar: 'assets/monsters/monster1.jpg',
    turn: null,
    afkTurns: 0,
    // 🔥 Флаг для arena_rewards — за ботов XP в 2 раза меньше
    isPvpBot: true
  };
}

/**
 * Считает суммарный бонус от шмота по ключу.
 */
function calcGearBonus(equipped, bonusKey) {
  if (!equipped) return 0;
  let total = 0;

  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand'];
  slots.forEach(slot => {
    const raw = equipped[slot];
    const itemId = (raw && typeof raw === 'object') ? raw.id : raw;
    if (!itemId) return;
    const item = GAME_ITEMS_DATABASE[itemId];
    if (!item || !item.bonus) return;
    if (item.bonus[bonusKey] !== undefined) total += item.bonus[bonusKey];
    if (item.bonus.stats && item.bonus.stats[bonusKey] !== undefined) total += item.bonus.stats[bonusKey];
  });

  if (Array.isArray(equipped.rings)) {
    equipped.rings.forEach(raw => {
      const itemId = (raw && typeof raw === 'object') ? raw.id : raw;
      if (!itemId) return;
      const item = GAME_ITEMS_DATABASE[itemId];
      if (!item || !item.bonus) return;
      if (item.bonus[bonusKey] !== undefined) total += item.bonus[bonusKey];
      if (item.bonus.stats && item.bonus.stats[bonusKey] !== undefined) total += item.bonus.stats[bonusKey];
    });
  }

  return total;
}

module.exports = {
  createBotForLevel,
  scaleBotStats,
  pickGearSet,
  getGearSetLevel,
  getRandomClass,
  BOT_CLASSES
};