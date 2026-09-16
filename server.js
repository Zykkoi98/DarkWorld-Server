// ============================================================================
// ===== 🛡️ ИСПРАВЛЕННЫЙ СЕРВЕР RPG: ЧАСТЬ 1 — РАСЧЕТ ХАРАКТЕРИСТИК (ФИКС) =====
// ============================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

// Импортируем серверные базы данных монстров и предметов
const MONSTER_DATABASE = require('./database_server/monsters');
const { serverGetItemData, CONSUMABLE_DATABASE } = require('./database_server/items');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: ["https://zykkoi98.github.io", "http://localhost:3000"],
    methods: ["GET", "POST"]
  } 
});
// Подключение к Supabase
const SUPABASE_URL = "https://ylslpgujwgxtsabkzgbd.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsc2xwZ3Vqd2d4dHNhYmt6Z2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMDM3ODksImV4cCI6MjEwNDg3OTc4OX0.GKocc3hnVQVSYaOnm1QhHca54sBn8AsiN8mHo6J0ENY";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let pvpLobby = [];    // Лобби ожидания Арены
let activeRooms = {}; // Живые комнаты боев в памяти бэкенда

const ZONE_NAMES = { head: "Голову", breast: "Грудь", torso: "Торс", belt: "Пояс", legs: "Ноги" };

// Подсчет бонусов экипировки на бэкенде
function getServerEquipmentBonus(playerData, bonusKey) {
  if (!playerData.equipped) return 0;
  let totalBonus = 0;
  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand', 'extra'];
  
  slots.forEach(slot => {
    const itemId = playerData.equipped[slot];
    if (itemId) {
      const itemData = serverGetItemData(itemId);
      if (itemData && itemData.bonus) {
        if (itemData.bonus[bonusKey] !== undefined) totalBonus += itemData.bonus[bonusKey];
        if (itemData.bonus.stats && itemData.bonus.stats[bonusKey] !== undefined) {
          totalBonus += itemData.bonus.stats[bonusKey];
        }
      }
    }
  });

  if (playerData.equipped.rings && Array.isArray(playerData.equipped.rings)) {
    playerData.equipped.rings.forEach(itemId => {
      if (itemId) {
        const itemData = serverGetItemData(itemId);
        if (itemData && itemData.bonus) {
          if (itemData.bonus[bonusKey] !== undefined) totalBonus += itemData.bonus[bonusKey];
          if (itemData.bonus.stats && itemData.bonus.stats[bonusKey] !== undefined) {
            totalBonus += itemData.bonus.stats[bonusKey];
          }
        }
      }
    });
  }
  return totalBonus;
}

function getServerAtk(playerData) {
  const totalStrength = (playerData.stats?.strength || 10) + getServerEquipmentBonus(playerData, 'strength');
  const baseAtk = Math.floor(2 + (totalStrength * 1.5));
  const weaponAtk = getServerEquipmentBonus(playerData, 'atk');
  return baseAtk + weaponAtk;
}

function getServerDef(playerData) {
  const totalEndurance = (playerData.stats?.endurance || 10) + getServerEquipmentBonus(playerData, 'endurance');
  const baseDef = Math.floor(totalEndurance * 0.5); 
  const armorDef = getServerEquipmentBonus(playerData, 'def');
  return baseDef + armorDef;
}

