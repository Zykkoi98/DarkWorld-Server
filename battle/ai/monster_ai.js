// ============================================================================
// ===== 🤖 ИИ МОБОВ (MONSTER_AI.JS) =====
// ===== Простой ИИ: атака случайной зоны, защита по статам =====
// ============================================================================

const engine = require('../battle_engine');

const ZONES = ['head', 'breast', 'torso', 'belt', 'legs'];

/**
 * Сделать ход за моба
 * @param {Object} bot - моб
 * @param {Array} aliveEnemies - список живых врагов
 * @param {Object} options - { rand }
 */
function makeTurn(bot, aliveEnemies, options = {}) {
  const { rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min } = options;

  if (!aliveEnemies || aliveEnemies.length === 0) return null;
  if (bot.currentHp <= 0 || !bot.isBot) return null;

  const target = aliveEnemies[rand(0, aliveEnemies.length - 1)];
  const { maxAttacks, maxDefends } = engine.getCombatLimits(bot);

  // Блоки
  const defends = [];
  while (defends.length < maxDefends) {
    const z = ZONES[rand(0, ZONES.length - 1)];
    if (!defends.includes(z)) defends.push(z);
  }

  // Атака
  let attack;
  if (maxAttacks === 2) {
    attack = [
      ZONES[rand(0, ZONES.length - 1)],
      ZONES[rand(0, ZONES.length - 1)]
    ];
  } else {
    attack = ZONES[rand(0, ZONES.length - 1)];
  }

  return {
    targetUuid: target.uuid,
    attack,
    defends
  };
}

module.exports = { makeTurn };