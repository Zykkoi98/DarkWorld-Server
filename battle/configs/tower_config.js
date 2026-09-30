// ============================================================================
// ===== 🏰 КОНФИГ БОЯ В БАШНЕ (TOWER_CONFIG.JS) =====
// ============================================================================

module.exports = {
  battleType: 'tower',

  playerLimits: { min: 1, max: 1 },
  monsterLimits: { min: 1, max: 6 },

  waves: null,
  phases: null,

  // Башня использует ОТДЕЛЬНУЮ систему — tower_cooldown управляется tower_logic.js
  cooldown: null,

  // Награды считаются по специальной формуле (10% gold, 30% coins)
  lootTable: [
    { type: 'xp',         source: 'rewardXp', chance: 100 },
    { type: 'gold',       source: 'rewardGold', chance: 10 },
    { type: 'tower_coin', source: 'towerCoinDrop', chance: 30 }
  ],

  aiType: 'simple_monster',
  finisher: 'tower_finisher',

  turnTimer: {
    baseMs: 60000,
    penaltyPerAfk: { 1: 30000, 2: 15000 },
    maxAfkTurns: 3
  },

  teamBalancing: null,

  // Доп. параметры только для башни
  isTower: true,
  towerFloor: null   // заполняется при создании комнаты
};