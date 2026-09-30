// ============================================================================
// ===== 📚 РЕЕСТР КОНФИГОВ БОЯ (CONFIGS/INDEX.JS) =====
// ============================================================================

const towerConfig = require('./tower_config');
const arenaPvpConfig = require('./arena_pvp_config');
const worldConfig = require('./world_config');

const CONFIGS = {
  tower: towerConfig,
  arena_pvp: arenaPvpConfig,
  world: worldConfig
  // world_boss: require('./world_boss_config'),   // заготовка
  // dungeon: require('./dungeon_config')           // заготовка
};

function getConfig(battleType) {
  const config = CONFIGS[battleType];
  if (!config) throw new Error(`Неизвестный тип боя: ${battleType}`);
  return config;
}

module.exports = { getConfig, CONFIGS };