function getServerMaxHp(playerData) {
  const totalEndurance = (playerData.stats?.endurance || 10) + getServerEquipmentBonus(playerData, 'endurance');
  const armorHp = getServerEquipmentBonus(playerData, 'hp');
  return (totalEndurance * 10) + armorHp;
}
// ============================================================================
// ===== 🛡️ ИСПРАВЛЕННЫЙ СЕРВЕР RPG: ЧАСТЬ 2 — СЕТЕВЫЕ СОБЫТИЯ И RECONNECT =====
// ============================================================================
io.on('connection', (socket) => {
  console.log(`🔌 Игрок подключился к сокету: ${socket.id}`);

  // 🔄 ХЕНДЛЕР ПЕРЕПОДКЛЮЧЕНИЯ: Ищет зависший в памяти бой по неизменяемому ID игрока
  socket.on('check_active_battle', ({ userId }) => {
    if (!userId) return;

    const foundRoomId = Object.keys(activeRooms).find(roomId => {
      const room = activeRooms[roomId];
      const isP1 = Number(room.p1.data.id) === Number(userId);
      const isP2 = !room.p2.isAi && Number(room.p2.data.id) === Number(userId);
      return isP1 || isP2;
    });

    if (foundRoomId) {
      const room = activeRooms[foundRoomId];
      const isP1 = Number(room.p1.data.id) === Number(userId);
      
      // Связываем новый активный сокет с комнатой
      socket.join(foundRoomId);
      
      if (isP1) {
        room.p1.socket = socket; // Обновляем сокет Первого игрока
        socket.emit('reconnect_battle_success', {
          roomId: foundRoomId,
          isPve: !!room.p2.isAi,
          opponent: room.p2.data,
          myMaxHp: room.p1.maxHp,
          oppMaxHp: room.p2.maxHp,
          myCurrentHp: room.p1.currentHp,
          oppCurrentHp: room.p2.currentHp,
          turnCount: room.turnCount
        });
      } else {
        room.p2.socket = socket; // Обновляем сокет Второго игрока
        socket.emit('reconnect_battle_success', {
          roomId: foundRoomId,
          isPve: false,
          opponent: room.p1.data,
          myMaxHp: room.p2.maxHp,
          oppMaxHp: room.p1.maxHp,
          myCurrentHp: room.p2.currentHp,
          oppCurrentHp: room.p1.currentHp,
          turnCount: room.turnCount
        });
      }
      console.log(`🔄 Игрок ${userId} успешно переподключил сокет к комнате ${foundRoomId}`);
    }
  });

  // Вход в очередь Арены (PvP)
  socket.on('search_match', (clientPayload) => {
    const playerData = clientPayload.playerData;
    const clientCurrentHp = clientPayload.currentHp;
    const clientMaxHp = clientPayload.maxHp;

    if (!playerData) return socket.emit('error', 'Критическая ошибка: Данные игрока отсутствуют.');
    
    // Очищаем лобби от старых записей этого же игрока
    pvpLobby = pvpLobby.filter(p => Number(p.playerData.id) !== Number(playerData.id));
    
    if (pvpLobby.length > 0) {
      const opponent = pvpLobby.shift(); 
      const roomId = `room_${opponent.playerData.id}_${playerData.id}`; // Создаем ID комнаты по ID игроков, а не сокетов!
      
      console.log(`⚔️ PvP Пара найдена! Создается комната: ${roomId}`);

      activeRooms[roomId] = {
        id: roomId,
        p1: { socket: opponent.socket, data: opponent.playerData, currentHp: opponent.currentHp, maxHp: opponent.maxHp, turn: null },
        p2: { socket: socket, data: playerData, currentHp: clientCurrentHp, maxHp: clientMaxHp, turn: null },
        turnCount: 1, timeoutRef: null
      };

      // 🔥 ИСПРАВЛЕНИЕ 1: Добавляем сокеты в комнату
      opponent.socket.join(roomId);
      socket.join(roomId);

      // Даем Socket.io 50 миллисекунд, чтобы гарантированно завершить асинхронный .join() для ОБЕИХ вкладок [1]
      setTimeout(() => {
        if (activeRooms[roomId]) {
          // Шлем пакет старта напрямую в созданную комнату для обоих участников одновременно!
          if (activeRooms[roomId].p1.socket) {
            activeRooms[roomId].p1.socket.emit('battle_start', { roomId, opponent: playerData, myMaxHp: activeRooms[roomId].p1.maxHp, oppMaxHp: activeRooms[roomId].p2.maxHp });
          }
          if (activeRooms[roomId].p2.socket) {
            activeRooms[roomId].p2.socket.emit('battle_start', { roomId, opponent: opponent.playerData, myMaxHp: activeRooms[roomId].p2.maxHp, oppMaxHp: activeRooms[roomId].p1.maxHp });
          }
          startServerTurnTimer(roomId);
        }
      }, 50);

    } else {
      // Сохраняем текущий сокет и данные в очередь поиска
      pvpLobby.push({ socket: socket, playerData: playerData, currentHp: clientCurrentHp, maxHp: clientMaxHp });
      socket.emit('search_status', '🔍 Поиск достойного соперника на Арене...');
    }
  });

  // Запуск PvE поединка (Охота на монстров)
  socket.on('search_pve_match', async ({ playerData, monsterKey, maxHp }) => {
    try {
      const template = MONSTER_DATABASE[monsterKey];
      if (!template) return socket.emit('error', 'Монстр не найден');

      const { data: dbPlayer, error } = await sb.from('players').select('*').eq('id', Number(playerData.id)).single();
      if (error || !dbPlayer) return socket.emit('error', 'Критическая ошибка валидации профиля.');

      const roomId = `pve_${playerData.id}_${Date.now()}`;
      const myRealMaxHp = maxHp || getServerMaxHp(dbPlayer);
      const monsterMaxHp = (template.stats.endurance || 10) * 10;

      activeRooms[roomId] = {
        id: roomId,
        p1: { socket: socket, data: dbPlayer, currentHp: dbPlayer.hp, maxHp: myRealMaxHp, turn: null },
        p2: { isAi: true, data: { name: template.name, icon: template.icon, stats: template.stats, rewardXp: template.rewardXp, rewardGold: template.rewardGold }, currentHp: monsterMaxHp, maxHp: monsterMaxHp, turn: null },
        turnCount: 1, timeoutRef: null
      };

      socket.join(roomId);
      socket.emit('pve_battle_start', { roomId, monster: activeRooms[roomId].p2.data, myMaxHp: myRealMaxHp, monsterMaxHp: monsterMaxHp });
      startServerTurnTimer(roomId);
    } catch (err) {
      console.error("Ошибка при старте PvE боя:", err.message);
    }
  });

    // 🔥 СИНХРОНИЗАЦИЯ СЕРВЕРА: Жесткий и надежный прием ходов Арены и Леса
  socket.on('submit_turn', ({ roomId, attack, defends }) => {
    const room = activeRooms[roomId];
    if (!room) return;
    
    let activePlayer = null;
    let opponent = null;

    // Сверяем активный сокет с участниками комнаты
    if (room.p1.socket && room.p1.socket.id === socket.id) {
      activePlayer = room.p1; opponent = room.p2;
    } else if (room.p2.socket && room.p2.socket.id === socket.id) {
      activePlayer = room.p2; opponent = room.p1;
    }

    // Резервная привязка сокета при переподключении (F5)
    if (!activePlayer) {
      if (!room.p1.socket) {
        room.p1.socket = socket; activePlayer = room.p1; opponent = room.p2;
      } else if (!room.p2.isAi && !room.p2.socket) {
        room.p2.socket = socket; activePlayer = room.p2; opponent = room.p1;
      }
    }

    // Если игрок уже ходил в этом раунде — игнорируем спам
    if (!activePlayer || activePlayer.turn) return; 

    // Записываем ход строго в плоскую структуру, которую ждет расчет раунда
    activePlayer.turn = { action: null, attack: attack || null, defends: defends || [] };
    console.log(`✅ Ход сервера зафиксирован для: ${activePlayer.data.name || 'Игрок'}. Зона: ${attack}`);

    if (!room.p2.isAi && opponent && opponent.socket) {
      opponent.socket.emit('opponent_submitted');
    }

    // Запускаем расчет, если обе стороны сделали выбор
    if (room.p1.turn && (room.p2.isAi || room.p2.turn)) {
      clearTimeout(room.timeoutRef);
      executeRoundCalculations(roomId);
    }
  });

  // Мгновенное лечение банкой
  socket.on('instant_use_potion', async ({ roomId }) => {
    const room = activeRooms[roomId];
    if (!room) return;
    const isP1 = room.p1.socket && room.p1.socket.id === socket.id;
    const activePlayer = isP1 ? room.p1 : room.p2;
    const potionId = activePlayer.data.equipped?.potion;
    const potionData = CONSUMABLE_DATABASE[potionId];

    if (potionData) {
      activePlayer.currentHp = Math.min(activePlayer.maxHp, activePlayer.currentHp + potionData.heal);
      if (activePlayer.data.equipped) activePlayer.data.equipped.potion = null;
      
      await sb.from('players').update({ hp: activePlayer.currentHp, equipped: activePlayer.data.equipped }).eq('id', Number(activePlayer.data.id));

      if (!room.p2.isAi) {
        const opponent = isP1 ? room.p2 : room.p1;
        if (opponent.socket) {
          opponent.socket.emit('opponent_healed_instant', { oppHp: activePlayer.currentHp, logMsg: `🧪 Соперник ${activePlayer.data.name} выпил зелье и восстановил здоровье!` });
        }
      }
    }
  });

  socket.on('disconnect', () => {
    pvpLobby = pvpLobby.filter(p => p.socket.id !== socket.id);
    Object.keys(activeRooms).forEach(roomId => {
      const room = activeRooms[roomId];
      if (room.p1.socket && room.p1.socket.id === socket.id) room.p1.socket = null;
      if (!room.p2.isAi && room.p2.socket && room.p2.socket.id === socket.id) room.p2.socket = null;
    });
  });
});
// ============================================================================
// ===== 🛡️ ИСПРАВЛЕННЫЙ СЕРВЕР RPG: ЧАСТЬ 3 — РАСЧЕТ РАУНДОВ И СУПАБЕЙС =====
// ============================================================================

