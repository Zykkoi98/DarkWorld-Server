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

const app = express();
app.get('/', (req, res) => res.send('⚔️ Боевое ядро Dark World активно на Render!'));

const server = http.createServer(app);
const io = new Server(server, { 
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

io.on('connection', (socket) => {
  console.log(`🔌 Подключен сокет игрока: ${socket.id}`);

  // 1. ПОДКЛЮЧАЕМ МОДУЛЬ БАЗЫ ДАННЫХ И АНТИЧИТА (Вход, сохранение, прокачка статов)
  dbHelper(io, socket, sb);

  // 2. ПОДКЛЮЧАЕМ ВЫНЕСЕННЫЙ МОДУЛЬ ИНВЕНТАРЯ (Безопасная смена вещей)
  inventoryLogic(io, socket, sb);

  // 3. ПОДКЛЮЧАЕМ БОЕВОЙ МОДУЛЬ И АРЕНУ (PvE, PvP лобби, пошаговые удары)
  battleLogic(io, socket, sb, activeRooms);

  socket.on('disconnect', () => {
    // Чистим socketId оффлайн игроков в активных битвах
    Object.keys(activeRooms).forEach(roomId => {
      const room = activeRooms[roomId];
      const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
      if (fighter) fighter.socketId = null;
    });
    console.log(`❌ Сокет отключен: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен строго по правилам на порту ${PORT}`));