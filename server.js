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
const shopLogic = require('./shop_logic');
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

io.on('connection', (socket) => {
  console.log(`🔌 Подключен сокет игрока: ${socket.id}`);

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
  if (typeof shopLogic === 'function') {
  shopLogic(io, socket, sb);
  }

  // Безопасное отключение: чистим socketId оффлайн-игроков в активных битвах
  socket.on('disconnect', () => {
    Object.keys(activeRooms).forEach(roomId => {
      const room = activeRooms[roomId];
      const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
      if (fighter) fighter.socketId = null;
    });
    console.log(`❌ Сокет отключен: ${socket.id}`);
  });
});

// Запуск сервера на порту Render или локальном 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер Dark World запущен по правилам Стойкости на порту ${PORT}`);
});