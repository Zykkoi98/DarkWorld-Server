// ============================================================================
// ===== ЧАСТЬ 1: ИНИЦИАЛИЗАЦИЯ И СЕРВЕРНЫЕ КАЛЬКУЛЯТОРЫ ХАРАКТЕРИСТИК =====
// ============================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto'); // Для генерации уникальных UUID бойцов
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
// Базовый словарик зелий для инлайн-исцеления
const CONSUMABLE_DATABASE = {
  'hp_potion_small': { name: 'Малое зелье HP', heal: 25 },
  'hp_potion_big':   { name: 'Большое зелье HP', heal: 60 },
  'fish_soup':       { name: 'Уха из таверны', heal: 40 }
};

const app = express();
app.get('/', (req, res) => res.send('⚔️ Боевой сервер Dark World активен и работает!'));
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
// 🔥 ВОТ ЭТОТ ЖЕЛЕЗНЫЙ БЛОК ХРАНИЛИЩА:
let activeRooms = {}; 
const ZONE_NAMES = { head: "Голову", breast: "Грудь", torso: "Торс", belt: "Пояс", legs: "Ноги" };

// Функции расчета чистых боевых параметров на стороне сервера
function getServerDef(fighter) {
  const endurance = Number(fighter.endurance || 1);
  return Math.floor(endurance * 0.5);
}

function getServerAtk(fighter) {
  const strength = Number(fighter.strength || 1);
  return Math.floor(2 + (strength * 1.5));
}

function getServerMaxHp(fighter) {
  const endurance = Number(fighter.endurance || 1);
  return endurance * 10;
}

