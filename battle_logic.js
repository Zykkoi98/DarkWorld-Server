// ============================================================================
// ===== 🚀 БОЕВОЙ ДВИЖОК DARK WORLD С МОДИФИКАТОРАМИ БК (BATTLE_LOGIC.JS) =====
// ===== ЧАСТЬ 1 ИЗ 2: СЕТЕВЫЕ ОБРАБОТЧИКИ ЛОББИ, PvE ОХОТЫ И PvP ДУЭЛЕЙ =====
// ============================================================================

const dbHelper = require('./db_helper');
const ZONE_NAMES = { head: "Голову", breast: "Грудь", torso: "Торс", belt: "Пояс", legs: "Ноги" };

const CONSUMABLE_DATABASE = {
  'hp_potion_small': { name: 'Малое зелье HP', heal: 25 },
  'hp_potion_big':   { name: 'Большое зелье HP', heal: 60 },
  'fish_soup':       { name: 'Уха из таверны', heal: 40 }
};

const ITEMS_STAT_DB = dbHelper.ITEMS_STAT_DB;

function getEquipmentBonus(equipped, bonusKey) {
  if (!equipped) return 0;
  let totalBonus = 0;
  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand', 'extra'];
  slots.forEach(slot => {
    const itemId = equipped[slot];
    if (itemId && ITEMS_STAT_DB[itemId] && ITEMS_STAT_DB[itemId][bonusKey] !== undefined) {
      totalBonus += ITEMS_STAT_DB[itemId][bonusKey];
    }
  });
  if (equipped.rings && Array.isArray(equipped.rings)) {
    equipped.rings.forEach(itemId => {
      if (itemId && ITEMS_STAT_DB[itemId] && ITEMS_STAT_DB[itemId][bonusKey] !== undefined) {
        totalBonus += ITEMS_STAT_DB[itemId][bonusKey];
      }
    });
  }
  return totalBonus;
}

function sanitizeTeam(team) {
  return team.map(f => ({
    uuid: f.uuid, name: f.name, icon: f.icon, level: f.level,
    currentHp: f.currentHp, maxHp: f.maxHp, isBot: f.isBot,
    hasSubmitted: !!f.turn, equipped: f.equipped || null 
  }));
}

