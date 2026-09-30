
// ============================================================================
// ===== ⚔️ КОНФИГ PvP-АРЕНЫ (ARENA_PVP_CONFIG.JS) =====
// ============================================================================

module.exports = {
  battleType: 'arena_pvp',

  playerLimits: { min: 1, max: 10 },
  monsterLimits: { min: 0, max: 0 },

  waves: null,
  phases: null,

  cooldown: null,   // PvP без кулдауна

  lootTable: [
    // Победитель получает 25 монет и XP
    { type: 'gold', source: 'pvpGoldReward', chance: 100 },
    { type: 'xp',   source: 'pvpXpReward',   chance: 100 }
  ],

  aiType: null,     // Нет ИИ — все игроки
  finisher: 'arena_finisher',

  turnTimer: {
    baseMs: 60000,
    penaltyPerAfk: { 1: 30000, 2: 15000 },
    maxAfkTurns: 3
  },

  // Заготовка под режимы
  teamBalancing: 'manual',   // 'manual' | 'random' (хаотический)
  pvpReward: {
    gold: 25,
    xpBase: 15,          // ×уровень проигравшего
    xpMultiplierUp: 1.25,   // если проигравший выше уровнем
    xpMultiplierDown: 0.8   // если ниже
  }
};