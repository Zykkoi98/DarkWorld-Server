// ============================================================================
// ===== 🗺️ КОНФИГ БОЯ НА КАРТЕ МИРА (WORLD_CONFIG.JS) =====
// ===== Заменяет forest — бой с мобами на клетке мира =====
// ============================================================================

module.exports = {
  battleType: 'world',

  // Лимиты бойцов
  playerLimits: { min: 1, max: 1 },       // пока 1vs1 vs мобы
  monsterLimits: { min: 1, max: 5 },      // до 5 мобов в группе

  // Волны / фазы — заготовки
  waves: null,
  phases: null,

  // Кулдаун — на карте мира нет кулдауна между боями.
  // Мобы агрессивные (нападают сами) или статичные (нападаешь сам).
  cooldown: null,

  // Луты — формулы
  lootTable: [
    { type: 'gold', source: 'rewardGold', chance: 100 },
    { type: 'xp',   source: 'rewardXp',   chance: 100 }
  ],

  // Тип ИИ
  aiType: 'simple_monster',

  // Финализатор
  finisher: 'world_finisher',

  // Таймер хода
  turnTimer: {
    baseMs: 60000,
    penaltyPerAfk: { 1: 30000, 2: 15000 },
    maxAfkTurns: 3
  },

  // Тип распределения (не используется в одиночном PvE)
  teamBalancing: null
};