function startServerTurnTimer(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;
  room.timeoutRef = setTimeout(() => {
    if (!room.p1.turn) room.p1.turn = { action: null, attack: null, defends: [] };
    if (!room.p2.isAi && !room.p2.turn) room.p2.turn = { action: null, attack: null, defends: [] };
    executeRoundCalculations(roomId);
  }, 30000);
}

function executeRoundCalculations(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;

  const logs = [];
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  if (room.p2.isAi) {
    const zones = ["head", "breast", "torso", "belt", "legs"];
    const mAttack = zones[rand(0, 4)];
    const mDefend = [];
    while (mDefend.length < 2) { 
      const rz = zones[rand(0, 4)]; 
      if (!mDefend.includes(rz)) mDefend.push(rz); 
    }
    room.p2.turn = { action: null, attack: mAttack, defends: mDefend };
  }

  // Атака P1
  if (!room.p1.turn || room.p1.turn.attack === null) {
    logs.push(`❌ ${room.p1.data.name} пропустил атаку!`);
  } else if (room.p2.turn.defends.includes(room.p1.turn.attack)) {
    logs.push(`🛡️ ${room.p2.data.name} заблокировал ваш удар в ${ZONE_NAMES[room.p1.turn.attack]}!`);
  } else {
    let pCrit = Math.min(50, 5 + ((room.p1.data.stats?.luck || 10) * 0.5));
    let isCrit = rand(1, 100) <= pCrit;
    let baseDmg = isCrit ? Math.floor(getServerAtk(room.p1.data) * 1.5) : getServerAtk(room.p1.data);
    let targetDef = room.p2.isAi ? Math.floor((room.p2.data.stats?.endurance || 10) * 0.5) : getServerDef(room.p2.data);
    let dmg = Math.max(1, baseDmg - targetDef); 
    room.p2.currentHp -= dmg;
    logs.push(`⚔️ ${room.p1.data.name} пробил ${ZONE_NAMES[room.p1.turn.attack]} на ${dmg} урона ${isCrit ? '💥 КРИТ!' : ''}`);
  }

  // Атака P2
  if (room.p2.currentHp > 0) {
    if (!room.p2.turn || room.p2.turn.attack === null) {
      logs.push(`❌ ${room.p2.data.name} пропустил атаку!`);
    } else if (room.p1.turn && room.p1.turn.defends.includes(room.p2.turn.attack)) {
      logs.push(`🛡️ Вы успешно заблокировали удар соперника в ${ZONE_NAMES[room.p2.turn.attack]}!`);
    } else {
      let isCrit = false;
      let baseDmg = 0;
      
      if (room.p2.isAi) {
        let mCrit = Math.min(50, 5 + ((room.p2.data.stats?.luck || 8) * 0.5));
        isCrit = rand(1, 100) <= mCrit;
        baseDmg = isCrit ? Math.floor(Math.floor((room.p2.data.stats?.strength || 8) * 1.5) * 1.5) : Math.floor((room.p2.data.stats?.strength || 8) * 1.5);
      } else {
        let pCrit = Math.min(50, 5 + ((room.p2.data.stats?.luck || 10) * 0.5));
        isCrit = rand(1, 100) <= pCrit;
        baseDmg = isCrit ? Math.floor(getServerAtk(room.p2.data) * 1.5) : getServerAtk(room.p2.data);
      }

      let playerDef = getServerDef(room.p1.data);
      let dmg = Math.max(1, baseDmg - playerDef);
      room.p1.currentHp -= dmg;
      logs.push(`🩸 ${room.p2.data.name} нанес вам ${dmg} урона в ${ZONE_NAMES[room.p2.turn.attack]} ${isCrit ? '💥 КРИТ!' : ''}`);
    }
  }

  if (room.p1.currentHp < 0) room.p1.currentHp = 0;
  if (room.p2.currentHp < 0) room.p2.currentHp = 0;

  const currentRound = room.turnCount;
  room.turnCount++;
  room.p1.turn = null; room.p2.turn = null;

  const isP1Dead = room.p1.currentHp <= 0;
  const isP2Dead = room.p2.currentHp <= 0;

if (isP1Dead || isP2Dead || room.turnCount > 40) {
    let resultType = 'draw';
    let finalGold = room.p1.data.gold;
    let finalXp = room.p1.data.xp;

    // 🔥 ИСПРАВЛЕНИЕ 1: Мгновенно заставляем сокеты покинуть комнату Socket.io, чтобы разорвать связь
    if (room.p1.socket) room.p1.socket.leave(room.id);
    if (!room.p2.isAi && room.p2.socket) room.p2.socket.leave(room.id);

    // 🔥 ИСПРАВЛЕНИЕ 2: Сначала ЖЕСТКО удаляем комнату из ОЗУ сервера, чтобы хендлер F5 её больше никогда не нашел!
    const finishedRoomId = roomId;
    delete activeRooms[finishedRoomId];
    console.log(`🧹 Память сервера очищена: комната ${finishedRoomId} полностью удалена.`);

    if (room.p2.isAi) {
      if (!isP1Dead && isP2Dead) { resultType = 'p1_win'; finalGold += room.p2.data.rewardGold; finalXp += room.p2.data.rewardXp; }
      if (isP1Dead && !isP2Dead) resultType = 'monster_win';
      if (room.p1.socket) room.p1.socket.emit('round_result', { p1Hp: room.p1.currentHp, p2Hp: room.p2.currentHp, logs, isOver: true, resultType, turnCount: currentRound, serverGold: finalGold, serverXp: finalXp });
      savePveResultsToSupabase(room.p1, room.p2, resultType);
    } else {
      let p2Gold = room.p2.data.gold; let p2Xp = room.p2.data.xp;
      if (!isP1Dead && isP2Dead) { resultType = 'p1_win'; finalGold += 25; finalXp += 30; }
      if (isP1Dead && !isP2Dead) { resultType = 'p2_win'; p2Gold += 25; p2Xp += 30; }
      if (room.p1.socket) room.p1.socket.emit('round_result', { p1Hp: room.p1.currentHp, p2Hp: room.p2.currentHp, logs, isOver: true, resultType, turnCount: currentRound, serverGold: finalGold, serverXp: finalXp });
      if (room.p2.socket) room.p2.socket.emit('round_result', { p1Hp: room.p2.currentHp, p2Hp: room.p1.currentHp, logs, isOver: true, resultType, turnCount: currentRound, serverGold: p2Gold, serverXp: p2Xp });
      saveBattleResultsToSupabase(room.p1, room.p2, resultType);
    }
  } else {
    io.to(room.id).emit('round_result', { p1Hp: room.p1.currentHp, p2Hp: room.p2.currentHp, logs, isOver: false, turnCount: currentRound });
    startServerTurnTimer(roomId);
  }
}

