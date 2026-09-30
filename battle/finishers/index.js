// ============================================================================
// ===== 📚 РЕЕСТР ФИНАЛИЗЕРОВ (FINISHERS/INDEX.JS) =====
// ============================================================================

const towerFinisher = require('./tower_finisher');
const arenaFinisher = require('./arena_finisher');
const worldFinisher = require('./world_finisher');

const FINISHERS = {
  tower_finisher: towerFinisher,
  arena_finisher: arenaFinisher,
  world_finisher: worldFinisher
  // world_boss_finisher: require('./world_boss_finisher'),
  // dungeon_finisher: require('./dungeon_finisher')
};

function getFinisher(name) {
  const f = FINISHERS[name];
  if (!f) throw new Error(`Неизвестный финализатор: ${name}`);
  return f;
}

module.exports = { getFinisher, FINISHERS };