module.exports = function(io, socket, sb, activeRooms) {
  const triggerLoadGameSuccess = dbHelper.triggerLoadGameSuccess;
  const getServerMaxHp = dbHelper.getServerMaxHp;
  const getServerCorrectLevelByXp = dbHelper.getServerCorrectLevelByXp;

  socket.on('arena_get_lobby', async () => {
    try {
      const nowISO = new Date().toISOString();
      const { data, error } = await sb.from('arena_lobby').select('*').gt('arena_expires_at', nowISO);
      if (!error && data) socket.emit('arena_lobby_data', data);
    } catch (e) { console.error(e); }
  });

  socket.on('arena_create_request', async ({ playerData, currentHp }) => {
    try {
      const expiresAt = new Date(Date.now() + 180000).toISOString();
      const { error } = await sb.from('arena_lobby').upsert({
        id: Number(playerData.id), name: playerData.name, level: Number(playerData.level || 1), hp: Number(currentHp), arena_expires_at: expiresAt
      });
      if (!error) io.emit('arena_lobby_updated');
    } catch (e) { console.error(e); }
  });

  socket.on('arena_cancel_request', async ({ userId }) => {
    try {
      const { error } = await sb.from('arena_lobby').delete().eq('id', Number(userId));
      if (!error) io.emit('arena_lobby_updated');
    } catch (e) { console.error(e); }
  });

  socket.on('arena_accept_challenge_request', async ({ myId, opponentId, playerData, currentHp }) => {
    try {
      const nMyId = Number(myId); const nOpponentId = Number(opponentId);
      const { data, error } = await sb.from('arena_lobby').delete().eq('id', nOpponentId).select();
      if (error || !data || data.length === 0) return socket.emit('error', 'Вызов уже принят другим гладиатором!');
      await sb.from('arena_lobby').delete().eq('id', nMyId);

      const roomId = `room_pvp_${opponentId}_vs_${myId}_${Date.now()}`;
      const { data: oppData, error: oppErr } = await sb.from('players').select('*').eq('id', nOpponentId).maybeSingle();
      if (oppErr || !oppData) return socket.emit('error', 'Не удалось загрузить профиль соперника.');

      initiatePvpMatch(roomId, playerData, currentHp, oppData, activeRooms, io);
    } catch (e) { console.error(e); }
  });

  socket.on('check_active_battle_directly', ({ userId }, callback) => {
    const sUserId = String(userId);
    const activeRoomId = Object.keys(activeRooms).find(roomId => 
      activeRooms[roomId].teamA.some(f => String(f.id) === sUserId) || activeRooms[roomId].teamB.some(f => String(f.id) === sUserId)
    );
    callback({ activeRoomId: activeRoomId || null });
  });

  socket.on('reconnect_to_battle', ({ roomId, userId }) => {
    const room = activeRooms[roomId]; if (!room) return socket.emit('error', 'Бой уже завершился.');
    const sUserId = String(userId);
    const pFighter = [...room.teamA, ...room.teamB].find(f => String(f.id) === sUserId);
    if (pFighter) {
      pFighter.socketId = socket.id; socket.join(roomId);
      socket.emit('battle_init_data', { roomId: roomId, turnCount: room.turnCount, myUuid: pFighter.uuid, teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB) });
    }
  });

  socket.on('search_pve_match', async ({ playerData, monsterKey, count }) => {
    try {
      const sPlayerId = String(playerData.id); const nPlayerId = Number(playerData.id);
      await sb.from('arena_lobby').delete().eq('id', nPlayerId); io.emit('arena_lobby_updated');

      const existingRoomId = Object.keys(activeRooms).find(rId => activeRooms[rId].teamA.some(fighter => fighter.id === sPlayerId));
      if (existingRoomId) {
        const existingRoom = activeRooms[existingRoomId];
        const pFighter = existingRoom.teamA.find(fighter => fighter.id === sPlayerId);
        if (pFighter) pFighter.socketId = socket.id; socket.join(existingRoomId);
        return socket.emit('battle_init_data', { roomId: existingRoomId, turnCount: existingRoom.turnCount, myUuid: pFighter ? pFighter.uuid : `player_${sPlayerId}`, teamA: sanitizeTeam(existingRoom.teamA), teamB: sanitizeTeam(existingRoom.teamB) });
      }

      const monsterCount = Math.min(5, Math.max(1, Number(count || 1)));
      const { data: dbMonster } = await sb.from('bots').select('*').eq('id', monsterKey).maybeSingle();
      const { data: dbPlayer } = await sb.from('players').select('*').eq('id', nPlayerId).single();
      if (!dbMonster || !dbPlayer) return socket.emit('error', 'Ошибка инициализации PvE.');

      const roomId = `room_pve_${dbPlayer.id}_${Date.now()}`; const pMaxHp = getServerMaxHp(dbPlayer);
      const teamA = [{
        uuid: `player_${dbPlayer.id}`, id: String(dbPlayer.id), name: dbPlayer.name, icon: '👤', isBot: false,
        level: Number(dbPlayer.level), strength: Number(dbPlayer.strength), agility: Number(dbPlayer.agility), endurance: Number(dbPlayer.endurance), luck: Number(dbPlayer.luck),
        currentHp: Math.min(Number(dbPlayer.hp), pMaxHp), maxHp: pMaxHp, socketId: socket.id, turn: null,
        gold: Number(dbPlayer.gold), xp: Number(dbPlayer.xp), statpoints: Number(dbPlayer.statpoints), equipped: dbPlayer.equipped || {}, inventory: dbPlayer.inventory || {}, afkTurns: 0 
      }];
      const teamB = []; const mMaxHp = getServerMaxHp(dbMonster);
      for (let i = 0; i < monsterCount; i++) {
        teamB.push({
          uuid: `bot_${dbMonster.id}_${i}_${Date.now()}`, id: dbMonster.id, name: monsterCount > 1 ? `${dbMonster.name} #${i + 1}` : dbMonster.name, icon: dbMonster.icon, isBot: true, level: Number(dbMonster.level),
          strength: Number(dbMonster.strength), agility: Number(dbMonster.agility), endurance: Number(dbMonster.endurance), luck: Number(dbMonster.luck),
          currentHp: mMaxHp, maxHp: mMaxHp, rewardXp: Number(dbMonster.reward_xp), rewardGold: Number(dbMonster.reward_gold), turn: null
        });
      }
      activeRooms[roomId] = { id: roomId, type: 'pve', teamA, teamB, turnCount: 1, timeoutRef: null };
      socket.join(roomId);
      socket.emit('battle_init_data', { roomId, turnCount: 1, myUuid: `player_${dbPlayer.id}`, teamA: sanitizeTeam(teamA), teamB: sanitizeTeam(teamB) });
      startServerTurnTimer(roomId, activeRooms, io);
    } catch (err) { socket.emit('error', `Внутренняя ошибка: ${err.message}`); }
  });
    // --- 7. ОБРАБОТЧИК: ПРИЕМ ХОДА (АТАКА / БЛОК) ---
  socket.on('submit_turn', ({ roomId, targetUuid, attack, defends }) => {
    const room = activeRooms[roomId]; if (!room) return;
    const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
    if (!fighter || fighter.currentHp <= 0 || fighter.turn) return;

    fighter.turn = { targetUuid, attack, defends: defends || [] }; 
    fighter.afkTurns = 0;
    
    let canExecuteRound = false;
    if (room.type === 'pve') {
      const awaitingPvE = room.teamA.filter(p => !p.isBot && p.currentHp > 0 && !p.turn);
      if (awaitingPvE.length === 0) canExecuteRound = true;
    } else if (room.type === 'pvp') {
      const alivePlayers = [...room.teamA, ...room.teamB].filter(p => p.currentHp > 0);
      const submittedTurns = [...room.teamA, ...room.teamB].filter(p => p.turn !== null && p.currentHp > 0);
      if (submittedTurns.length === alivePlayers.length) canExecuteRound = true;
    }
    if (canExecuteRound) { 
      clearTimeout(room.timeoutRef); 
      executeRoundCalculations(roomId, activeRooms, io); 
    }
  });

  // --- 8. ОБРАБОТЧИК: ИСПОЛЬЗОВАНИЕ ЗЕЛИЙ В БОЮ ---
  socket.on('instant_use_potion', async ({ roomId }) => {
    const room = activeRooms[roomId]; if (!room) return;
    const fighter = room.teamA.find(p => p.socketId === socket.id); 
    if (!fighter || fighter.currentHp <= 0) return;
    
    const potionSlot = fighter.equipped?.potion;
    if (potionSlot && typeof potionSlot === 'object' && potionSlot.id && potionSlot.count > 0) {
      const potionData = CONSUMABLE_DATABASE[potionSlot.id];
      if (potionData) {
        fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + potionData.heal); 
        potionSlot.count--;
        if (potionSlot.count <= 0) fighter.equipped.potion = null;
        
        io.to(roomId).emit('battle_effect_potion', { 
          uuid: fighter.uuid, currentHp: fighter.currentHp, equipped: fighter.equipped, 
          logMsg: `🧪 <strong>${fighter.name}</strong> выпил ${potionData.name} (+${potionData.heal} HP)!` 
        });
        await sb.from('players').update({ hp: fighter.currentHp, equipped: fighter.equipped }).eq('id', Number(fighter.id));
      }
    }
  });
    // --- 9. ВНУТРЕННЯЯ ФУНКЦИЯ: СБОРКА PvP КОМНАТЫ ---
  function initiatePvpMatch(roomId, playerData, p1Hp, p2Data, activeRooms, io) {
    const setupStats = (p) => ({
      strength: Number(p.strength ?? p.stats?.strength ?? 1), 
      agility: Number(p.agility ?? p.stats?.agility ?? 1), 
      endurance: Number(p.endurance ?? p.stats?.endurance ?? 1), 
      luck: Number(p.luck ?? p.stats?.luck ?? 1), 
      equipped: p.equipped || {}
    });
    const p1Stats = setupStats(playerData); const p2Stats = setupStats(p2Data);
    const p1MaxHp = getServerMaxHp(p1Stats); const p2MaxHp = getServerMaxHp(p2Stats);

    const teamA = [{
      uuid: `player_${playerData.id}`, id: String(playerData.id), name: playerData.name, icon: '👤', isBot: false, level: Number(playerData.level ?? 1), ...p1Stats, currentHp: Math.min(Number(p1Hp || p1MaxHp), p1MaxHp), maxHp: p1MaxHp, socketId: null, turn: null, afkTurns: 0
    }];
    const teamB = [{
      uuid: `player_${p2Data.id}`, id: String(p2Data.id), name: p2Data.name, icon: '👤', isBot: false, level: Number(p2Data.level ?? 1), ...p2Stats, currentHp: Math.min(Number(p2Data.hp || p2MaxHp), p2MaxHp), maxHp: p2MaxHp, socketId: null, turn: null, afkTurns: 0
    }];
    activeRooms[roomId] = { id: roomId, type: 'pvp', teamA, teamB, turnCount: 1, timeoutRef: null };
    setTimeout(() => { io.emit('arena_lobby_updated'); io.emit('arena_redirect_to_battle', { roomId }); }, 150);
    startServerTurnTimer(roomId, activeRooms, io);
  }

  // --- 10. ВНУТРЕННЯЯ ФУНКЦИЯ: ТАЙМЕР АФК КЛИЕНТОВ (30 СЕКУНД) ---
  function startServerTurnTimer(roomId, activeRooms, io) {
    const room = activeRooms[roomId]; if (!room) return;
    if (room.timeoutRef) clearTimeout(room.timeoutRef);
    room.timeoutRef = setTimeout(() => {
      if (!activeRooms[roomId]) return;
      const allFighters = [...room.teamA, ...room.teamB];
      allFighters.forEach(f => {
        if (!f.isBot && f.currentHp > 0 && !f.turn) {
          f.afkTurns = (f.afkTurns || 0) + 1;
          const aliveEnemies = (room.teamA.includes(f) ? room.teamB : room.teamA).filter(e => e.currentHp > 0);
          f.turn = { targetUuid: aliveEnemies.length > 0 ? aliveEnemies[0].uuid : null, attack: null, defends: [] };
        }
      });
      executeRoundCalculations(roomId, activeRooms, io);
    }, 30000); 
  }
  // --- 11. ВНУТРЕННЯЯ ФУНКЦИЯ: СЕРВЕРНЫЙ КАЛЬКУЛЯТОР БОЯ И ОБМЕНА УДАРАМИ ---
  function executeRoundCalculations(roomId, activeRooms, io) {
    const room = activeRooms[roomId]; if (!room) return;
    const logs = []; const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    let afkFighter = [...room.teamA, ...room.teamB].filter(f => !f.isBot && f.currentHp > 0).find(f => (f.afkTurns || 0) >= 3);
    if (afkFighter) {
      logs.push(`🛑 Гладиатор <strong>${afkFighter.name}</strong> застыл. Техническое поражение.`);
      afkFighter.currentHp = 0;
      let res = room.teamA.every(f => f.currentHp <= 0) ? 'lose' : 'win';
      if (room.type === 'pve') finalizePveBattle(room, res, logs, room.turnCount, io);
      else finalizePvpBattle(room, res, logs, room.turnCount, io);
      return;
    }

    if (room.type === 'pve') {
      room.teamB.forEach(bot => {
        if (bot.currentHp <= 0) return;
        const targets = room.teamA.filter(a => a.currentHp > 0); if (targets.length === 0) return;
        const zones = ["head", "breast", "torso", "belt", "legs"]; const mDef = [];
        while (mDef.length < 2) { const rz = zones[rand(0, 4)]; if (!mDef.includes(rz)) mDef.push(rz); }
        bot.turn = { targetUuid: targets[rand(0, targets.length - 1)].uuid, attack: zones[rand(0, 4)], defends: mDef };
      });
    }

    let queue = [...room.teamA, ...room.teamB];
    queue.forEach(attacker => {
      if (attacker.currentHp <= 0 || !attacker.turn || !attacker.turn.targetUuid) return;
      let target = [...room.teamA, ...room.teamB].find(f => f.uuid === attacker.turn.targetUuid);
      if (!target || target.currentHp <= 0) {
        const alive = (room.teamA.includes(attacker) ? room.teamB : room.teamA).filter(t => t.currentHp > 0);
        if (alive.length === 0) return; target = alive[0];
      }
      if (attacker.uuid === target.uuid || attacker.turn.attack === null) return;

      if (target.turn && target.turn.defends.includes(attacker.turn.attack)) {
        logs.push(`🛡️ <strong>${target.name}</strong> заблокировал удар от <strong>${attacker.name}</strong> в ${ZONE_NAMES[attacker.turn.attack]}.`);
        return;
      }

      // БК-МЕХАНИКА: Уворот (Ловкость)
      const evadeChance = Math.min(75, Math.max(5, 5 + Math.floor((dbHelper.getServerMfInv(target) - dbHelper.getServerMfAntiInv(attacker)) / 10)));
      if (rand(1, 100) <= evadeChance) {
        logs.push(`🏹 <strong>${target.name}</strong> увернулся от удара <strong>${attacker.name}</strong> в ${ZONE_NAMES[attacker.turn.attack]}!`);
        return;
      }

      // БК-МЕХАНИКА: Крит (Удача)
      const critChance = Math.min(65, Math.max(5, 5 + Math.floor((dbHelper.getServerMfCrit(attacker) - dbHelper.getServerMfAntiCrit(target)) / 10)));
      const isCrit = rand(1, 100) <= critChance;

      let dmg = Math.floor(2 + ((Number(attacker.strength || 1) + getEquipmentBonus(attacker.equipped, 'strength')) * 1.5)) + getEquipmentBonus(attacker.equipped, 'atk');
      if (isCrit) dmg = Math.floor(dmg * 2.0);

      dmg = Math.max(1, dmg - dbHelper.getServerDef(target));
      target.currentHp = Math.max(0, Number(target.currentHp || 0) - dmg);
      logs.push(`⚔️ <strong>${attacker.name}</strong> нанес <strong>${target.name}</strong> <strong>${dmg}</strong> урона в ${ZONE_NAMES[attacker.turn.attack]} ${isCrit ? '💥 КРИТ!' : ''}`);
    });
     room.teamA.forEach(f => f.turn = null); room.teamB.forEach(f => f.turn = null);
    const isADead = room.teamA.every(f => f.currentHp <= 0); const isBDead = room.teamB.every(f => f.currentHp <= 0);
    const currentRound = room.turnCount; room.turnCount++;

    if (isADead || isBDead || room.turnCount > 40) {
      let result = isADead && isBDead ? 'draw' : (!isADead ? 'win' : 'lose');
      
      [...room.teamA, ...room.teamB].forEach(p => {
        if (p.socketId) {
          let resType = room.type === 'pvp' ? (room.teamA.some(f => f.uuid === p.uuid) ? result : (result === 'win' ? 'lose' : (result === 'lose' ? 'win' : 'draw'))) : result;
          io.to(p.socketId).emit('round_result', { turnCount: currentRound, logs: logs, isOver: true, resultType: resType, teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB) });
        }
      });
      if (room.type === 'pve') finalizePveBattle(room, result, logs, currentRound, io);
      else finalizePvpBattle(room, result, logs, currentRound, io);
      setTimeout(() => { delete activeRooms[room.id]; }, 1200);
    } else {
      [...room.teamA, ...room.teamB].forEach(p => { if (p.socketId) io.to(p.socketId).emit('round_result', { turnCount: currentRound, logs: logs, isOver: false, teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB) }); });
      startServerTurnTimer(roomId, activeRooms, io);
    }
  }

  // --- 12. ВНУТРЕННЯЯ ФУНКЦИЯ: ФИНАЛИЗАЦИЯ PvE И СИНХРОНИЗАЦИЯ НАГРАД ---
  async function finalizePveBattle(room, result, logs, finalRound, io) {
    const player = room.teamA[0]; if (!player) return;
    let xpG = 0; let goldG = 0;
    if (result === 'win') {
      room.teamB.forEach(m => { xpG += Number(m.rewardXp || 0); goldG += Number(m.rewardGold || 0); });
      player.gold += goldG; player.xp += xpG;
      const oldL = player.level; const correctL = dbHelper.getServerCorrectLevelByXp(player.xp);
      if (correctL > oldL) { player.statpoints = (player.statpoints || 0) + ((correctL - oldL) * 5); player.level = correctL; player.currentHp = dbHelper.getServerMaxHp(player); }
    } else player.currentHp = Math.max(1, Math.floor(dbHelper.getServerMaxHp(player) * 0.2));

    try { await sb.from('players').update({ gold: Number(player.gold), xp: Number(player.xp), hp: Number(player.currentHp), level: Number(player.level), statpoints: Number(player.statpoints) }).eq('id', Number(player.id)); } catch (err) { console.error(err); }
  }

  // --- 13. ВНУТРЕННЯЯ ФУНКЦИЯ: ФИНАЛИЗАЦИЯ PvP ДУЭЛЕЙ ---
  async function finalizePvpBattle(room, result, logs, finalRound, io) {
    const playerA = room.teamA[0]; const playerB = room.teamB[0]; if (!playerA || !playerB) return;
    const goldReward = 25;
    const calcXp = (w, l) => Math.floor((Number(l || 1) * 15) * (l > w ? 1 + ((l - w) * 0.25) : Math.max(0.1, 1 - ((w - l) * 0.20))));

    try {
      const [dbA, dbB] = await Promise.all([sb.from('players').select('*').eq('id', Number(playerA.id)).maybeSingle(), sb.from('players').select('*').eq('id', Number(playerB.id)).maybeSingle()]);
      if (!dbA.data || !dbB.data) return;
      const rA = dbA.data; const rB = dbB.data;
      const pKA = rA.statpoints !== undefined ? 'statpoints' : 'statPoints'; const pKB = rB.statpoints !== undefined ? 'statpoints' : 'statPoints';

      let gA = dbHelper.safeReadField(rA, 'gold', 0); let xA = dbHelper.safeReadField(rA, 'xp', 0); let lA = dbHelper.safeReadField(rA, 'level', 1); let sA = dbHelper.safeReadField(rA, pKA, 0);
      let gB = dbHelper.safeReadField(rB, 'gold', 0); let xB = dbHelper.safeReadField(rB, 'xp', 0); let lB = dbHelper.safeReadField(rB, 'level', 1); let sB = dbHelper.safeReadField(rB, pKB, 0);

      const maxA = dbHelper.getServerMaxHp({ endurance: dbHelper.safeReadField(rA, 'endurance', 1) });
      const maxB = dbHelper.getServerMaxHp({ endurance: dbHelper.safeReadField(rB, 'endurance', 1) });
      let hpA = maxA; let hpB = maxB;

      if (result === 'win') {
        gA += goldReward; xA += calcXp(lA, lB);
        let cLA = dbHelper.getServerCorrectLevelByXp(xA); if (cLA > lA) { sA += (cLA - lA) * 5; lA = cLA; }
        hpA = Math.max(1, Number(playerA.currentHp)); hpB = Math.max(1, Math.floor(maxB * 0.2));
      } else if (result === 'lose') {
        gB += goldReward; xB += calcXp(lB, lA);
        let cLB = dbHelper.getServerCorrectLevelByXp(xB); if (cLB > lB) { sB += (cLB - lB) * 5; lB = cLB; }
        hpA = Math.max(1, Math.floor(maxA * 0.2)); hpB = Math.max(1, Number(playerB.currentHp));
      } else { hpA = Math.max(1, Math.floor(maxA * 0.2)); hpB = Math.max(1, Math.floor(maxB * 0.2)); }

      await Promise.all([
        sb.from('players').update({ gold: Number(gA), xp: Number(xA), level: Number(lA), [pKA]: Number(sA), hp: Number(hpA) }).eq('id', Number(playerA.id)),
        sb.from('players').update({ gold: Number(gB), xp: Number(xB), level: Number(lB), [pKB]: Number(sB), hp: Number(hpB) }).eq('id', Number(playerB.id))
      ]);
    } catch (err) { console.error(err); }
  }
};