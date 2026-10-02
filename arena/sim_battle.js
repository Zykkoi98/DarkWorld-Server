// ============================================================================
// ===== 🧪 СИМУЛЯЦИЯ БОЁВ ДЛЯ ТЕСТА БАЛАНСА =====
// ===== Запуск: node arena/sim_battle.js =====
// ============================================================================

const engine = require('./../battle/battle_engine');
const GAME_ITEMS_DATABASE = require('./../shop/shop_items_config');

// ============================================================================
// ГЕНЕРАЦИЯ БОЙЦОВ
// ============================================================================

function buildGearSet(classType, level) {
  const setLevel = level <= 1 ? 1 : Math.min(19, Math.floor((level - 1) / 2) * 2 + 1);

  const prefixes = {
    dodger: ['grandmaster_', 'gale_', 'phantom_', 'shadow_', 'stalker_'],
    critter: ['executioner_', 'warlord_', 'hellfire_', 'reaper_', 'berserk_'],
    tank: ['immortal_', 'aegis_', 'paladin_', 'titan_', 'gothic_']
  };

  const equipped = { head: null, body: null, legs: null, gloves: null, neck: null, mainHand: null, offHand: null, rings: [null, null, null] };

  const findItems = (slotType) => {
    const result = [];
    for (const id in GAME_ITEMS_DATABASE) {
      const item = GAME_ITEMS_DATABASE[id];
      if (item.slotType !== slotType) continue;
      if (item.level !== setLevel) continue;
      const belongs = prefixes[classType].some(p => id.startsWith(p));
      if (belongs) result.push({ id, ...item });
    }
    return result;
  };

  const pick = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;

  ['head', 'body', 'legs', 'gloves', 'neck'].forEach(slot => {
    const items = findItems(slot);
    const p = pick(items);
    if (p) equipped[slot] = p.id;
  });

  // Оружие
  if (classType === 'tank') {
    const mh = pick(findItems('mainHand'));
    if (mh) equipped.mainHand = mh.id;
    const off = pick(findItems('offHand'));
    if (off) equipped.offHand = off.id;
  } else if (classType === 'dodger') {
    const mh = pick(findItems('mainHand'));
    if (mh) equipped.mainHand = mh.id;
    const off = pick(findItems('offHand'));
    if (off) equipped.offHand = off.id;
  } else {
    // Критовик — 50/50 двуруч или дуалы
    if (Math.random() < 0.5) {
      const th = pick(findItems('twoHanded'));
      if (th) equipped.mainHand = th.id;
    } else {
      const mh = pick(findItems('mainHand'));
      if (mh) equipped.mainHand = mh.id;
      const off = pick(findItems('offHand'));
      if (off) equipped.offHand = off.id;
    }
  }

  // Кольца × 3
  const rings = findItems('ring');
  for (let i = 0; i < 3; i++) {
    const r = pick(rings);
    if (r) equipped.rings[i] = r.id;
  }

  return equipped;
}

function buildFighter(classType, level) {
  // Статы по классу: 4 + level*5 очков, распределены по профилю класса
  const total = 4 + level * 5;

  let str, agi, end, lck;
  if (classType === 'dodger') {
    str = Math.floor(total * 0.15);
    agi = Math.floor(total * 0.55);
    end = Math.floor(total * 0.15);
    lck = total - str - agi - end;
  } else if (classType === 'critter') {
    str = Math.floor(total * 0.25);
    agi = Math.floor(total * 0.10);
    end = Math.floor(total * 0.15);
    lck = total - str - agi - end;
  } else {
    str = Math.floor(total * 0.25);
    agi = Math.floor(total * 0.10);
    end = Math.floor(total * 0.55);
    lck = total - str - agi - end;
  }

  const equipped = buildGearSet(classType, level);

  const fighter = {
    uuid: `${classType}_${level}`,
    name: `${classType} Lv ${level}`,
    isBot: false,
    level,
    strength: str,
    agility: agi,
    endurance: end,
    luck: lck,
    equipped,
    turn: null,
    afkTurns: 0
  };

  const dbHelper = require('./../db_helper');
  fighter.maxHp = dbHelper.getServerMaxHp(fighter);
  fighter.currentHp = fighter.maxHp;

  return fighter;
}

// ============================================================================
// СИМУЛЯЦИЯ ОДНОГО БОЯ
// ============================================================================