function sanitizeTeam(team) {
  return team.map(f => ({
    uuid: f.uuid, 
    name: f.name, 
    icon: f.icon, 
    level: f.level,
    currentHp: f.currentHp, 
    maxHp: f.maxHp, 
    isBot: f.isBot, 
    hasSubmitted: !!f.turn,
    // 🔥 ФИКС: Прокидываем на клиент надетое снаряжение персонажа (зелья, свитки и т.д.)
    equipped: f.equipped || null 
  }));
}
// ============================================================================
// ===== ЧАСТЬ 2: СЕТЕВЫЕ СОБЫТИЯ И ИНИЦИАЛИЗАЦИЯ МАССОВОГО БОЯ =====
// ============================================================================
io.on('connection', (socket) => {
  console.log(`🔌 Боец подключился к сокету: ${socket.id}`);

  /**
   * 🔍 МГНОВЕННЫЙ ПРЯМОЙ ОТВЕТ О СТАТУСЕ БОЯ ДЛЯ СТАРТОВОГО ЭКРАНА СИТИ
   */
  socket.on('check_active_battle_directly', ({ userId }, callback) => {
    const sUserId = String(userId);
    
    // Ищем в оперативной памяти сервера комнату, где этот игрок числится в команде А
    const activeRoomId = Object.keys(activeRooms).find(roomId => {
      return activeRooms[roomId].teamA.some(fighter => String(fighter.id) === sUserId);
    });
    
    if (activeRoomId) {
      console.log(`🔄 Экспресс-перехват: Игрок ID ${sUserId} обнаружен в активном бою ${activeRoomId}. Отправляем редирект.`);
      // Вызываем функцию обратного вызова на клиенте и передаем ID комнаты
      callback({ activeRoomId: activeRoomId });
    } else {
      callback({ activeRoomId: null });
    }
  });
   /**
   * 🔄 СЛУШАТЕЛЬ ПЕРЕПОДКЛЮЧЕНИЯ ВО ВКЛАДКЕ БОЯ (ДЛЯ ОБОРВАННЫХ СЕССИЙ)
   */
  socket.on('reconnect_to_battle', ({ roomId, userId }) => {
    const room = activeRooms[roomId];
    if (!room) {
      return socket.emit('error', 'Срок действия боевой комнаты истек или бой уже завершился.');
    }

    const sUserId = String(userId);
    const pFighter = room.teamA.find(f => String(f.id) === sUserId);

    if (pFighter) {
      console.log(`🔌 Боец ID ${sUserId} успешно восстановил сокет-соединение с комнатой ${roomId}`);
      
      // Привязываем новый сокет вкладки боя к текущей комнате
      pFighter.socketId = socket.id;
      socket.join(roomId);

      // Мгновенно высылаем ему текущие ХП участников и лог, снимая шторку загрузки
      socket.emit('battle_init_data', {
        roomId: roomId,
        turnCount: room.turnCount,
        myUuid: pFighter.uuid,
        teamA: sanitizeTeam(room.teamA),
        teamB: sanitizeTeam(room.teamB)
      });
    } else {
      socket.emit('error', 'Вы не являетесь участником этого поединка.');
    }
  });
 /**
  
   * 🔍 ИСПРАВЛЕННЫЙ СЛУШАТЕЛЬ ПРОВЕРКИ АКТИВНОГО БОЯ (БЕЗ ОШИБОК ТИПОВ ДАННЫХ)
   */
  socket.on('check_active_battle', ({ userId }) => {
    const sUserId = String(userId); // 🔥 Принудительно приводим ID из города к строке
    
    // Ищем в оперативной памяти комнату, где этот игрок находится в команде teamA
    const activeRoomId = Object.keys(activeRooms).find(roomId => {
      return activeRooms[roomId].teamA.some(fighter => String(fighter.id) === sUserId); // 🔥 Сверяем строго как строки!
    });

    if (activeRoomId) {
      console.log(`🔄 Восстановление сессии: Игрок ID ${sUserId} найден в бою ${activeRoomId}. Направляем на арену.`);
      // Отправляем команду в город сделать принудительный редирект
      socket.emit('arena_redirect_to_battle', { roomId: activeRoomId });
    } else {
      console.log(`🔍 Восстановление сессии: Игрок ID ${sUserId} в активных боях не числится.`);
    }
  });
  // ============================================================================
  // ===== 🌲 ОБНОВЛЕННЫЙ СЛУШАТЕЛЬ PvE С ХАРД-ЗАЩИТОЙ ОТ ДУБЛИРОВАНИЯ БОЕВ =====
  // ============================================================================
  socket.on('search_pve_match', async ({ playerData, monsterKey, count }) => {
    try {
      const sPlayerId = String(playerData.id);

      // 1. 🔥 ХАРД-ЗАЩИТА: Ищем, нет ли у этого игрока УЖЕ ЗАПУЩЕННОГО боя в памяти ОЗУ сервера
      const existingRoomId = Object.keys(activeRooms).find(rId => {
        return activeRooms[rId].teamA.some(fighter => fighter.id === sPlayerId);
      });

      // 🛑 Если бой уже идет, ЖЕСТКО ЗАПРЕЩАЕМ создавать новый и просто возвращаем на арену!
      if (existingRoomId) {
        console.log(`⚠️ Игрок [ID: ${sPlayerId}] уже находится в бою ${existingRoomId}! Перехватываем дубликат.`);
        
        const existingRoom = activeRooms[existingRoomId];
        
        // Обновляем сокет игрока на актуальный (так как страница была перезагружена)
        const pFighter = existingRoom.teamA.find(fighter => fighter.id === sPlayerId);
        if (pFighter) {
          pFighter.socketId = socket.id;
        }

        // Привязываем новый сокет перезагрузившейся страницы к старой сокет-комнате на сервере
        socket.join(existingRoomId);

        // Мгновенно возвращаем игроку данные его текущего незавершенного поединка
        return socket.emit('battle_init_data', {
          roomId: existingRoomId,
          turnCount: existingRoom.turnCount,
          myUuid: pFighter ? pFighter.uuid : `player_${sPlayerId}`,
          teamA: sanitizeTeam(existingRoom.teamA),
          teamB: sanitizeTeam(existingRoom.teamB)
        });
      }

      // -------------------------------------------------------------------------
      // 2. ЛОГИКА СОЗДАНИЯ НОВОГО БОЯ (сработает, только если игрок действительно свободен)
      // -------------------------------------------------------------------------
      const monsterCount = Math.min(5, Math.max(1, Number(count || 1)));
      console.log(`📡 Игрок ID ${sPlayerId} свободен. Ищем монстра с ID: "${monsterKey}" для новой комнаты...`);

      // Безопасный maybeSingle() защищает сервер от вылетов
      const { data: dbMonster, error: mErr } = await sb.from('bots').select('*').eq('id', monsterKey).maybeSingle();
      if (mErr) return socket.emit('error', `Ошибка базы bots: ${mErr.message}`);
      if (!dbMonster) return socket.emit('error', `Монстр "${monsterKey}" не найден в Supabase!`);

      // Скачиваем актуальный профиль игрока из таблицы players
      const { data: dbPlayer, error: pErr } = await sb.from('players').select('*').eq('id', Number(playerData.id)).single();
      if (pErr || !dbPlayer) return socket.emit('error', 'Ошибка загрузки профиля игрока из базы.');

      const roomId = `room_pve_${dbPlayer.id}_${Date.now()}`;
      const pMaxHp = dbPlayer.endurance * 10;
      
      // Формируем Команду А (Игрок)
      const teamA = [{
        uuid: `player_${dbPlayer.id}`,
        id: String(dbPlayer.id),
        name: dbPlayer.name,
        icon: '👤',
        isBot: false,
        level: Number(dbPlayer.level),
        strength: Number(dbPlayer.strength),
        agility: Number(dbPlayer.agility),
        endurance: Number(dbPlayer.endurance),
        intellect: Number(dbPlayer.intellect),
        luck: Number(dbPlayer.luck),
        currentHp: Math.min(Number(dbPlayer.hp), pMaxHp),
        maxHp: pMaxHp,
        socketId: socket.id,
        turn: null,
        gold: Number(dbPlayer.gold),
        xp: Number(dbPlayer.xp),
        statpoints: Number(dbPlayer.statpoints),
        equipped: dbPlayer.equipped || {},
        inventory: dbPlayer.inventory || {}
      }];

      // Формируем Команду Б (Враги из базы Supabase)
      const teamB = [];
      const mMaxHp = dbMonster.endurance * 10;
      
      for (let i = 0; i < monsterCount; i++) {
        teamB.push({
          uuid: `bot_${dbMonster.id}_${i}_${Date.now()}`,
          id: dbMonster.id,
          name: monsterCount > 1 ? `${dbMonster.name} #${i + 1}` : dbMonster.name,
          icon: dbMonster.icon,
          isBot: true,
          level: Number(dbMonster.level),
          strength: Number(dbMonster.strength),
          agility: Number(dbMonster.agility),
          endurance: Number(dbMonster.endurance),
          intellect: Number(dbMonster.intellect),
          luck: Number(dbMonster.luck),
          currentHp: mMaxHp,
          maxHp: mMaxHp,
          rewardXp: Number(dbMonster.reward_xp),
          rewardGold: Number(dbMonster.reward_gold),
          lootTable: dbMonster.loot_table || [],
          turn: null
        });
      }

      // Регистрируем новую комнату боя в оперативной памяти бэкенда
      activeRooms[roomId] = {
        id: roomId,
        type: 'pve',
        teamA: teamA,
        teamB: teamB,
        turnCount: 1,
        timeoutRef: null
      };

      // Подписываем текущий сокет на изолированную сокет-комнату
      socket.join(roomId);
      
      // Отправляем стартовый пакет инициализации на клиент боевой вкладки
      socket.emit('battle_init_data', {
        roomId: roomId,
        turnCount: 1,
        myUuid: `player_${dbPlayer.id}`,
        teamA: sanitizeTeam(teamA),
        teamB: sanitizeTeam(teamB)
      });

      // Запускаем 30-секундный автотаймер раунда
      startServerTurnTimer(roomId);
      console.log(`🌲 [УСПЕХ] Новый массовый PvE бой ${roomId} успешно создан (1 против ${monsterCount}).`);
      
    } catch (err) {
      console.error("🚨 КРИТИЧЕСКАЯ ОШИБКА НА СЕРВЕРЕ ПРИ СТАРТЕ PvE БОЯ:", err);
      socket.emit('error', `Внутренняя ошибка сервера: ${err.message}`);
    }
  });

  /**
   * СЛУШАТЕЛЬ ХОДОВ ОТ ЖИВЫХ ИГРОКОВ
   */
  socket.on('submit_turn', ({ roomId, targetUuid, attack, defends }) => {
    const room = activeRooms[roomId];
    if (!room) return;

    const fighter = room.teamA.find(p => p.socketId === socket.id);
    if (!fighter || fighter.currentHp <= 0 || fighter.turn) return;

    fighter.turn = { targetUuid: targetUuid, attack: attack, defends: defends || [] };

    const awaitingPlayers = room.teamA.filter(p => !p.isBot && p.currentHp > 0 && !p.turn);
    if (awaitingPlayers.length === 0) {
      clearTimeout(room.timeoutRef);
      executeRoundCalculations(roomId);
    }
  });

  /**
   * МГНОВЕННОЕ ИСПОЛЬЗОВАНИЕ ЗЕЛЬЯ ИЗ СЛОТА КУКЛЫ
   */
  socket.on('instant_use_potion', ({ roomId }) => {
    const room = activeRooms[roomId];
    if (!room) return;

    const fighter = room.teamA.find(p => p.socketId === socket.id);
    if (!fighter || fighter.currentHp <= 0) return;

    const potionId = fighter.equipped?.potion;
    const potionData = CONSUMABLE_DATABASE[potionId];

    if (potionData) {
      fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + potionData.heal);
      if (fighter.equipped) fighter.equipped.potion = null; // Тратим предмет

      io.to(roomId).emit('battle_effect_potion', {
        uuid: fighter.uuid,
        currentHp: fighter.currentHp,
        logMsg: `🧪 <strong>${fighter.name}</strong> выпил ${potionData.name} и восстановил ${potionData.heal} HP!`
      });

      sb.from('players').update({ hp: fighter.currentHp, equipped: fighter.equipped }).eq('id', Number(fighter.id)).then();
    }
  });

  socket.on('disconnect', () => {
    Object.keys(activeRooms).forEach(roomId => {
      const room = activeRooms[roomId];
      const fighter = room.teamA.find(p => p.socketId === socket.id);
      if (fighter) fighter.socketId = null;
    });
  });
});

