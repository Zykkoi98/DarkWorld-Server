// ============================================================================
// ===== 🛡️ ИСПРАВЛЕННЫЙ СЕРВЕР RPG: ЧАСТЬ 1 — РАСЧЕТ ХАРАКТЕРИСТИК (ФИКС) =====
// ============================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
// Таблица порогов опыта (должна на 100% совпадать с клиентом)
const SERVER_XP_TABLE = [
  0,      // 0 уровень (не используется)
  0,      // 1 уровень (стартовая точка, нужно 0 XP)
  20,     // Чтобы получить 2 лвл, нужно ВСЕГО набрать 20 XP
  70,     // Чтобы получить 3 лвл, нужно ВСЕГО набрать 70 XP
  170,    // Чтобы получить 4 лвл, нужно ВСЕГО набрать 170 XP
  370,    // Чтобы получить 5 лвл, нужно ВСЕГО набрать 370 XP
  770,    // Чтобы получить 6 лвл, нужно ВСЕГО набрать 770 XP
  1570,   // Чтобы получить 7 лвл, нужно ВСЕГО набрать 1570 XP
  3070,   // Чтобы получить 8 лвл, нужно ВСЕГО набрать 3070 XP
  5570,   // Чтобы получить 9 лвл, нужно ВСЕГО набрать 5570 XP
  9570,   // Чтобы получить 10 лвл, нужно ВСЕГО набрать 9570 XP
];

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

// 🔥 ОБНОВЛЕННЫЙ КАЛЬКУЛЯТОР ЗАЩИТЫ НА СЕРВЕРЕ (ПОД ПЛОСКИЕ КОЛОНКИ)
function getServerDef(playerData) {
  // Заменяем playerData.stats?.endurance на прямую переменную playerData.endurance
  // Ставим базовую единицу на случай, если поле пришло пустым
  const totalEndurance = Number(playerData.endurance !== undefined ? playerData.endurance : 1) + getServerEquipmentBonus(playerData, 'endurance');
  const baseDef = Math.floor(totalEndurance * 0.5); 
  const armorDef = getServerEquipmentBonus(playerData, 'def');
  return baseDef + armorDef;
}

// 🔥 ОБНОВЛЕННЫЙ КАЛЬКУЛЯТОР АТАКИ НА СЕРВЕРЕ (ПОД ПЛОСКИЕ КОЛОНКИ)
function getServerAtk(playerData) {
  // Заменяем playerData.stats?.strength на прямую переменную playerData.strength
  const totalStrength = Number(playerData.strength !== undefined ? playerData.strength : 1) + getServerEquipmentBonus(playerData, 'strength');
  const baseAtk = Math.floor(2 + (totalStrength * 1.5));
  const weaponAtk = getServerEquipmentBonus(playerData, 'atk');
  return baseAtk + weaponAtk;
}

