// ============================================================================
// ===== ⚔️ БОЕВОЙ ДВИЖОК (BATTLE_ENGINE.JS) =====
// ===== Чистые формулы: атака, защита, криты, увороты, урон =====
// ===== НЕ знает о комнатах, socket, БД. Только математика. =====
// ============================================================================

const dbHelper = require('../db_helper');

// ============================================================================
// БАЗОВЫЕ СТАТЫ БОЙЦА (с учётом экипировки)
// ============================================================================

function getEquipmentBonus(fighter, bonusKey) {
  return dbHelper.getEquipmentBonus(fighter.equipped || {}, bonusKey);
}

function getAtk(fighter) {
  const rawStr = fighter.strength ?? (fighter.stats?.strength) ?? 1;
  const totalStr = Number(rawStr) + getEquipmentBonus(fighter, 'strength');
  const baseAtk = Math.floor(2 + (totalStr * 1.5));
  return baseAtk + getEquipmentBonus(fighter, 'atk');
}

function getDef(fighter) {
  const rawEnd = fighter.endurance ?? (fighter.stats?.endurance) ?? 1;
  const baseEnd = Number(rawEnd);
  const gearEnd = getEquipmentBonus(fighter, 'endurance');
  return Math.floor((baseEnd + gearEnd) * 0.5) + getEquipmentBonus(fighter, 'def');
}

function getAgility(fighter) {
  const rawAgi = fighter.agility ?? (fighter.stats?.agility) ?? 1;
  return Number(rawAgi) + getEquipmentBonus(fighter, 'agility');
}

function getLuck(fighter) {
  const rawLuck = fighter.luck ?? (fighter.stats?.luck) ?? 1;
  return Number(rawLuck) + getEquipmentBonus(fighter, 'luck');
}

function getMaxHp(fighter) {
  return dbHelper.getServerMaxHp(fighter);
}

// ============================================================================
// ПРОВЕРКИ ПРЕДМЕТОВ
// ============================================================================

function isShield(itemId) {
  if (!itemId) return false;
  const itemData = dbHelper.findItemInAnyDatabase(itemId);
  if (itemData) {
    const name = (itemData.name || '').toLowerCase();
    const slotType = (itemData.slotType || '').toLowerCase();
    if (name.includes('щит') || name.includes('баклер') || name.includes('эгида') ||
        name.includes('скутум') || name.includes('бастион') || name.includes('зеркало мастера') ||
        name.includes('оберег') || name.includes('стена') || name.includes('гвардейский') ||
        name.includes('сетчатый') || name.includes('плетеный')) {
      return true;
    }
    if (slotType === 'shield') return true;
  }
  const id = String(itemId).toLowerCase();
  return id.includes('shield') || id.includes('buckler') || id.includes('aegis') ||
         id.includes('screen') || id.includes('mirror') || id.includes('wall') ||
         id.includes('scutum') || id.includes('bastion') || id.includes('parry');
}

function isTwoHanded(itemId) {
  if (!itemId) return false;
  const itemData = dbHelper.findItemInAnyDatabase(itemId);
  if (itemData && itemData.slotType === 'twoHanded') return true;
  return itemId === 'heavy_halberd' || String(itemId).includes('twoHanded');
}

// ============================================================================
// ЛИМИТЫ АТАК И БЛОКОВ
// ============================================================================

function getCombatLimits(fighter) {
  let maxAttacks = 1;
  let maxDefends = 1;

  const level = Number(fighter.level || 1);
  const equipped = fighter.equipped || {};

  const mainHand = equipped.mainHand;
  const offHand = equipped.offHand;

  const isShieldEquipped = isShield(offHand);
  const isTwoHandedEquipped = isTwoHanded(mainHand);

  // Атаки
  if (isTwoHandedEquipped) {
    maxAttacks = 1;
  } else if (offHand && !isShieldEquipped) {
    maxAttacks = 2;   // дуалы
  } else {
    maxAttacks = 1;
  }

  // Блоки
  if (isShieldEquipped) {
    maxDefends = 3;
  } else if (level <= 1) {
    maxDefends = 2;
  } else {
    maxDefends = 1;
  }

  return { maxAttacks, maxDefends };
}

