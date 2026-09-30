// ============================================================================
// ===== 🗂️ СОСТОЯНИЕ БОЯ (BATTLE_STATE.JS) =====
// ===== Map-структуры для O(1) поиска бойцов =====
// ============================================================================

function createFighterMap(teamA, teamB) {
  const map = new Map();
  teamA.forEach(f => map.set(f.uuid, f));
  teamB.forEach(f => map.set(f.uuid, f));
  return map;
}

function getFighter(room, uuid) {
  return room.fighters.get(uuid) || null;
}

function getAliveFighters(room, side) {
  const team = side === 'A' ? room.teamA : room.teamB;
  return team.filter(f => f.currentHp > 0);
}

function isTeamAlive(room, side) {
  return getAliveFighters(room, side).length > 0;
}

function getFighterTeam(room, uuid) {
  const a = room.teamA.find(f => f.uuid === uuid);
  if (a) return 'A';
  const b = room.teamB.find(f => f.uuid === uuid);
  if (b) return 'B';
  return null;
}

function getOpposingTeam(room, side) {
  return side === 'A' ? room.teamB : room.teamA;
}

function findFirstAliveOpponent(room, uuid) {
  const mySide = getFighterTeam(room, uuid);
  if (!mySide) return null;
  const opp = getOpposingTeam(room, mySide);
  return opp.find(f => f.currentHp > 0) || null;
}

function serializeFighter(fighter) {
  return {
    uuid: fighter.uuid,
    id: fighter.id,
    name: fighter.name,
    icon: fighter.icon,
    level: fighter.level,
    currentHp: fighter.currentHp,
    maxHp: fighter.maxHp,
    isBot: !!fighter.isBot,
    hasSubmitted: !!fighter.turn,
    afkTurns: fighter.afkTurns || 0,
    equipped: fighter.equipped || null
  };
}

function serializeTeam(team) {
  return team.map(serializeFighter);
}

module.exports = {
  createFighterMap,
  getFighter,
  getAliveFighters,
  isTeamAlive,
  getFighterTeam,
  getOpposingTeam,
  findFirstAliveOpponent,
  serializeFighter,
  serializeTeam
};