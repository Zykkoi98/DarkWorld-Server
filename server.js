// ============================================================================
// ===== 🚀 ГЛАВНЫЙ СЕРВЕРНЫЙ ДИСПЕТЧЕР DARK WORLD (SERVER.JS) =====
// ============================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

// Импортируем наши отдельные модули логики
const dbHelper = require('./db_helper');
const inventoryLogic = require('./inventory_logic');
const battleLogic = require('./battle_logic');
const shopLogic = require('./shop/shop_logic');
const towerLogic = require('./tower/tower_logic'); 
const app = express();
app.get('/', (req, res) => res.send('⚔️ Боевое ядро Dark World активно на Render!'));

const server = http.createServer(app);
const io = new Server(server, { 
  pingTimeout: 120000,  // Сервер будет ждать ответа от смартфона целых 2 минуты (120 сек) вместо 25
  pingInterval: 45000, // Сервер будет отправлять пинг раз в 45 секунд, снижая нагрузку на сеть
  cors: { 
    origin: [
      "https://zykkoi98.github.io",
      "https://github.io", // Вариант с закрывающим слэшем 
      "http://localhost:3000",
      "http://127.0.0.1:5500"
    ],
    methods: ["GET", "POST"],
    credentials: true
  } 
});
// Инициализация Supabase из переменных окружения Render
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Глобальная память для активных боевых комнат
let activeRooms = {}; 
global.activeRooms = activeRooms;

// ============================================================================
// 🔥 [АВТОНОМНАЯ РЕГЕНЕРАЦИЯ HP] — Память онлайн-сессий города
// ============================================================================
const activeOnlinePlayers = {}; 

// 1. Ежесекундное плавное лечение в городе
setInterval(() => {
  try {
    const socketIds = Object.keys(activeOnlinePlayers);
    if (socketIds.length === 0) return;

    socketIds.forEach(sId => {
      const p = activeOnlinePlayers[sId];
      if (!p || !p.id) return; // Защита от пустых сокетов

      // Заморозка лечения, если гладиатор ушел в бой
      const isInBattle = Object.keys(activeRooms || {}).some(roomId => {
        const room = activeRooms[roomId];
        return room && room.teamA && room.teamA.some(f => f && String(f.id) === String(p.id));
      });

      if (isInBattle) return;

      // 🔥 [ИСПРАВЛЕНО]: Больше никаких ReferenceError! Безопасно вызываем твой 
      // рабочий dbHelper. Если он занят, включается резервный автономный расчет.
      let maxHp = 100;
      if (dbHelper && typeof dbHelper.getServerMaxHp === 'function') {
        maxHp = dbHelper.getServerMaxHp(p);
      } else {
        maxHp = (Number(p.endurance || 1) * 10); 
      }
      
      if (p.hp < maxHp) {
        const regenAmount = Math.max(1, Math.floor(maxHp * 0.01)); // 1% в сек
        p.hp = Math.min(maxHp, p.hp + regenAmount);
        p.needsSave = true;

        // Отправляем эвент регенерации на телефон игрока
        io.to(sId).emit('town_hp_regen_update', { 
          currentHp: p.hp, 
          maxHp: maxHp 
        });
      }
    });
  } catch (globalLoopErr) {
    console.error("🚨 Сбой тикера регенерации:", globalLoopErr.message);
  }
}, 1000);

// 2. Безопасный фоновый сброс накопленного ХП в Supabase раз в 15 секунд
setInterval(async () => {
  try {
    const socketIds = Object.keys(activeOnlinePlayers);
    if (socketIds.length === 0) return;

    for (const sId of socketIds) {
      const p = activeOnlinePlayers[sId];
      if (p && p.needsSave && p.id) {
        p.needsSave = false;
        // Апдейтим строго одну колонку здоровья
        await sb.from('players').update({ hp: Number(p.hp) }).eq('id', Number(p.id));
        console.log(`☁️ [БД РЕГЕНЕРАЦИЯ] Здоровье ${p.name} сохранено: ${p.hp} HP.`);
      }
    }
  } catch (dbSaveErr) {
    console.error("🚨 Сбой базы при сохранении регенерации:", dbSaveErr.message);
  }
}, 15000);
// ============================================================================