// ============================================================================
// РАСЧЁТ ОДНОГО УДАРА
// ============================================================================

/**
 * @param {Object} attacker - боец-атакующий
 * @param {Object} defender - боец-защитник
 * @param {string} zone - зона удара (head, breast, torso, belt, legs)
 * @param {Object} options
 * @param {Function} options.rand - генератор случайных чисел (для тестов)
 * @param {number} options.damageFactor - множитель урона (1.3 для дуалов)
 * @param {Object} options.zoneNames - имена зон для логов
 * @returns {Object} результат удара
 */
function calculateHit(attacker, defender, zone, options = {}) {
  const {
    rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
    damageFactor = 1.0,
    zoneNames = { head: 'Голову', breast: 'Грудь', torso: 'Торс', belt: 'Пояс', legs: 'Ноги' }
  } = options;

  // 1. ПРОВЕРКА БЛОКА
  const defenderDefends = Array.isArray(defender.turn?.defends) ? defender.turn.defends : [];
  if (defenderDefends.includes(zone)) {
    return {
      hit: false,
      blocked: true,
      evaded: false,
      crit: false,
      damage: 0,
      log: `🛡️ <strong>${defender.name}</strong> заблокировал удар от <strong>${attacker.name}</strong> в ${zoneNames[zone] || zone}.`
    };
  }

  // 2. ПРОВЕРКА УВОРОТА
  const targetAgi = getAgility(defender);
  const attackerAgi = getAgility(attacker);

  const targetMfInv = (targetAgi * 10) + getEquipmentBonus(defender, 'mf_inv');
  const attackerMfAntiInv = (attackerAgi * 4) + getEquipmentBonus(attacker, 'mf_antiinv');

  let finalEvade = 5 + (targetAgi - attackerAgi) * 1 + Math.floor((targetMfInv - attackerMfAntiInv) / 10);
  const evadeChance = Math.min(70, Math.max(5, finalEvade));

  if (rand(1, 100) <= evadeChance) {
    return {
      hit: false,
      blocked: false,
      evaded: true,
      crit: false,
      damage: 0,
      log: `🏹 <strong>${defender.name}</strong> увернулся от удара <strong>${attacker.name}</strong> в ${zoneNames[zone] || zone}!`
    };
  }

  // 3. ПРОВЕРКА КРИТА
  const attackerLuck = getLuck(attacker);
  const defenderLuck = getLuck(defender);

  const attackerMfCrit = (attackerLuck * 10) + getEquipmentBonus(attacker, 'mf_crit');
  const defenderMfAntiCrit = (defenderLuck * 4) + getEquipmentBonus(defender, 'mf_anticrit');

  let finalCrit = 10 + (attackerLuck - defenderLuck) * 2 + Math.floor((attackerMfCrit - defenderMfAntiCrit) / 10);
  const critChance = Math.min(65, Math.max(5, finalCrit));
  const isCrit = rand(1, 100) <= critChance;

 // 4. РАСЧЁТ УРОНА
  // 🔥 КОМБИНИРОВАННАЯ ФОРМУЛА: процентный DEF + минимум 15% ATK
  let dmgRaw = Math.floor(getAtk(attacker) / damageFactor);
  if (isCrit) dmgRaw = Math.floor(dmgRaw * 2.0);

  const defTotal = getDef(defender);
  const defReduction = defTotal / (defTotal + 100);

  const minDmg = Math.max(1, Math.floor(dmgRaw * 0.15));
  let dmg = Math.max(minDmg, Math.floor(dmgRaw * (1 - defReduction)));

  return {
    hit: true,
    blocked: false,
    evaded: false,
    crit: isCrit,
    damage: dmg,
    log: `⚔️ <strong>${attacker.name}</strong> нанес <strong>${defender.name}</strong> <strong>${dmg}</strong> урона в ${zoneNames[zone] || zone} ${isCrit ? '💥 КРИТ!' : ''}`
  };
}

// ============================================================================
// ЭКСПОРТ
// ============================================================================

module.exports = {
  // Статы
  getAtk,
  getDef,
  getAgility,
  getLuck,
  getMaxHp,
  getEquipmentBonus,

  // Проверки
  isShield,
  isTwoHanded,
  getCombatLimits,

  // Расчёт
  calculateHit
};