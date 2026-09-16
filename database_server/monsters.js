// ============================================================================
// ===== 👹 БАЗА ДАННЫХ МОНСТРОВ И ПРОТИВНИКОВ СЕРВЕРА =====
// ============================================================================

const MONSTER_DATABASE = {
  'wild_wolf': { 
    name: 'Дикий волк', 
    icon: '🐺', 
    stats: { strength: 8, agility: 12, endurance: 8, intellect: 2, luck: 8 }, 
    rewardXp: 15, 
    rewardGold: 10 
  },
  'goblin': { 
    name: 'Гоблин-грабитель', 
    icon: '👺', 
    stats: { strength: 12, agility: 15, endurance: 10, intellect: 5, luck: 15 }, 
    rewardXp: 40, 
    rewardGold: 35 
  },
  'stone_golem': { 
    name: 'Каменный голем', 
    icon: '🪨', 
    stats: { strength: 25, agility: 5, endurance: 25, intellect: 1, luck: 5 }, 
    rewardXp: 100, 
    rewardGold: 50 
  }
};
// Экспортируем базу данных для подключения в server.js
module.exports = MONSTER_DATABASE;