async function savePveResultsToSupabase(playerRoomObject, monster, resultType) {
  try {
    const userId = playerRoomObject.data.id;
    const newGold = resultType === 'p1_win' ? (playerRoomObject.data.gold + monster.data.rewardGold) : playerRoomObject.data.gold;
    const newXp = resultType === 'p1_win' ? (playerRoomObject.data.xp + monster.data.rewardXp) : playerRoomObject.data.xp;
    let finalHp = resultType === 'p1_win' ? Math.max(0, playerRoomObject.currentHp) : Math.max(1, Math.floor(playerRoomObject.maxHp * 0.2)); 

    await sb.from('players').update({ gold: newGold, xp: newXp, hp: finalHp, equipped: playerRoomObject.data.equipped }).eq('id', Number(userId));
    console.log(`☁️ Итоги PvE боя сохранены в Supabase для игрока ID ${userId}`);
  } catch (err) { console.error("Ошибка Supabase PvE:", err.message); }
}

async function saveBattleResultsToSupabase(winner, loser, resultType) {
  if (resultType === 'draw') return;
  try {
    const winPlayer = resultType === 'p1_win' ? winner : loser;
    const losePlayer = resultType === 'p1_win' ? loser : winner;
    await sb.from('players').update({ gold: winPlayer.data.gold + 25, xp: winPlayer.data.xp + 30, hp: Math.max(0, winPlayer.currentHp) }).eq('id', Number(winPlayer.data.id));
    await sb.from('players').update({ hp: Math.max(1, Math.floor(losePlayer.maxHp * 0.2)) }).eq('id', Number(losePlayer.data.id));
    console.log(`☁️ Итоги PvP боя зафиксированы в Supabase.`);
  } catch (err) { console.error("Ошибка Supabase PvP:", err.message); }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Боевой сервер запущен на порту ${PORT}`));