function simulateBattle(fighterA, fighterB, maxRounds = 200) {
  // Клонируем
  const A = JSON.parse(JSON.stringify(fighterA));
  const B = JSON.parse(JSON.stringify(fighterB));

  A.turn = null;
  B.turn = null;

  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const zones = ['head', 'breast', 'torso', 'belt', 'legs'];
  const zoneNames = { head: 'Голову', breast: 'Грудь', torso: 'Торс', belt: 'Пояс', legs: 'Ноги' };

  let round = 0;
  while (A.currentHp > 0 && B.currentHp > 0 && round < maxRounds) {
    round++;

    // Ходы
    const aAtk = zones[rand(0, zones.length - 1)];
    const bAtk = zones[rand(0, zones.length - 1)];
    const aDef = [zones[rand(0, zones.length - 1)]];
    const bDef = [zones[rand(0, zones.length - 1)]];

    A.turn = { targetUuid: B.uuid, attack: aAtk, defends: aDef };
    B.turn = { targetUuid: A.uuid, attack: bAtk, defends: bDef };

    // A бьёт B
    const resAB = engine.calculateHit(A, B, aAtk, { rand, damageFactor: 1.0, zoneNames });
    if (resAB.hit) B.currentHp = Math.max(0, B.currentHp - resAB.damage);

    // B бьёт A (если жив)
    if (B.currentHp > 0) {
      const resBA = engine.calculateHit(B, A, bAtk, { rand, damageFactor: 1.0, zoneNames });
      if (resBA.hit) A.currentHp = Math.max(0, A.currentHp - resBA.damage);
    }
  }

  return {
    rounds: round,
    winner: A.currentHp > 0 && B.currentHp <= 0 ? 'A' : (B.currentHp > 0 && A.currentHp <= 0 ? 'B' : 'draw'),
    aHpLeft: A.currentHp,
    bHpLeft: B.currentHp,
    aMaxHp: A.maxHp,
    bMaxHp: B.maxHp,
    timedOut: round >= maxRounds
  };
}

// ============================================================================
// ЗАПУСК 100 СИМУЛЯЦИЙ
// ============================================================================

function runSimulations(classA, classB, level, numBattles = 100) {
  console.log(`\n🔬 СИМУЛЯЦИЯ: ${classA} Lv${level} vs ${classB} Lv${level} (${numBattles} боёв)\n`);

  const results = {
    aWins: 0,
    bWins: 0,
    draws: 0,
    timeouts: 0,
    avgRounds: 0,
    minRounds: Infinity,
    maxRounds: 0,
    roundList: []
  };

  for (let i = 0; i < numBattles; i++) {
    const fighterA = buildFighter(classA, level);
    const fighterB = buildFighter(classB, level);

    // Показываем статы только для первого боя
    if (i === 0) {
      const dbHelper = require('./../db_helper');
      const cpA = calculateCP(fighterA);
      const cpB = calculateCP(fighterB);
      console.log(`📊 Боец A (${classA}):`);
      console.log(`   STR: ${fighterA.strength}, AGI: ${fighterA.agility}, END: ${fighterA.endurance}, LCK: ${fighterA.luck}`);
      console.log(`   HP: ${fighterA.maxHp}, ATK: ${engine.getAtk(fighterA)}, DEF: ${engine.getDef(fighterA)}, CP: ${cpA}`);
      console.log(`📊 Боец B (${classB}):`);
      console.log(`   STR: ${fighterB.strength}, AGI: ${fighterB.agility}, END: ${fighterB.endurance}, LCK: ${fighterB.luck}`);
      console.log(`   HP: ${fighterB.maxHp}, ATK: ${engine.getAtk(fighterB)}, DEF: ${engine.getDef(fighterB)}, CP: ${cpB}`);
      console.log('');
    }

    const res = simulateBattle(fighterA, fighterB);

    if (res.winner === 'A') results.aWins++;
    else if (res.winner === 'B') results.bWins++;
    else if (res.timedOut) results.timeouts++;
    else results.draws++;

    results.roundList.push(res.rounds);
    results.avgRounds += res.rounds;
    if (res.rounds < results.minRounds) results.minRounds = res.rounds;
    if (res.rounds > results.maxRounds) results.maxRounds = res.rounds;
  }

  results.avgRounds = (results.avgRounds / numBattles).toFixed(1);

  console.log(`📈 РЕЗУЛЬТАТЫ:`);
  console.log(`   ${classA} побед: ${results.aWins} (${(results.aWins / numBattles * 100).toFixed(1)}%)`);
  console.log(`   ${classB} побед: ${results.bWins} (${(results.bWins / numBattles * 100).toFixed(1)}%)`);
  console.log(`   Ничьих: ${results.draws}`);
  console.log(`   Таймаутов (>200 раундов): ${results.timeouts}`);
  console.log(`   Средняя длина: ${results.avgRounds} раундов`);
  console.log(`   Мин/Макс: ${results.minRounds} / ${results.maxRounds}`);
  console.log('');

  return results;
}

function calculateCP(fighter) {
  const GAME_ITEMS_DATABASE = require('./../shop/shop_items_config');
  const base = fighter.level * 10;
  let gear = 0;
  const eq = fighter.equipped || {};
  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand'];
  slots.forEach(s => {
    const id = eq[s];
    if (id && GAME_ITEMS_DATABASE[id]?.level) gear += GAME_ITEMS_DATABASE[id].level * 2;
  });
  if (Array.isArray(eq.rings)) {
    eq.rings.forEach(id => {
      if (id && GAME_ITEMS_DATABASE[id]?.level) gear += GAME_ITEMS_DATABASE[id].level * 2;
    });
  }
  return base + gear;
}

// ============================================================================
// ГЛАВНАЯ
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════');
console.log('  🧪 БАЛАНСНЫЙ ТЕСТ (v1)');
console.log('═══════════════════════════════════════════════════════');

runSimulations('dodger', 'tank', 16, 100);
runSimulations('critter', 'tank', 16, 100);
runSimulations('tank', 'tank', 16, 100);
runSimulations('dodger', 'critter', 16, 100);

console.log('\n═══════════════════════════════════════════════════════');
console.log('  ✅ Готово');
console.log('═══════════════════════════════════════════════════════\n');