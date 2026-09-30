// ============================================================================
// ===== 🔀 МАРШРУТИЗАТОР БОЯ (BATTLE_ROUTER.JS) =====
// ===== Прокладка между handlers и configs/finishers =====
// ============================================================================

const configs = require('./configs');
const finishers = require('./finishers');

function getConfig(battleType) {
  return configs.getConfig(battleType);
}

function getFinisher(name) {
  return finishers.getFinisher(name);
}

/**
 * Собрать команду мобов для PvE
 */
function buildMonsterTeam(monstersData, config, params = {}) {
  const count = Math.min(
    config.monsterLimits.max,
    Math.max(config.monsterLimits.min, params.count || 1)
  );

  const team = [];
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  for (let i = 0; i < count; i++) {
    const base = monstersData[rand(0, monstersData.length - 1)];
    team.push({
      uuid: `bot_${base.id}_${i}_${Date.now()}_${rand(100, 999)}`,
      id: base.id,
      name: count > 1 ? `${base.name} #${i + 1}` : base.name,
      icon: base.icon || '👹',
      isBot: true,
      level: Number(base.level || 1),
      strength: Number(base.strength || 1),
      agility: Number(base.agility || 1),
      endurance: Number(base.endurance || 1),
      luck: Number(base.luck || 1),
      currentHp: 0,   // заполнит вызывающий
      maxHp: 0,
      rewardXp: Number(base.reward_xp || 5),
      rewardGold: Number(base.reward_gold || 2),
      turn: null,
      afkTurns: 0
    });
  }

  return team;
}

/**
 * Построить команду игрока
 */
function buildPlayerTeam(playerData, dbRow) {
  return [{
    uuid: `player_${dbRow.id}`,
    id: String(dbRow.id),
    name: dbRow.name,
    icon: '👤',
    isBot: false,
    level: Number(dbRow.level || 1),
    strength: Number(dbRow.strength || 1),
    agility: Number(dbRow.agility || 1),
    endurance: Number(dbRow.endurance || 1),
    luck: Number(dbRow.luck || 1),
    currentHp: Number(dbRow.hp || 10),
    maxHp: 0,   // заполнит вызывающий
    equipped: dbRow.equipped || {},
    inventory: dbRow.inventory || {},
    turn: null,
    afkTurns: 0
  }];
}

module.exports = {
  getConfig,
  getFinisher,
  buildMonsterTeam,
  buildPlayerTeam
};
