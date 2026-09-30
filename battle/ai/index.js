// ============================================================================
// ===== 📚 РЕЕСТР ИИ (AI/INDEX.JS) =====
// ============================================================================

const monsterAI = require('./monster_ai');

const AIS = {
  simple_monster: monsterAI
  // boss_ai: require('./boss_ai')
};

function getAI(aiType) {
  return AIS[aiType] || null;
}

module.exports = { getAI, AIS };