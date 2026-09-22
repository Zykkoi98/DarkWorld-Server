const dbHelper = require('./db_helper');

const ZONE_NAMES = { head: "Голову", breast: "Грудь", torso: "Торс", belt: "Пояс", legs: "Ноги" };

const CONSUMABLE_DATABASE = {
  'hp_potion_small': { name: 'Малое зелье HP', heal: 25 },
  'hp_potion_big':   { name: 'Большое зелье HP', heal: 60 },
  'fish_soup':       { name: 'Уха из таверны', heal: 40 }
};

const ITEMS_STAT_DB = {
  'rusty_sword':    { atk: 2 },
  'iron_sword':     { atk: 7 },
  'steel_mace':     { atk: 12 },
  'heavy_halberd':  { atk: 22 },
  'wooden_shield':  { def: 2 },
  'leather_cap':    { def: 1, agility: 1 },
  'leather_armor':  { def: 4 },
  'leather_boots':  { def: 1, agility: 2 },
  'leather_gloves': { def: 1, strength: 1 },
  'copper_ring':    { endurance: 1 },
  'wolf_amulet':    { strength: 2, luck: 1 },
  'lucky_ring':     { luck: 3 },
  'ruby_ring':      { strength: 3 }
};

// Вспомогательная функция сбора бонусов экипировки для расчета боя
function getEquipmentBonus(equipped, bonusKey) {
  if (!equipped) return 0;
  let totalBonus = 0;
  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand', 'extra'];
  
  slots.forEach(slot => {
    const itemId = equipped[slot];
    if (itemId && ITEMS_STAT_DB[itemId]) {
      const item = ITEMS_STAT_DB[itemId];
      if (item[bonusKey] !== undefined) totalBonus += item[bonusKey];
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

// Честный серверный расчет боевых параметров персонажей
function getServerAtk(fighter) {
  const baseStrength = Number(fighter.strength || 1);
  const gearStrength = getEquipmentBonus(fighter.equipped, 'strength');
  const baseAtk = Math.floor(2 + ((baseStrength + gearStrength) * 1.5));
  return baseAtk + getEquipmentBonus(fighter.equipped, 'atk');
}

function getServerDef(fighter) {
  const baseEndurance = Number(fighter.endurance || 1);
  const gearEndurance = getEquipmentBonus(fighter.equipped, 'endurance');
  return Math.floor((baseEndurance + gearEndurance) * 0.5) + getEquipmentBonus(fighter.equipped, 'def');
}

function getServerAgility(fighter) {
  return Number(fighter.agility || 1) + getEquipmentBonus(fighter.equipped, 'agility');
}

function getServerLuck(fighter) {
  return Number(fighter.luck || 1) + getEquipmentBonus(fighter.equipped, 'luck');
}

function sanitizeTeam(team) {
  return team.map(f => ({
    uuid: f.uuid, name: f.name, icon: f.icon, level: f.level,
    currentHp: f.currentHp, maxHp: f.maxHp, isBot: f.isBot,
    hasSubmitted: !!f.turn, equipped: f.equipped || null 
  }));
}

// Главный экспорт модуля боевой логики
module.exports = function(io, socket, sb, activeRooms) {
  
  const triggerLoadGameSuccess = dbHelper.triggerLoadGameSuccess;
  const getServerMaxHp = dbHelper.getServerMaxHp;
  const getServerCorrectLevelByXp = dbHelper.getServerCorrectLevelByXp;

  // --- 1. ОБРАБОТЧИК: ЗАПРОС СПИСКА ДУЭЛЕЙ НА АРЕНЕ ---
  socket.on('arena_get_lobby', async () => {
    try {
      const nowISO = new Date().toISOString();
      const { data, error } = await sb.from('arena_lobby').select('*').gt('arena_expires_at', nowISO);
      if (!error && data) socket.emit('arena_lobby_data', data);
    } catch (e) { console.error(e); }
  });

  // --- 2. ОБРАБОТЧИК: ПУБЛИКАЦИЯ СВОЕГО ВЫЗОВА В ЛОББИ ---
  socket.on('arena_create_request', async ({ playerData, currentHp }) => {
    try {
      const expiresAt = new Date(Date.now() + 180000).toISOString(); // 3 минуты жизни заявки
      const { error } = await sb.from('arena_lobby').upsert({
        id: Number(playerData.id),
        name: playerData.name,
        level: Number(playerData.level || 1),
        hp: Number(currentHp),
        arena_expires_at: expiresAt
      });
      if (!error) io.emit('arena_lobby_updated');
    } catch (e) { console.error(e); }
  });

  // --- 3. ОБРАБОТЧИК: ОТМЕНА СВОЕГО ВЫЗОВА В ЛОББИ ---
  socket.on('arena_cancel_request', async ({ userId }) => {
    try {
      const { error } = await sb.from('arena_lobby').delete().eq('id', Number(userId));
      if (!error) io.emit('arena_lobby_updated');
    } catch (e) { console.error(e); }
  });

  // --- 4. ОБРАБОТЧИК: ПРИНЯТИЕ ЧУЖОГО PvP ВЫЗОВА ---
  socket.on('arena_accept_challenge_request', async ({ myId, opponentId, playerData, currentHp }) => {
    try {
      const nMyId = Number(myId);
      const nOpponentId = Number(opponentId);

      // Атомарный перехват: кто первый удалил строку из лобби, тот и забрал бой
      const { data, error } = await sb.from('arena_lobby').delete().eq('id', nOpponentId).select();
      if (error || !data || data.length === 0) {
        return socket.emit('error', 'Вызов уже принят другим гладиатором!');
      }

      // Аннулируем собственную заявку, если она висела
      await sb.from('arena_lobby').delete().eq('id', nMyId);

      const roomId = `room_pvp_${opponentId}_vs_${myId}_${Date.now()}`;
      
      const { data: oppData, error: oppErr } = await sb.from('players').select('*').eq('id', nOpponentId).maybeSingle();
      if (oppErr || !oppData) {
        return socket.emit('error', 'Не удалось загрузить профиль соперника.');
      }

      initiatePvpMatch(roomId, playerData, currentHp, oppData, activeRooms, io);
    } catch (e) { 
      console.error(e); 
    }
  });

  // --- 5. ОБРАБОТЧИКИ РЕКОННЕКТОВ И ПРОВЕРКИ СЕССИЙ (АНТИ-СБОЙ F5) ---
  socket.on('check_active_battle_directly', ({ userId }, callback) => {
    const sUserId = String(userId);
    const activeRoomId = Object.keys(activeRooms).find(roomId => 
      activeRooms[roomId].teamA.some(f => String(f.id) === sUserId) ||
      activeRooms[roomId].teamB.some(f => String(f.id) === sUserId)
    );
    callback({ activeRoomId: activeRoomId || null });
  });

  socket.on('reconnect_to_battle', ({ roomId, userId }) => {
    const room = activeRooms[roomId];
    if (!room) return socket.emit('error', 'Бой уже завершился.');

    const sUserId = String(userId);
    const pFighter = [...room.teamA, ...room.teamB].find(f => String(f.id) === sUserId);

    if (pFighter) {
      pFighter.socketId = socket.id;
      socket.join(roomId);
      socket.emit('battle_init_data', {
        roomId: roomId, turnCount: room.turnCount, myUuid: pFighter.uuid,
        teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB)
      });
    }
  });

  socket.on('check_active_battle', ({ userId }) => {
    const sUserId = String(userId);
    const activeRoomId = Object.keys(activeRooms).find(roomId => 
      activeRooms[roomId].teamA.some(f => String(f.id) === sUserId) ||
      activeRooms[roomId].teamB.some(f => String(f.id) === sUserId)
    );
    if (activeRoomId) socket.emit('arena_redirect_to_battle', { roomId: activeRoomId });
  });

  // --- 6. ОБРАБОТЧИК: ЗАПУСК PvE БОЯ (ВЫХОД НА ПРИРОДУ) ---
  socket.on('search_pve_match', async ({ playerData, monsterKey, count }) => {
    try {
      const sPlayerId = String(playerData.id);
      const nPlayerId = Number(playerData.id);

      // Аннулируем вызов на Арене, так как игрок ушел в PvE лес
      await sb.from('arena_lobby').delete().eq('id', nPlayerId);
      io.emit('arena_lobby_updated');

      // Защита от дубликатов комнат
      const existingRoomId = Object.keys(activeRooms).find(rId => 
        activeRooms[rId].teamA.some(fighter => fighter.id === sPlayerId)
      );

      if (existingRoomId) {
        const existingRoom = activeRooms[existingRoomId];
        const pFighter = existingRoom.teamA.find(fighter => fighter.id === sPlayerId);
        if (pFighter) pFighter.socketId = socket.id;
        socket.join(existingRoomId);
        return socket.emit('battle_init_data', {
          roomId: existingRoomId, turnCount: existingRoom.turnCount,
          myUuid: pFighter ? pFighter.uuid : `player_${sPlayerId}`,
          teamA: sanitizeTeam(existingRoom.teamA), teamB: sanitizeTeam(existingRoom.teamB)
        });
      }

      const monsterCount = Math.min(5, Math.max(1, Number(count || 1)));
      const { data: dbMonster } = await sb.from('bots').select('*').eq('id', monsterKey).maybeSingle();
      const { data: dbPlayer } = await sb.from('players').select('*').eq('id', nPlayerId).single();

      if (!dbMonster || !dbPlayer) return socket.emit('error', 'Ошибка инициализации данных PvE.');

      const roomId = `room_pve_${dbPlayer.id}_${Date.now()}`;
      const pMaxHp = getServerMaxHp(dbPlayer);

      const teamA = [{
        uuid: `player_${dbPlayer.id}`, id: String(dbPlayer.id), name: dbPlayer.name, icon: '👤', isBot: false,
        level: Number(dbPlayer.level), strength: Number(dbPlayer.strength), agility: Number(dbPlayer.agility), endurance: Number(dbPlayer.endurance), luck: Number(dbPlayer.luck),
        currentHp: Math.min(Number(dbPlayer.hp), pMaxHp), maxHp: pMaxHp, socketId: socket.id, turn: null,
        gold: Number(dbPlayer.gold), xp: Number(dbPlayer.xp), statpoints: Number(dbPlayer.statpoints),
        equipped: dbPlayer.equipped || {}, inventory: dbPlayer.inventory || {}, afkTurns: 0 
      }];

      const teamB = [];
      const mMaxHp = getServerMaxHp(dbMonster);
      for (let i = 0; i < monsterCount; i++) {
        teamB.push({
          uuid: `bot_${dbMonster.id}_${i}_${Date.now()}`, id: dbMonster.id,
          name: monsterCount > 1 ? `${dbMonster.name} #${i + 1}` : dbMonster.name, icon: dbMonster.icon,
          isBot: true, level: Number(dbMonster.level), strength: Number(dbMonster.strength),
          agility: Number(dbMonster.agility), endurance: Number(dbMonster.endurance),
          luck: Number(dbMonster.luck), currentHp: mMaxHp, maxHp: mMaxHp, rewardXp: Number(dbMonster.reward_xp),
          rewardGold: Number(dbMonster.reward_gold), turn: null
        });
      }

      activeRooms[roomId] = { id: roomId, type: 'pve', teamA, teamB, turnCount: 1, timeoutRef: null };
      socket.join(roomId);
      
      socket.emit('battle_init_data', {
        roomId, turnCount: 1, myUuid: `player_${dbPlayer.id}`,
        teamA: sanitizeTeam(teamA), teamB: sanitizeTeam(teamB)
      });

      startServerTurnTimer(roomId, activeRooms, io);
    } catch (err) {
      socket.emit('error', `Внутренняя ошибка: ${err.message}`);
    }
  });

  // --- 7. ОБРАБОТЧИК: ПРИЕМ ХОДА (АТАКА / БЛОК) ---
   socket.on('submit_turn', ({ roomId, targetUuid, attack, defends }) => {
    const room = activeRooms[roomId];
    if (!room) return;

    // Ищем игрока просто по его сокету. Легко и быстро.
    let fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);

    // Если сокет моргнул, подстрахуем простым поиском живого человека в комнате
    if (!fighter) {
      fighter = [...room.teamA, ...room.teamB].find(p => !p.isBot && p.currentHp > 0);
      if (fighter) fighter.socketId = socket.id; // Тихонько обновили ID без циклов
    }

    if (!fighter || fighter.currentHp <= 0 || fighter.turn) return;

    fighter.turn = { targetUuid, attack, defends: defends || [] };
    fighter.afkTurns = 0; 

    let canExecuteRound = false;

    if (room.type === 'pve') {
      const awaitingPvE = room.teamA.filter(p => !p.isBot && p.currentHp > 0 && !p.turn);
      if (awaitingPvE.length === 0) canExecuteRound = true;
    } 
    else if (room.type === 'pvp') {
      // Раунд запускается строго когда у обоих живых игроков есть ходы
      const playerA = Array.isArray(room.teamA) ? room.teamA[0] : room.teamA;
      const playerB = Array.isArray(room.teamB) ? room.teamB[0] : room.teamB;
      
      if (playerA && playerB) {
        const isReadyA = (playerA.currentHp <= 0 || playerA.turn !== null);
        const isReadyB = (playerB.currentHp <= 0 || playerB.turn !== null);
        if (isReadyA && isReadyB) canExecuteRound = true;
      }
    }

    if (canExecuteRound) {
      clearTimeout(room.timeoutRef);
      executeRoundCalculations(roomId, activeRooms, io); 
    }
  });

  // --- 8. ОБРАБОТЧИК: ИСПОЛЬЗОВАНИЕ ЗЕЛИЙ В БОЮ ---
  socket.on('instant_use_potion', async ({ roomId }) => {
    const room = activeRooms[roomId];
    if (!room) return;

    const fighter = room.teamA.find(p => p.socketId === socket.id);
    if (!fighter || fighter.currentHp <= 0) return;

    const potionSlot = fighter.equipped?.potion;

    if (potionSlot && typeof potionSlot === 'object' && potionSlot.id && potionSlot.count > 0) {
      const potionData = CONSUMABLE_DATABASE[potionSlot.id];

      if (potionData) {
        fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + potionData.heal);
        potionSlot.count--;
        let displayCountLog = potionSlot.count;

        if (potionSlot.count <= 0) fighter.equipped.potion = null;

        io.to(roomId).emit('battle_effect_potion', {
          uuid: fighter.uuid, currentHp: fighter.currentHp, equipped: fighter.equipped, 
          logMsg: `🧪 <strong>${fighter.name}</strong> выпил ${potionData.name} (+${potionData.heal} HP)! Осталось: ${displayCountLog} шт.`
        });

        await sb.from('players').update({ hp: fighter.currentHp, equipped: fighter.equipped }).eq('id', Number(fighter.id));
      }
    }
  });

  // --- 9. ВНУТРЕННЯЯ ФУНКЦИЯ: СБОРКА PvP КОМНАТЫ С БАЛАНСОМ ХП ---
  function initiatePvpMatch(roomId, playerData, p1Hp, p2Data, activeRooms, io) {
    const p1Stats = {
      strength: Number(playerData.strength ?? playerData.stats?.strength ?? 1),
      agility: Number(playerData.agility ?? playerData.stats?.agility ?? 1),
      endurance: Number(playerData.endurance ?? playerData.stats?.endurance ?? 1),
      luck: Number(playerData.luck ?? playerData.stats?.luck ?? 1), // Интеллект полностью удален
      equipped: playerData.equipped || {}
    };

    const p2Stats = {
      strength: Number(p2Data.strength ?? p2Data.stats?.strength ?? 1),
      agility: Number(p2Data.agility ?? p2Data.stats?.agility ?? 1),
      endurance: Number(p2Data.endurance ?? p2Data.stats?.endurance ?? 1),
      luck: Number(p2Data.luck ?? p2Data.stats?.luck ?? 1), // Интеллект полностью удален
      equipped: p2Data.equipped || {}
    };

    const p1MaxHp = getServerMaxHp(p1Stats);
    const p2MaxHp = getServerMaxHp(p2Stats);

    const teamA = [{
      uuid: `player_${playerData.id}`, id: String(playerData.id), name: playerData.name, icon: '👤', isBot: false,
      level: Number(playerData.level ?? 1), strength: p1Stats.strength, agility: p1Stats.agility,
      endurance: p1Stats.endurance, intellect: p1Stats.intellect, luck: p1Stats.luck,
      currentHp: Math.min(Number(p1Hp || p1MaxHp), p1MaxHp), maxHp: p1MaxHp, socketId: null, turn: null,
      equipped: playerData.equipped || {}, inventory: playerData.inventory || {}, afkTurns: 0
    }];

    const teamB = [{
      uuid: `player_${p2Data.id}`, id: String(p2Data.id), name: p2Data.name, icon: '👤', isBot: false, 
      level: Number(p2Data.level ?? 1), strength: p2Stats.strength, agility: p2Stats.agility,
      endurance: p2Stats.endurance, intellect: p2Stats.intellect, luck: p2Stats.luck,
      currentHp: Math.min(Number(p2Data.hp || p2MaxHp), p2MaxHp), maxHp: p2MaxHp, socketId: null, turn: null,
      equipped: p2Data.equipped || {}, inventory: p2Data.inventory || {}, afkTurns: 0
    }];

    activeRooms[roomId] = { id: roomId, type: 'pvp', teamA, teamB, turnCount: 1, timeoutRef: null };
    console.log(`⚔️ [PvP ЗАПУСК] Комната: ${roomId} для ${playerData.name} vs ${p2Data.name}`);
    
    setTimeout(() => {
      io.emit('arena_lobby_updated');
      io.emit('arena_redirect_to_battle', { roomId: roomId });
    }, 150);

    startServerTurnTimer(roomId, activeRooms, io);
  }

  // --- 10. ВНУТРЕННЯЯ ФУНКЦИЯ: ТАЙМЕР АФК КЛИЕНТОВ (30 СЕКУНД) ---
  function startServerTurnTimer(roomId, activeRooms, io) {
    const room = activeRooms[roomId];
    if (!room) return;
    if (room.timeoutRef) clearTimeout(room.timeoutRef);

    room.timeoutRef = setTimeout(() => {
      if (!activeRooms[roomId]) return;
      
      console.log(`⏱️ [АФК ТРИГГЕР] Время на ход вышло в комнате ${roomId}.`);
      const allFighters = [...room.teamA, ...room.teamB];
      
      allFighters.forEach(f => {
        if (!f.isBot && f.currentHp > 0) {
          if (!f.turn) {
            f.afkTurns = (f.afkTurns || 0) + 1;
            const opposingTeam = room.teamA.includes(f) ? room.teamB : room.teamA;
            const aliveEnemies = opposingTeam.filter(e => e.currentHp > 0);
            
            f.turn = { 
              targetUuid: aliveEnemies.length > 0 ? aliveEnemies[0].uuid : null, 
              attack: null, 
              defends: [] 
            };
          } else {
            f.afkTurns = 0;
          }
        }
      });
      
      executeRoundCalculations(roomId, activeRooms, io);
    }, 60000); 
  }

  // --- 11. ВНУТРЕННЯЯ ФУНКЦИЯ: СЕРВЕРНЫЙ КАЛЬКУЛЯТОР БОЯ И ОБМЕНА УДАРАМИ ---
  function executeRoundCalculations(roomId, activeRooms, io) {
    const room = activeRooms[roomId];
    if (!room) return;

    const logs = [];
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    // Проверка тотальной АФК дисквалификации (3 пропуска подряд)
    const allHumanFighters = [...room.teamA, ...room.teamB].filter(f => !f.isBot && f.currentHp > 0);
    let afkDisqualifiedFighter = allHumanFighters.find(f => (f.afkTurns || 0) >= 3);

    if (afkDisqualifiedFighter) {
      logs.push(`🛑 Гладиатор <strong>${afkDisqualifiedFighter.name}</strong> застыл на месте слишком долго. Техническое поражение.`);
      afkDisqualifiedFighter.currentHp = 0;

      const isTeamADead = room.teamA.every(f => f.currentHp <= 0);
      const isTeamBDead = room.teamB.every(f => f.currentHp <= 0);
      let result = 'draw';
      if (!isTeamADead && isTeamBDead) result = 'win';
      if (isTeamADead && !isTeamBDead) result = 'lose';

      if (room.type === 'pve') finalizePveBattle(room, result, logs, room.turnCount, io);
      else if (room.type === 'pvp') finalizePvpBattle(room, result, logs, room.turnCount, io);
      return;
    }

    // Расчет ИИ монстров в режиме PvE
    if (room.type === 'pve') {
      room.teamB.forEach(bot => {
        if (bot.currentHp <= 0 || !bot.isBot) return;
        const aliveTargets = room.teamA.filter(a => a.currentHp > 0);
        if (aliveTargets.length === 0) return;

        const target = aliveTargets[rand(0, aliveTargets.length - 1)];
        const zones = ["head", "breast", "torso", "belt", "legs"];
        const mDefend = [];
        while (mDefend.length < 2) {
          const rz = zones[rand(0, 4)];
          if (!mDefend.includes(rz)) mDefend.push(rz);
        }
        bot.turn = { targetUuid: target.uuid, attack: zones[rand(0, 4)], defends: mDefend };
      });
    }

    // Сортировка очереди ходов по показателю серверной Ловкости
    let queue = [...room.teamA, ...room.teamB];
  
    queue.forEach(attacker => {
      if (attacker.currentHp <= 0 || !attacker.turn || !attacker.turn.targetUuid) return;

      let target = [...room.teamA, ...room.teamB].find(f => f.uuid === attacker.turn.targetUuid);
      if (!target || target.currentHp <= 0) {
        const opposingTeam = room.teamA.includes(attacker) ? room.teamB : room.teamA;
        const newAlive = opposingTeam.filter(t => t.currentHp > 0);
        if (newAlive.length === 0) return;
        target = newAlive[0];
      }

      if (attacker.uuid === target.uuid) return; // Защита от самоповреждений

      if (attacker.turn.attack === null) {
        logs.push(`❌ <strong>${attacker.name}</strong> пропустил фазу своей атаки.`);
        return;
      }

      if (target.turn && target.turn.defends.includes(attacker.turn.attack)) {
        logs.push(`🛡️ <strong>${target.name}</strong> заблокировал удар от <strong>${attacker.name}</strong> в ${ZONE_NAMES[attacker.turn.attack]}.`);
      } else {
        // 1. БК-МЕХАНИКА: Расчет Уворота цели против Антиуворота атакующего
        const evadeChance = Math.min(75, Math.max(5, 5 + Math.floor((dbHelper.getServerMfInv(target) - dbHelper.getServerMfAntiInv(attacker)) / 10)));
        const isEvaded = rand(1, 100) <= evadeChance;

        if (isEvaded) {
          logs.push(`🏹 <strong>${target.name}</strong> увернулся от удара <strong>${attacker.name}</strong> в ${ZONE_NAMES[attacker.turn.attack]}!`);
        } else {
          // 🔥 ИСПРАВЛЕНО: Код расчета урона выполнится ТОЛЬКО если уворота НЕ БЫЛО, без ломающих цикл return!
          
          // 2. БК-МЕХАНИКА: Расчет Крита атакующего против Антикрита цели
          const critChance = Math.min(65, Math.max(5, 5 + Math.floor((dbHelper.getServerMfCrit(attacker) - dbHelper.getServerMfAntiCrit(target)) / 10)));
          const isCrit = rand(1, 100) <= critChance;

          // Расчет базового физ-урона от Силы
          let dmg = Math.floor(2 + ((Number(attacker.strength || 1) + getEquipmentBonus(attacker.equipped, 'strength')) * 1.5)) + getEquipmentBonus(attacker.equipped, 'atk');
          if (isCrit) dmg = Math.floor(dmg * 2.0); // Удваиваем урон при проке крита

          // Вычитаем поглощающую броню Выносливости цели
          dmg = Math.max(1, dmg - dbHelper.getServerDef(target));
          target.currentHp = Math.max(0, Number(target.currentHp || 0) - dmg);
          
          logs.push(`⚔️ <strong>${attacker.name}</strong> нанес <strong>${target.name}</strong> <strong>${dmg}</strong> урона в ${ZONE_NAMES[attacker.turn.attack]} ${isCrit ? '💥 КРИТ!' : ''}`);
        }
      }
    });

    room.teamA.forEach(f => f.turn = null);
    room.teamB.forEach(f => f.turn = null);

    const isTeamADead = room.teamA.every(f => f.currentHp <= 0);
    const isTeamBDead = room.teamB.every(f => f.currentHp <= 0);
    const currentRound = room.turnCount;
    room.turnCount++;

    if (isTeamADead || isTeamBDead || room.turnCount > 40) {
      let result = 'draw';
      if (!isTeamADead && isTeamBDead) result = 'win';  // Победила команда А
      if (isTeamADead && !isTeamBDead) result = 'lose'; // Победила команда B

      console.log(`🏁 [ФИНАЛ МАТЧА] Тип комнаты: ${room.type}. Результат для TeamA: ${result}`);

      // ============================================================================
      // 🌲 ВЕТВЬ А: РАСЧЕТ ЛОГОВ НАГРАД СТРОГО ДЛЯ PvE (БИТВА С МОНСТРАМИ)
      // ============================================================================
      if (room.type === 'pve') {
        const player = room.teamA[0];
        if (player && result === 'win') {
          let gainedXp = 0;
          let gainedGold = 0;
          room.teamB.forEach(m => {
            gainedXp += Number(m.rewardXp || 0);
            gainedGold += Number(m.rewardGold || 0);
          });

          const oldLevel = Number(player.level || 1);
          const correctLevel = dbHelper.getServerCorrectLevelByXp(player.xp + gainedXp);

          if (correctLevel > oldLevel) {
            logs.push(`🎉 <strong>УРОВЕНЬ ПОВЫШЕН!</strong> Вы достигли ${correctLevel} уровня!`);
          }
          logs.push(`🏁 <strong>ПОБЕДА!</strong> Награда: 💰 ${gainedGold} монет, ✨ ${gainedXp} опыта.`);
        } else if (player && result === 'lose') {
          logs.push(`🏁 <strong>ВАС ОДОЛЕЛИ...</strong> Воскрешение в городе.`);
        }
      }

      // ============================================================================
      // 🏆 ВЕТВЬ Б: 🔥 ФИКС PvP ЛОГОВ НАГРАД (ДО ОТПРАВКИ ПАКЕТА НА ТЕЛЕФОН)
      // ============================================================================
      if (room.type === 'pvp') {
        const playerA = room.teamA[0]; // Ян
        const playerB = room.teamB[0]; // Evil
        const goldReward = 25;

        const calculatePvpXpLog = (winnerLvl, loserLvl) => {
          let baseXp = Number(loserLvl || 1) * 15;
          let multiplier = 1;
          if (loserLvl > winnerLvl) multiplier = 1 + ((loserLvl - winnerLvl) * 0.25);
          else if (loserLvl < winnerLvl) multiplier = Math.max(0.1, 1 - ((winnerLvl - loserLvl) * 0.20));
          return Math.floor(baseXp * multiplier);
        };

        if (result === 'win' && playerA && playerB) {
          const xpGained = calculatePvpXpLog(playerA.level, playerB.level);
          logs.push(`🏁 <strong>ПОБЕДА НА АРЕНЕ!</strong> Гладиатор <strong>${playerA.name}</strong> поверг соперника! Награда: 💰 ${goldReward} монет, ✨ ${xpGained} опыта.`);
        } else if (result === 'lose' && playerA && playerB) {
          const xpGained = calculatePvpXpLog(playerB.level, playerA.level);
          logs.push(`🏁 <strong>ПОБЕДА НА АРЕНЕ!</strong> Гладиатор <strong>${playerB.name}</strong> одержал верх! Награда: 💰 ${goldReward} монет, ✨ ${xpGained} опыта.`);
        } else {
          logs.push(`🏁 <strong>НИЧЬЯ НА АРЕНЕ!</strong> Силы гладиаторов равны. Награды аннулированы.`);
        }
      }

      // ============================================================================
      // 📤 ОТПРАВКА СЕТЕВОГО ПАКЕТА ФИНАЛА
      // ============================================================================
      [...room.teamA, ...room.teamB].forEach(p => {
        if (p.socketId) {
          let personalResult = result;
          if (room.type === 'pvp') {
            const isTargetInTeamA = room.teamA.some(f => f.uuid === p.uuid);
            if (isTargetInTeamA) personalResult = result;
            else personalResult = (result === 'win') ? 'lose' : (result === 'lose' ? 'win' : 'draw');
          }

          io.to(p.socketId).emit('round_result', { 
            turnCount: currentRound, 
            logs: logs, 
            isOver: true, 
            resultType: personalResult,
            teamA: sanitizeTeam(room.teamA), 
            teamB: sanitizeTeam(room.teamB) 
          });
        }
      });

        if (room.type === 'pve') {
            finalizePveBattle(room, result, logs, currentRound, io);
        } else if (room.type === 'pvp') {
            finalizePvpBattle(room, result, logs, currentRound, io);
        }
      
      setTimeout(() => {
        delete activeRooms[room.id];
        console.log(`🗑️ [ОЗУ] Комната ${room.id} полностью выгружена.`);
      }, 1200);
      
    } else {
      [...room.teamA, ...room.teamB].forEach(p => {
        if (p.socketId) {
          io.to(p.socketId).emit('round_result', { 
            turnCount: currentRound, logs: logs, isOver: false, 
            teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB) 
          });
        }
      });
      startServerTurnTimer(roomId, activeRooms, io);
    }
  }

  // --- 12. ВНУТРЕННЯЯ ФУНКЦИЯ: ФИНАЛИЗАЦИЯ PvE И СИНХРОНИЗАЦИЯ НАГРАД ---
  async function finalizePveBattle(room, result, logs, finalRound, io) {
    const player = Array.isArray(room.teamA) ? room.teamA[0] : room.teamA;
    if (!player) return;

    let gainedXp = 0; let gainedGold = 0;
    let dbHpPayload = player.currentHp;

    if (result === 'win') {
      room.teamB.forEach(m => { 
        gainedXp += Number(m.rewardXp || 0); 
        gainedGold += Number(m.rewardGold || 0); 
      });
      player.gold += gainedGold;
      player.xp += gainedXp;
      
      const oldLevel = Number(player.level || 1);
      const correctLevel = dbHelper.getServerCorrectLevelByXp(player.xp);
      if (correctLevel > oldLevel) {
        player.statpoints = (player.statpoints || 0) + ((correctLevel - oldLevel) * 5);
        player.level = correctLevel;
        player.currentHp = dbHelper.getServerMaxHp(player);
      }
      dbHpPayload = player.currentHp;
    } else {
      player.currentHp = 0;
      dbHpPayload = Math.max(1, Math.floor(dbHelper.getServerMaxHp(player) * 0.2));
    }

    try {
      await sb.from('players').update({ 
        gold: Number(player.gold), xp: Number(player.xp), hp: Number(dbHpPayload), 
        level: Number(player.level), statpoints: Number(player.statpoints) 
      }).eq('id', Number(player.id));
    } catch (err) { console.error(err); }
  }

  // --- 13. ВНУТРЕННЯЯ ФУНКЦИЯ: ФИНАЛИЗАЦИЯ PvP ДУЭЛЕЙ ГЛАДИАТОРОВ ---
  async function finalizePvpBattle(room, result, logs, finalRound, io) {
  const playerA = Array.isArray(room.teamA) ? room.teamA[0] : room.teamA; 
  const playerB = Array.isArray(room.teamB) ? room.teamB[0] : room.teamB;
    
    if (!playerA || !playerB) return;
    
    console.log(`
🏁 [PvP ФИНАЛИЗАЦИЯ] Начинаем защищенную транзакцию наград. Исход для TeamA: ${result}`);

    const goldReward = 25; 

    const calculatePvpXp = (winnerLvl, loserLvl) => {
      let baseXp = Number(loserLvl || 1) * 15; 
      let multiplier = 1;
      if (loserLvl > winnerLvl) multiplier = 1 + ((loserLvl - winnerLvl) * 0.25);
      else if (loserLvl < winnerLvl) multiplier = Math.max(0.1, 1 - ((winnerLvl - loserLvl) * 0.20));
      return Math.floor(baseXp * multiplier);
    };

    try {
      const [dbDataA, dbDataB] = await Promise.all([
        sb.from('players').select('*').eq('id', Number(playerA.id)).maybeSingle(),
        sb.from('players').select('*').eq('id', Number(playerB.id)).maybeSingle()
      ]);

      if (!dbDataA.data || !dbDataB.data) {
        console.error("🚨 [КРИТ] Не удалось прочитать профили из БД перед выдачей PvP наград!");
        return;
      }

      const rowA = dbDataA.data;
      const rowB = dbDataB.data;

      const safeRead = (row, field, def = 0) => {
        const low = field.toLowerCase();
        const up = field.toUpperCase();
        const cap = field.charAt(0).toUpperCase() + field.slice(1);
        return Number(row[low] ?? row[up] ?? row[cap] ?? row[field] ?? def);
      };

      let pointsKeyA = rowA.statpoints !== undefined ? 'statpoints' : 'statPoints';
      let pointsKeyB = rowB.statpoints !== undefined ? 'statpoints' : 'statPoints';

      let goldA = safeRead(rowA, 'gold', 0);
      let xpA = safeRead(rowA, 'xp', 0);
      let levelA = safeRead(rowA, 'level', 1);
      let statpointsA = safeRead(rowA, pointsKeyA, 0);

      let goldB = safeRead(rowB, 'gold', 0);
      let xpB = safeRead(rowB, 'xp', 0);
      let levelB = safeRead(rowB, 'level', 1);
      let statpointsB = safeRead(rowB, pointsKeyB, 0);

      const maxHpA = dbHelper.getServerMaxHp({ endurance: safeRead(rowA, 'endurance', 1), equipped: rowA.equipped || {} });
      const maxHpB = dbHelper.getServerMaxHp({ endurance: safeRead(rowB, 'endurance', 1), equipped: rowB.equipped || {} });

      let endHpA = maxHpA;
      let endHpB = maxHpB;

      if (result === 'win') {
        const pvpXp = calculatePvpXp(levelA, levelB);
        goldA += goldReward;
        xpA += pvpXp;

        const correctLevelA = dbHelper.getServerCorrectLevelByXp(xpA);
        if (correctLevelA > levelA) {
          statpointsA += (correctLevelA - levelA) * 5;
          levelA = correctLevelA;
        }

        // 🔥 ИСПРАВЛЕНО: Победитель сохраняет остаток своего ХП из боя (но не меньше 1)
        endHpA = Math.max(1, Number(playerA.currentHp));
        endHpB = Math.max(1, Math.floor(maxHpB * 0.2)); // Проигравшему Evil пишем легальные 20%
      } 
      else if (result === 'lose') {
        const pvpXp = calculatePvpXp(levelB, levelA);
        goldB += goldReward;
        xpB += pvpXp;

        const correctLevelB = dbHelper.getServerCorrectLevelByXp(xpB);
        if (correctLevelB > levelB) {
          statpointsB += (correctLevelB - levelB) * 5;
          levelB = correctLevelB;
        }

        endHpA = Math.max(1, Math.floor(maxHpA * 0.2)); // Проигравшему Яну пишем легальные 20%
        // 🔥 ИСПРАВЛЕНО: Победитель сохраняет остаток своего ХП из боя (но не меньше 1)
        endHpB = Math.max(1, Number(playerB.currentHp));
      }
      else if (result === 'lose') {
        const pvpXp = calculatePvpXp(levelB, levelA);
        goldB += goldReward;
        xpB += pvpXp;

        const correctLevelB = dbHelper.getServerCorrectLevelByXp(xpB);
        if (correctLevelB > levelB) {
          statpointsB += (correctLevelB - levelB) * 5;
          levelB = correctLevelB;
        }

        endHpA = Math.max(1, Math.floor(maxHpA * 0.2));
        endHpB = maxHpB;
      } 
      else {
        endHpA = Math.max(1, Math.floor(maxHpA * 0.2));
        endHpB = Math.max(1, Math.floor(maxHpB * 0.2));
      }

      await Promise.all([
        sb.from('players').update({
          gold: Number(goldA), xp: Number(xpA), level: Number(levelA),
          [pointsKeyA]: Number(statpointsA), hp: Number(endHpA)
        }).eq('id', Number(playerA.id)),

        sb.from('players').update({
          gold: Number(goldB), xp: Number(xpB), level: Number(levelB),
          [pointsKeyB]: Number(statpointsB), hp: Number(endHpB)
        }).eq('id', Number(playerB.id))
      ]);

      console.log("☁️ [БД PvP УСПЕХ] Данные успешно сохранены.");

    } catch (err) {
      console.error("❌ Фатальная ошибка транзакции PvP наград:", err);
    }
  }

};