function startServerTurnTimer(roomId) {
  const room = activeRooms[roomId]; 
  if (!room) return;

  // Очищаем старые ссылки, если они зависли
  if (room.timeoutRef) clearTimeout(room.timeoutRef);

  room.timeoutRef = setTimeout(() => {
    // Еще раз проверяем, жива ли комната (ее могли закрыть во время тика)
    if (!activeRooms[roomId]) return;

    room.teamA.forEach(f => {
      if (!f.isBot && !f.turn && f.currentHp > 0) {
        const aliveEnemies = room.teamB.filter(e => e.currentHp > 0);
        
        // 🔥 ЖЕСТКИЙ ФИКС: Берем uuid ПЕРВОГО [0] живого врага из массива!
        const autoTargetUuid = aliveEnemies.length > 0 ? aliveEnemies[0].uuid : null;
        
        f.turn = { 
          targetUuid: autoTargetUuid, 
          attack: null, // Пропуск атаки
          defends: []   // Без блоков
        };
        console.log(`⏱️ Автотаймер: Игрок ${f.name} проспал ход. Выбрана автоцель: ${autoTargetUuid}`);
      }
    });
    
    // Запускаем вычисления раунда
    executeRoundCalculations(roomId);
  }, 30000); // 30 секунд на размышление
}
// ============================================================================
// ===== ЧАСТЬ 3: РАСЧЕТ РАУНДОВ ПО ЛОВКОСТИ И ВЫДАЧА НАГРАД (ЛУТА) =====
// ============================================================================
function executeRoundCalculations(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;

  const logs = [];
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // 1. Генерируем тактику ИИ для монстров (Team B)
  room.teamB.forEach(bot => {
    if (bot.currentHp <= 0) return;
    const aliveTargets = room.teamA.filter(a => a.currentHp > 0);
    if (aliveTargets.length === 0) return;

    const target = aliveTargets[rand(0, aliveTargets.length - 1)];
    const zones = ["head", "breast", "torso", "belt", "legs"];
    const mAttack = zones[rand(0, 4)];
    const mDefend = [];
    while (mDefend.length < 2) {
      const rz = zones[rand(0, 4)];
      if (!mDefend.includes(rz)) mDefend.push(rz);
    }
    bot.turn = { targetUuid: target.uuid, attack: mAttack, defends: mDefend };
  });

  // 2. СОРТИРОВКА ОЧЕРЕДИ ХОДОВ ПО ЛОВКОСТИ (ИНИЦИАТИВА)
  let queue = [...room.teamA, ...room.teamB];
  queue.sort((a, b) => Number(b.agility || 0) - Number(a.agility || 0));

  // 3. Цикл проведения ударов раунда
  queue.forEach(attacker => {
    if (attacker.currentHp <= 0 || !attacker.turn || !attacker.turn.targetUuid) return;

    let target = room.teamA.find(f => f.uuid === attacker.turn.targetUuid) || 
                 room.teamB.find(f => f.uuid === attacker.turn.targetUuid);

    // Авто-перенаправление удара, если выбранная цель уже мертва
    if (!target || target.currentHp <= 0) {
      const opposingTeam = room.teamA.includes(attacker) ? room.teamB : room.teamA;
      const newAliveTargets = opposingTeam.filter(t => t.currentHp > 0);
      if (newAliveTargets.length === 0) return;
      target = newAliveTargets[0];
    }

    if (attacker.turn.attack === null) {
      logs.push(`❌ <strong>${attacker.name}</strong> пропустил атаку.`);
      return;
    }

    // Сверка атаки и блоков защиты
    if (target.turn && target.turn.defends.includes(attacker.turn.attack)) {
      logs.push(`🛡️ <strong>${target.name}</strong> заблокировал удар от <strong>${attacker.name}</strong> в ${ZONE_NAMES[attacker.turn.attack]}.`);
    } else {
      let critChance = Math.min(50, 5 + (Number(attacker.luck || 1) * 0.5));
      let isCrit = rand(1, 100) <= critChance;
      
      let baseDmg = getServerAtk(attacker);
      if (isCrit) baseDmg = Math.floor(baseDmg * 1.5);

      let targetDef = getServerDef(target);
      let dmg = Math.max(1, baseDmg - targetDef);

      target.currentHp = Math.max(0, target.currentHp - dmg);
      logs.push(`⚔️ <strong>${attacker.name}</strong> ударил <strong>${target.name}</strong> на <strong>${dmg}</strong> урона в ${ZONE_NAMES[attacker.turn.attack]} ${isCrit ? '💥 КРИТ!' : ''}`);

      if (target.currentHp <= 0) logs.push(`💀 <strong>${target.name}</strong> повержен!`);
    }
  });

  // Зачищаем ходы
  room.teamA.forEach(f => f.turn = null);
  room.teamB.forEach(f => f.turn = null);

  const isTeamADead = room.teamA.every(f => f.currentHp <= 0);
  const isTeamBDead = room.teamB.every(f => f.currentHp <= 0);
  const currentRound = room.turnCount;
  room.turnCount++;

  if (isTeamADead || isTeamBDead || room.turnCount > 40) {
    let battleResult = 'draw';
    if (!isTeamADead && isTeamBDead) battleResult = 'win';
    if (isTeamADead && !isTeamBDead) battleResult = 'lose';

    if (room.type === 'pve') finalizePveBattle(room, battleResult, logs, currentRound);
  } else {
    room.teamA.forEach(player => {
      if (player.socketId) {
        io.to(player.socketId).emit('round_result', {
          turnCount: currentRound, logs: logs, isOver: false,
          teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB)
        });
      }
    });
    startServerTurnTimer(roomId);
  }
}