// 🔥 ОБНОВЛЕННЫЙ КАЛЬКУЛЯТОР МАКСИМАЛЬНОГО ЗДОРОВЬЯ НА СЕРВЕРЕ (ПОД ПЛОСКИЕ КОЛОНКИ)
function getServerMaxHp(playerData) {
  // Заменяем playerData.stats?.endurance на прямую переменную playerData.endurance
  const totalEndurance = Number(playerData.endurance !== undefined ? playerData.endurance : 1) + getServerEquipmentBonus(playerData, 'endurance');
  const armorHp = getServerEquipmentBonus(playerData, 'hp');
  return (totalEndurance * 10) + armorHp;
}
// ============================================================================
// ===== 🛡️ ИСПРАВЛЕННЫЙ СЕРВЕР RPG: ЧАСТЬ 2 — СЕТЕВЫЕ СОБЫТИЯ И РЕКОННЕКТ =====
// ============================================================================
io.on('connection', (socket) => {
  console.log(`🔌 Игрок подключился к сокету: ${socket.id}`);

// 🔄 АБСОЛЮТНО БЕЗОПАСНЫЙ ХЕНДЛЕР RECONNECT (ФИКС КРАША PvE И PvP)
  socket.on('check_active_battle', ({ userId }) => {
    if (!userId) return;
    const uid = Number(userId);

    console.log(`🔍 Сервер проверяет активные сессии для игрока ID ${uid}...`);

    // 🔥 БРОНЕБОЙНЫЙ ПОИСК: Защищен от крашей из-за монстров в PvE комнатах!
    const foundRoomId = Object.keys(activeRooms).find(roomId => {
      const room = activeRooms[roomId];
      if (!room || !room.p1) return false;
      
      const isP1 = Number(room.p1.data?.id || 0) === uid;
      // Проверяем p2.data.id строго если это НЕ бот-монстр!
      const isP2 = (!room.p2.isAi && room.p2.data && Number(room.p2.data.id || 0) === uid);
      
      return isP1 || isP2;
    });

    if (foundRoomId) {
      const room = activeRooms[foundRoomId];
      const isP1 = Number(room.p1.data?.id || 0) === uid;
      socket.join(foundRoomId);
      
      if (isP1) {
        room.p1.socket = socket; // Перевязываем живой сокет игрока P1
        socket.emit('reconnect_battle_success', {
          roomId: foundRoomId, 
          isPve: !!room.p2.isAi, 
          opponent: room.p2.data, // Для PvE отдаст имя/иконку монстра
          myMaxHp: room.p1.maxHp, 
          oppMaxHp: room.p2.maxHp, 
          myCurrentHp: room.p1.currentHp, 
          oppCurrentHp: room.p2.currentHp, 
          turnCount: room.turnCount
        });
        console.log(`☁️ Игрок 1 (ID ${uid}) успешно возвращен в бой ${foundRoomId}`);
      } else {
        room.p2.socket = socket; // Перевязываем живой сокет игрока P2 (PvP)
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
        console.log(`☁️ Игрок 2 (ID ${uid}) успешно возвращен в бой ${foundRoomId}`);
      }
    } else {
      console.log(`📭 Активных боев в памяти сервера для ID ${uid} не найдено.`);
    }
  });


  // 🌲 ЗАПУСК PvE ПОЕДИНКА (БОЙ С МОНСТРОМ В ЛЕСУ)
  socket.on('search_pve_match', async ({ playerData, monsterKey, maxHp }) => {
    try {
      const template = MONSTER_DATABASE[monsterKey];
      if (!template) return socket.emit('error', 'Монстр не найден');
      const { data: dbPlayer, error } = await sb.from('players').select('*').eq('id', Number(playerData.id)).single();
      if (error || !dbPlayer) return socket.emit('error', 'Критическая ошибка валидации профиля.');

      const roomId = `pve_${playerData.id}_${Date.now()}`;
      const flatPlayer = {
        id: Number(dbPlayer.id), name: dbPlayer.name, gold: Number(dbPlayer.gold || 0), xp: Number(dbPlayer.xp || 0), level: Number(dbPlayer.level || 1),
        statpoints: Number(dbPlayer.statpoints !== undefined ? dbPlayer.statpoints : 0), equipped: dbPlayer.equipped || {},
        strength: Number(dbPlayer.strength !== undefined ? dbPlayer.strength : 1), agility: Number(dbPlayer.agility !== undefined ? dbPlayer.agility : 1),
        endurance: Number(dbPlayer.endurance !== undefined ? dbPlayer.endurance : 1), intellect: Number(dbPlayer.intellect !== undefined ? dbPlayer.intellect : 1), luck: Number(dbPlayer.luck !== undefined ? dbPlayer.luck : 1)
      };
      const myRealMaxHp = maxHp || getServerMaxHp(flatPlayer);
      const monsterMaxHp = (template.stats.endurance || 10) * 10;

      activeRooms[roomId] = {
        id: roomId,
        p1: { socket: socket, data: flatPlayer, currentHp: Number(playerData.hp || dbPlayer.hp), maxHp: myRealMaxHp, turn: null },
        p2: { isAi: true, data: { name: template.name, icon: template.icon, rewardXp: template.rewardXp, rewardGold: template.rewardGold }, currentHp: monsterMaxHp, maxHp: monsterMaxHp, turn: null, strength: template.stats.strength, agility: template.stats.agility, endurance: template.stats.endurance, intellect: template.stats.intellect, luck: template.stats.luck },
        turnCount: 1, timeoutRef: null
      };
      socket.join(roomId);
      socket.emit('pve_battle_start', { roomId, monster: activeRooms[roomId].p2.data, myMaxHp: myRealMaxHp, monsterMaxHp: monsterMaxHp, monsterCurrentHp: monsterMaxHp });
      startServerTurnTimer(roomId);
    } catch (err) { console.error("Ошибка при старте PvE боя:", err.message); }
  });
   // ============================================================================
  // 🏆 СЛУЖБА НОВОЙ АРЕНЫ: СВЯЗЬ С ТАБЛИЦЕЙ ARENA_LOBBY В SUPABASE
  // ============================================================================

  // 1. Игрок создал заявку на Арене — сервер оповещает всех остальных
  socket.on('create_arena_request', ({ userId }) => {
    console.log(`📝 Сигнал сервера: Игрок ID ${userId} опубликовал вызов.`);
    // Массово шлем всем сокетам команду обновить доску объявлений из базы
    io.emit('arena_lobby_updated');
  });

  // 2. Игрок отменил поиск — сервер даёт команду обновить экраны
  socket.on('cancel_arena_request', ({ userId }) => {
    console.log(`❌ Сигнал сервера: Игрок ID ${userId} снял свою заявку.`);
    io.emit('arena_lobby_updated');
  });

  // 3. Один игрок принял вызов другого (Нажата кнопка "В БОЙ")
  socket.on('accept_arena_challenge', async ({ myId, opponentId, myMaxHp, oppMaxHp }) => {
    try {
      const roomOppId = Number(opponentId);
      const roomMyId = Number(myId);

      // Скачиваем свежие профили обоих участников боя для честного распределения статов
      const { data: p1Data } = await sb.from('players').select('*').eq('id', roomOppId).single();
      const { data: p2Data } = await sb.from('players').select('*').eq('id', roomMyId).single();

      if (!p1Data || !p2Data) return socket.emit('error', 'Боец не найден в базе данных.');

      const roomId = `room_${roomOppId}_${roomMyId}_${Date.now()}`;
      console.log(`⚔️ БОЙ НАЧАЛСЯ ИЗ ЛОББИ! Комната: ${roomId} [${p1Data.name} vs ${p2Data.name}]`);

      // Функция сборки быстрых плоских характеристик
      const buildFlatData = (p) => ({
        id: Number(p.id), name: p.name, gold: Number(p.gold || 0), xp: Number(p.xp || 0), level: Number(p.level || 1),
        statpoints: Number(p.statpoints !== undefined ? p.statpoints : 0), equipped: p.equipped || {},
        strength: Number(p.strength || 1), agility: Number(p.agility || 1), endurance: Number(p.endurance || 1), intellect: Number(p.intellect || 1), luck: Number(p.luck || 1)
      });

      // Регистрируем боевую комнату в оперативной памяти сервера (твоё рабочее ПВП!)
      activeRooms[roomId] = {
        id: roomId,
        p1: { socket: null, data: buildFlatData(p1Data), currentHp: Number(p1Data.hp), maxHp: Number(oppMaxHp || 100), turn: null },
        p2: { socket: socket, data: buildFlatData(p2Data), currentHp: Number(p2Data.hp), maxHp: Number(myMaxHp || 100), turn: null },
        turnCount: 1, timeoutRef: null
      };

      // Шлем массовый сигнал обновить доску (так как заявка ушла в бой)
      io.emit('arena_lobby_updated');

      // Даем команду обоим клиентам принудительно открыть экран боя!
      io.emit('arena_redirect_to_battle', { opponentId: roomOppId, challengerId: roomMyId, roomId: roomId });
      
    } catch (err) {
      console.error("❌ Ошибка сервера при принятии вызова:", err.message);
    }
  });

  // ⚔️ ПРИЕМ ХОДОВ И ИНЛАЙН СЛУШАТЕЛИ КЛИКОВ ЗЕЛЬЯ
  socket.on('submit_turn', ({ roomId, attack, defends }) => {
    const room = activeRooms[roomId]; if (!room) return;
    let activePlayer = null; let opponent = null;
    if (room.p1.socket && room.p1.socket.id === socket.id) { activePlayer = room.p1; opponent = room.p2; } 
    else if (room.p2.socket && room.p2.socket.id === socket.id) { activePlayer = room.p2; opponent = room.p1; }
    if (!activePlayer) {
      if (!room.p1.socket) { room.p1.socket = socket; activePlayer = room.p1; opponent = room.p2; } 
      else if (!room.p2.isAi && !room.p2.socket) { room.p2.socket = socket; activePlayer = room.p2; opponent = room.p1; }
    }
    if (!activePlayer || activePlayer.turn) return; 
    activePlayer.turn = { action: null, attack: attack || null, defends: defends || [] };
    if (!room.p2.isAi && opponent && opponent.socket) opponent.socket.emit('opponent_submitted');
    if (room.p1.turn && (room.p2.isAi || room.p2.turn)) { clearTimeout(room.timeoutRef); executeRoundCalculations(roomId); }
  });

  socket.on('instant_use_potion', async ({ roomId }) => {
    const room = activeRooms[roomId]; if (!room) return;
    const isP1 = room.p1.socket && room.p1.socket.id === socket.id;
    const activePlayer = isP1 ? room.p1 : room.p2;
    const opponent = isP1 ? room.p2 : room.p1;
    const potionId = activePlayer.data.equipped?.potion;
    const potionData = CONSUMABLE_DATABASE[potionId];
    if (potionData) {
      const calculatedHp = Math.min(activePlayer.maxHp, activePlayer.currentHp + potionData.heal);
      activePlayer.currentHp = calculatedHp;
      if (activePlayer.data.equipped) activePlayer.data.equipped.potion = null;
      if (activePlayer.socket) activePlayer.socket.emit('opponent_healed_instant', { oppHp: activePlayer.currentHp, logMsg: `🧪 Вы выпили зелье и восстановили ${potionData.heal} HP!` });
      if (!room.p2.isAi && opponent && opponent.socket) opponent.socket.emit('opponent_healed_instant', { oppHp: activePlayer.currentHp, logMsg: `🧪 Соперник ${activePlayer.data.name} выпил зелье!` });
      sb.from('players').update({ hp: calculatedHp, equipped: activePlayer.data.equipped }).eq('id', Number(activePlayer.data.id)).then(({ error }) => { if (error) console.error("❌ Ошибка банки:", error.message); });
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
  const room = activeRooms[roomId]; if (!room) return;
  room.timeoutRef = setTimeout(() => {
    if (!room.p1.turn) room.p1.turn = { action: null, attack: null, defends: [] };
    if (!room.p2.isAi && !room.p2.turn) room.p2.turn = { action: null, attack: null, defends: [] };
    executeRoundCalculations(roomId);
  }, 30000);
}

function executeRoundCalculations(roomId) {
  const room = activeRooms[roomId]; if (!room) return;
  const logs = []; const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  if (room.p2.isAi) {
    const zones = ["head", "breast", "torso", "belt", "legs"];
    const mAttack = zones[rand(0, 4)]; const mDefend = [];
    while (mDefend.length < 2) { const rz = zones[rand(0, 4)]; if (!mDefend.includes(rz)) mDefend.push(rz); }
    room.p2.turn = { action: null, attack: mAttack, defends: mDefend };
  }

  // АТАКА И КРИТЫ ПЕРВОГО ИГРОКА (P1)
  if (!room.p1.turn || room.p1.turn.attack === null) {
    logs.push(`❌ ${room.p1.data.name} пропустил атаку!`);
  } else if (room.p2.turn.defends.includes(room.p1.turn.attack)) {
    logs.push(`🛡️ ${room.p2.data.name} заблокировал ваш удар в ${ZONE_NAMES[room.p1.turn.attack]}!`);
  } else {
    let pCrit = Math.min(50, 5 + (Number(room.p1.data.luck || 1) * 0.5));
    let isCrit = rand(1, 100) <= pCrit;
    let baseDmg = isCrit ? Math.floor(getServerAtk(room.p1.data) * 1.5) : getServerAtk(room.p1.data);
    let targetDef = room.p2.isAi ? Math.floor(Number(room.p2.endurance || 1) * 0.5) : getServerDef(room.p2.data);
    let dmg = Math.max(1, baseDmg - targetDef); room.p2.currentHp -= dmg;
    logs.push(`⚔️ ${room.p1.data.name} пробил ${ZONE_NAMES[room.p1.turn.attack]} на ${dmg} урона ${isCrit ? '💥 КРИТ!' : ''}`);
  }

  // АТАКА И КРИТЫ ВТОРОГО ИГРОКА ИЛИ МОНСТРА (P2)
  if (room.p2.currentHp > 0) {
    if (!room.p2.turn || room.p2.turn.attack === null) {
      logs.push(`❌ ${room.p2.data.name} пропустил атаку!`);
    } else if (room.p1.turn && room.p1.turn.defends.includes(room.p2.turn.attack)) {
      logs.push(`🛡️ Вы успешно заблокировали удар соперника в ${ZONE_NAMES[room.p2.turn.attack]}!`);
    } else {
      let isCrit = false; let baseDmg = 0;
      if (room.p2.isAi) {
        let mCrit = Math.min(50, 5 + (Number(room.p2.luck || 1) * 0.5)); isCrit = rand(1, 100) <= mCrit;
        baseDmg = isCrit ? Math.floor(Math.floor(Number(room.p2.strength || 1) * 1.5) * 1.5) : Math.floor(Number(room.p2.strength || 1) * 1.5);
      } else {
        let pCrit = Math.min(50, 5 + (Number(room.p2.data.luck || 1) * 0.5)); isCrit = rand(1, 100) <= pCrit;
        baseDmg = isCrit ? Math.floor(getServerAtk(room.p2.data) * 1.5) : getServerAtk(room.p2.data);
      }
      let playerDef = getServerDef(room.p1.data); let dmg = Math.max(1, baseDmg - playerDef); room.p1.currentHp -= dmg;
      logs.push(`🩸 ${room.p2.data.name} нанес вам ${dmg} урона в ${ZONE_NAMES[room.p2.turn.attack]} ${isCrit ? '💥 КРИТ!' : ''}`);
    }
  }

  if (isNaN(room.p1.currentHp)) room.p1.currentHp = room.p1.maxHp;
  if (isNaN(room.p2.currentHp)) room.p2.currentHp = room.p2.maxHp;
  if (room.p1.currentHp <= 0) room.p1.currentHp = 0;
  if (room.p2.currentHp <= 0) room.p2.currentHp = 0;

  const currentRound = room.turnCount; room.turnCount++; room.p1.turn = null; room.p2.turn = null;
  const isP1Dead = room.p1.currentHp <= 0; const isP2Dead = room.p2.currentHp <= 0;

  if (isP1Dead || isP2Dead || room.turnCount > 40) {
    let resultType = 'draw';
    if (room.p2.isAi) {
      if (!isP1Dead && isP2Dead) resultType = 'p1_win';
      if (isP1Dead && !isP2Dead) resultType = 'monster_win';
      if (room.p1.socket) room.p1.socket.emit('round_result', { myHp: room.p1.currentHp, enemyHp: room.p2.currentHp, logs, isOver: true, resultType, turnCount: currentRound, serverGold: room.p1.data.gold + (resultType === 'p1_win' ? room.p2.data.rewardGold : 0), serverXp: room.p1.data.xp + (resultType === 'p1_win' ? room.p2.data.rewardXp : 0) });
      savePveResultsToSupabase(room.p1, room.p2, resultType);
    } else {
      if (!isP1Dead && isP2Dead) resultType = 'p1_win'; if (isP1Dead && !isP2Dead) resultType = 'p2_win';
      if (room.p1.socket) room.p1.socket.emit('round_result', { myHp: room.p1.currentHp, enemyHp: room.p2.currentHp, logs, isOver: true, resultType, turnCount: currentRound, serverGold: room.p1.data.gold + (resultType === 'p1_win' ? 25 : 0), serverXp: room.p1.data.xp + (resultType === 'p1_win' ? 30 : 0) });
      if (room.p2.socket) room.p2.socket.emit('round_result', { myHp: room.p2.currentHp, enemyHp: room.p1.currentHp, logs, isOver: true, resultType, turnCount: currentRound, serverGold: room.p2.data.gold + (resultType === 'p2_win' ? 25 : 0), serverXp: room.p2.data.xp + (resultType === 'p2_win' ? 30 : 0) });
      saveBattleResultsToSupabase(room.p1, room.p2, resultType);
    }
    if (room.p1.socket) room.p1.socket.leave(room.id);
    if (!room.p2.isAi && room.p2.socket) room.p2.socket.leave(room.id);
    delete activeRooms[roomId];
  } else {
    if (room.p1.socket) room.p1.socket.emit('round_result', { myHp: room.p1.currentHp, enemyHp: room.p2.currentHp, logs, isOver: false, turnCount: currentRound });
    if (!room.p2.isAi && room.p2.socket) room.p2.socket.emit('round_result', { myHp: room.p2.currentHp, enemyHp: room.p1.currentHp, logs, isOver: false, turnCount: currentRound });
    startServerTurnTimer(roomId);
  }
}

async function savePveResultsToSupabase(playerRoomObject, monster, resultType) {
  try {
    const userId = playerRoomObject.data.id;
    let newGold = resultType === 'p1_win' ? (playerRoomObject.data.gold + monster.data.rewardGold) : playerRoomObject.data.gold;
    let newXp = resultType === 'p1_win' ? (playerRoomObject.data.xp + monster.data.rewardXp) : playerRoomObject.data.xp;
    let finalHp = resultType === 'p1_win' ? Math.max(0, playerRoomObject.currentHp) : Math.max(1, Math.floor(playerRoomObject.maxHp * 0.2)); 
    
    // Высчитываем новый уровень по опыту
    let currentLevel = playerRoomObject.data.level || 1;
    const getXpLimit = (lvl) => {
      const nextLevel = lvl + 1;
      if (nextLevel < SERVER_XP_TABLE.length) return SERVER_XP_TABLE[nextLevel];
      return nextLevel * 1000;
    };
    
    const startingLevel = currentLevel;
    while (newXp >= getXpLimit(currentLevel)) {
      currentLevel++;
    }

    // Жестко считываем свободные очки из базы
    let currentStatPoints = playerRoomObject.data.statpoints !== undefined ? Number(playerRoomObject.data.statpoints) : Number(playerRoomObject.data.statPoints || 0);

    if (currentLevel > startingLevel) {
      const levelsGained = currentLevel - startingLevel;
      currentStatPoints += (levelsGained * 5); // +5 очков за каждый левелап
    }

    // ============================================================================
    // 🛡️ АНТИЧИТ-БЛОК: ПРОВЕРКА НА НАКРУТКУ (ПЕРЕПИСАНО ПОД ПЛОСКИЕ КОЛОНКИ БАЗЫ)
    // ============================================================================
    // 🔥 ФИКС: Считываем характеристики напрямую из числовых полей, а не из объекта .stats!
    let str = Number(playerRoomObject.data.strength !== undefined ? playerRoomObject.data.strength : 1);
    let agi = Number(playerRoomObject.data.agility !== undefined ? playerRoomObject.data.agility : 1);
    let end = Number(playerRoomObject.data.endurance !== undefined ? playerRoomObject.data.endurance : 1);
    let int = Number(playerRoomObject.data.intellect !== undefined ? playerRoomObject.data.intellect : 1);
    let lck = Number(playerRoomObject.data.luck !== undefined ? playerRoomObject.data.luck : 1);

    // Считаем, сколько очков характеристик игрок УЖЕ распределил
    // Вычитаем 5, так как теперь базовые статы равны 1 (1+1+1+1+1 = 5)
    const distributedPoints = (str + agi + end + int + lck) - 5;
    
    // Высчитываем абсолютный максимум очков, который вообще доступен игроку на данном уровне
    const maxPossibleTotalPoints = 5 + ((currentLevel - 1) * 5);

    // Сумма распределенных и свободных очков не должна превышать лимит
    if (distributedPoints + currentStatPoints > maxPossibleTotalPoints) {
      console.warn(`🚨 АНТИЧИТ: Обнаружена накрутка статов у игрока ID ${userId}! Сброс в легальные лимиты.`);
      
      // Наказываем читера: обнуляем распределенные статы до единиц
      str = 1; agi = 1; end = 1; int = 1; lck = 1;
      currentStatPoints = maxPossibleTotalPoints;
    }
    // ============================================================================

    // Считаем итоговую выносливость для коррекции здоровья
    const totalEndurance = end + getServerEquipmentBonus(playerRoomObject.data, 'endurance');
    if (currentLevel > startingLevel && resultType === 'p1_win') {
      finalHp = (totalEndurance * 10); // Полное лечение при честном левелапе
    }

    // 🔥 ФИКС СОХРАНЕНИЯ: Теперь отправляем плоские независимые столбцы вместо stats: pStats!
    await sb.from('players').update({ 
      gold: newGold, 
      xp: newXp, 
      hp: finalHp, 
      level: currentLevel,
      statpoints: currentStatPoints, 
      
      // Пишем строго в новые числовые ячейки
      strength: str,
      agility: agi,
      endurance: end,
      intellect: int,
      luck: lck,

      equipped: playerRoomObject.data.equipped 
    }).eq('id', Number(userId));
    
    console.log(`☁️ Безопасный плоский профиль сохранен в Supabase. Уровень: ${currentLevel}, Свободные очки: ${currentStatPoints}`);
  } catch (err) { 
    console.error("❌ Ошибка античита Supabase PvE:", err.message); 
  }
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