// ГЛАВНЫЙ СЛУШАТЕЛЬ СОКЕТ-ПОДКЛЮЧЕНИЙ
io.on('connection', (socket) => {
  console.log(`🔌 Подключен сокет игрока: ${socket.id}`);

  // Регистрация сокета в ОЗУ тикера лечения при успешном входе в город
  socket.on('load_game_secure', async (payload) => {
    try {
      const nUserId = Number(payload?.userId || payload?.id || 0);
      if (!nUserId) return;
       // 🔥 СОХРАНЯЕМ userId В СОКЕТЕ
      socket.data = socket.data || {};
      socket.data.userId = nUserId;
      const { data: row } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      if (row) {
        // Сканируем регистры выносливости из Supabase
        const dbEndurance = row.endurance ?? row.Endurance ?? row.stats?.endurance ?? 1;
        
        activeOnlinePlayers[socket.id] = {
          id: row.id,
          name: row.name,
          hp: Number(row.hp || 10),
          endurance: Number(dbEndurance),
          equipped: row.equipped || {},
          needsSave: false
        };
        console.log(`✅ [РЕГЕНЕРАЦИЯ ВХОД] Гладиатор ${row.name} добавлен в очередь лечения.`);
      }
    } catch (e) { 
      console.error("🚨 Ошибка авторизации тикера:", e.message); 
    }
  });

  // 1. Инициализируем модуль базы данных и античита (Передаем io, socket, sb)
  if (dbHelper && typeof dbHelper.init === 'function') {
    dbHelper.init(io, socket, sb);
  } else if (typeof dbHelper === 'function') {
    dbHelper(io, socket, sb);
  }

  // 2. Инициализируем защищенный модуль инвентаря (Перенос вещей куклы)
  if (typeof inventoryLogic === 'function') {
    inventoryLogic(io, socket, sb);
  }

  // 3. Инициализируем боевой движок (PvE монстры, PvP Арена лобби и комнаты)
  if (typeof battleLogic === 'function') {
    battleLogic(io, socket, sb, activeRooms);
  }

  // 4. Инициализируем ядро Бесконечной Башни
  if (typeof towerLogic === 'function') {
    towerLogic(io, socket, sb, activeRooms);
  }

  // 5. Инициализируем магазин города
  if (typeof shopLogic === 'function') {
    shopLogic(io, socket, sb);
  }

  // Безопасное отключение: чистим socketId оффлайн-игроков и убираем из тикера регенерации
socket.on('disconnect', () => {
    const p = activeOnlinePlayers[socket.id];
    if (p) {
      delete activeOnlinePlayers[socket.id];
      console.log(`🧹 [РЕГЕНЕРАЦИЯ] Игрок ${p.name} отключился, сессия лечения закрыта.`);
    }

    Object.keys(activeRooms).forEach(roomId => {
      const room = activeRooms[roomId];
      if (!room || !room.teamA) return;

      const fighter = [...room.teamA, ...room.teamB].find(f => f && f.socketId === socket.id);
      if (!fighter) return;

      fighter.socketId = null;
      fighter.disconnectedAt = Date.now(); // 🔥 Запоминаем время отключения

      // 🔥 В PvP — даём 10 секунд grace, потом дисквалификация
      if (room.type === 'pvp' && !room.isOver) {
        console.log(`⚠️ [PvP ДИСКОННЕКТ] ${fighter.name} отключился. Запускаем grace-таймер 10 сек...`);
        
        // Уведомляем соперника
        io.to(roomId).emit('opponent_disconnected', {
          name: fighter.name,
          graceSeconds: 10
        });

        // Запускаем таймер дисквалификации
        setTimeout(() => {
          const currentRoom = activeRooms[roomId];
          if (!currentRoom || currentRoom.isOver) return;

          const currentFighter = [...currentRoom.teamA, ...currentRoom.teamB]
            .find(f => String(f.id) === String(fighter.id));

          // Если игрок не вернулся — дисквалифицируем
          if (currentFighter && !currentFighter.socketId) {
            console.log(`🛑 [PvP ДИСКОННЕКТ] ${currentFighter.name} не вернулся. Техническое поражение.`);
            currentFighter.currentHp = 0;
            
            // Запускаем финализацию раунда (она сама проверит, что HP = 0, и завершит бой)
            if (typeof global.executeRoundCalculations === 'function') {
              global.executeRoundCalculations(roomId, activeRooms, io);
            }
          }
        }, 10000);
      }

      // 🔥 В PvE — просто продолжаем бой, игрок вернётся через reconnect
      if (room.type === 'pve') {
        console.log(`⚠️ [PvE ДИСКОННЕКТ] ${fighter.name} отключился. Бой продолжится, АФК-система сработает.`);
      }
    });

    console.log(`❌ Сокет отключен: ${socket.id}`);
  });
});

// Запуск сервера на порту Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер Dark World запущен по правилам Стойкости на порту ${PORT}`);
});