// ============================================================================
// ===== 💎 ИСПРАВЛЕННЫЙ РАСЧЕТ НАГРАД PvE (ФИКС МАССИВА ИГРОКОВ) =====
// ============================================================================
async function finalizePveBattle(room, result, logs, finalRound) {
  const player = room.teamA[0]; // Извлекаем игрока из массива
  if (!player) {
    delete activeRooms[room.id];
    return;
  }

  let gainedXp = 0; 
  let gainedGold = 0;
  let textLootReport = []; 
  let droppedItems = [];

  // Сохраняем ХП, которое было на момент окончания боя, чтобы отправить клиенту честный ноль
  const battleEndHp = player.currentHp; 

  if (result === 'win') {
    room.teamB.forEach(monster => {
      gainedXp += monster.rewardXp || 0; 
      gainedGold += monster.rewardGold || 0;
      if (monster.lootTable && Array.isArray(monster.lootTable)) {
        monster.lootTable.forEach(loot => {
          if (Math.random() <= loot.chance) {
            const count = Math.floor(Math.random() * (loot.maxCount - loot.minCount + 1)) + loot.minCount;
            droppedItems.push({ itemId: loot.itemId, count });
          }
        });
      }
    });

    player.gold += gainedGold; 
    player.xp += gainedXp;
    
    let currentLevel = player.level;
    const getXpLimit = (lvl) => (lvl + 1 < SERVER_XP_TABLE.length) ? SERVER_XP_TABLE[lvl + 1] : (lvl + 1) * 1000;
    const startingLevel = currentLevel;
    while (player.xp >= getXpLimit(currentLevel)) currentLevel++;

    if (currentLevel > startingLevel) {
      const levelsGained = currentLevel - startingLevel;
      player.statpoints += (levelsGained * 5); 
      const pMaxHp = Number(player.endurance || 1) * 10;
      player.currentHp = pMaxHp;
      logs.push(`🎉 <strong>УРОВЕНЬ ПОВЫШЕН!</strong> Достигнут ${currentLevel} уровень! Получено +${levelsGained * 5} очков.`);
    }
    player.level = currentLevel;

    if (droppedItems.length > 0) {
      if (!player.inventory.resources) player.inventory.resources = [];
      droppedItems.forEach(drop => {
        const existing = player.inventory.resources.find(i => i.id === drop.itemId);
        if (existing) { existing.count = (existing.count || 1) + drop.count; } 
        else { player.inventory.resources.push({ id: drop.itemId, count: drop.count }); }
        textLootReport.push(`${drop.itemId} x${drop.count}`);
      });
    }

    logs.push(`🏁 <strong>ПОБЕДА!</strong> Награда: 💰 ${gainedGold} монет, ✨ ${gainedXp} опыта.`);
    if (textLootReport.length > 0) logs.push(`💎 <strong>Добыча:</strong> ${textLootReport.join(', ')}`);
  } 
  // 💀 ЕСЛИ ИГРОК ПРОИГРАЛ:
  else {
    logs.push(`🏁 <strong>ВАС ОДОЛЕЛИ...</strong> Воскрешение в городе (20% HP).`);
    // На самом сервере в ОЗУ комнаты ХП пока остается равным 0, чтобы клиент отрендерил смерть!
  }

  // 🔥 ЭТАП 1: Отправляем финальный пакет раунда клиенту ДО ТОГО, как изменим ХП для Supabase!
  // В sanitizeTeam улетит player.currentHp, который равен 0 при проигрыше.
  if (player.socketId) {
    io.to(player.socketId).emit('round_result', {
      turnCount: finalRound, 
      logs, 
      isOver: true, 
      resultType: result,
      teamA: sanitizeTeam(room.teamA), 
      teamB: sanitizeTeam(room.teamB)
    });
    io.sockets.sockets.get(player.socketId)?.leave(room.id);
  }

  // 🔥 ЭТАП 2: Только ПОСЛЕ отправки пакета начисляем штрафное ХП воскрешения для записи в облако!
  if (result !== 'win') {
    player.currentHp = Math.max(1, Math.floor(player.maxHp * 0.2));
  }

  // Синхронизируем измененный профиль с базой данных Supabase
  try {
    await sb.from('players').update({
      gold: player.gold, 
      xp: player.xp, 
      hp: player.currentHp, // В базу запишется воскрешенное ХП (например, 6)
      level: player.level, 
      statpoints: player.statpoints, 
      inventory: player.inventory
    }).eq('id', Number(player.id));
    console.log(`☁️ Итоги PvE сохранены. Игрок воскрешен в бд с ХП: ${player.currentHp}`);
  } catch (err) { 
    console.error("Ошибка сохранения в Supabase:", err.message); 
  }
  
  delete activeRooms[room.id];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Боевой сервер 5х5 успешно запущен на порту ${PORT}`));