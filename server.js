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
// 🔥 [РЕГЕНЕРАЦИЯ HP В ГОРОДЕ] — Восстановление 1% ХП в секунду онлайн-игрокам
// ============================================================================
const activeOnlinePlayers = {}; // Временное ОЗУ-хранилище для живых сессий города

// 1. Ежесекундный тикер лечения
setInterval(async () => {
  const socketIds = Object.keys(activeOnlinePlayers);
  // 🔥 ДОБАВЛЯЕМ ЛОГ ДЛЯ ДЕБАГА СЕРВЕРА:
  console.log(`⏱️ [ТИК РЕГЕНЕРАЦИИ] Сейчас онлайн в тикере: ${socketIds.length} игроков. Активные сокеты:`, socketIds);
  if (socketIds.length === 0) return;

  socketIds.forEach(sId => {
    const p = activeOnlinePlayers[sId];
    
    // 🛡️ Защита: Если игрок зашел в бой (Лес, Башня, Арена), замораживаем регенерацию города!
    const isInBattle = Object.keys(global.activeRooms || {}).some(roomId => {
      const room = global.activeRooms[roomId];
      return room.teamA.some(f => String(f.id) === String(p.id)) || 
             room.teamB.some(f => String(f.id) === String(p.id));
    });

    if (isInBattle) return; 

    // Считаем точный серверный кап здоровья с куклой шмоток
    const maxHp = dbHelper.getServerMaxHp(p);
    
    if (p.hp < maxHp) {
      const regenAmount = Math.max(1, Math.floor(maxHp * 0.01)); // 1% в сек (минимум 1 HP)
      p.hp = Math.min(maxHp, p.hp + regenAmount);
      p.needsSave = true; // Флаг для фонового сброса в БД

      // Шлем пакет на телефон игрока для плавной анимации
      io.to(sId).emit('town_hp_regen_update', { 
        currentHp: p.hp, 
        maxHp: maxHp 
      });
    }
  });
}, 1000);

// 2. Фоновый сброс в Supabase раз в 15 секунд (чтобы не спамить базу тяжелыми запросами)
setInterval(async () => {
  const socketIds = Object.keys(activeOnlinePlayers);
  for (const sId of socketIds) {
    const p = activeOnlinePlayers[sId];
    if (p && p.needsSave) {
      p.needsSave = false;
      try {
        await sb.from('players').update({ hp: Number(p.hp) }).eq('id', Number(p.id));
        console.log(`☁️ [БД РЕГЕНЕРАЦИЯ] Здоровье гладиатора ${p.name} синхронизировано: ${p.hp} HP.`);
      } catch (err) {
        console.error("🚨 Ошибка сохранения ХП регенерации:", err.message);
      }
    }
  }
}, 15000);
io.on('connection', (socket) => {
  console.log(`🔌 Подключен сокет игрока: ${socket.id}`);
   // 1. ТРИГГЕР ВХОДА (Запоминаем игрока в ОЗУ регенерации)
  socket.on('load_game_secure', async ({ userId }) => {
    // Мягкое ожидание 150мс, пока db_helper загрузит профиль из базы
    setTimeout(async () => {
      try {
        const { data: row } = await sb.from('players').select('*').eq('id', Number(userId)).maybeSingle();
        if (row) {
          activeOnlinePlayers[socket.id] = {
            id: row.id,
            name: row.name,
            hp: Number(row.hp || 10),
            endurance: Number(row.endurance || 1),
            equipped: row.equipped || {},
            needsSave: false
          };
        }
      } catch (e) {}
    }, 150);
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

  // 🏰 [ИСПРАВЛЕНО] Инициализируем ядро Бесконечной Башни (Переменная теперь легально объявлена)
  if (typeof towerLogic === 'function') {
    towerLogic(io, socket, sb, activeRooms);
  }

  // 4. Инициализируем магазин города
  if (typeof shopLogic === 'function') {
    shopLogic(io, socket, sb);
  }

  // 2. ТРИГГЕР ОТКЛЮЧЕНИЯ (Убираем из списка лечения, чтобы не тратить ОЗУ)
  socket.on('disconnect', () => {
    const p = activeOnlinePlayers[socket.id];
    if (p) {
      delete activeOnlinePlayers[socket.id];
      console.log(`🧹 [РЕГЕНЕРАЦИЯ] Игрок ${p.name} отключился, сессия лечения закрыта.`);
    }

    // Твой старый код дисконнекта комнат (очистка сокетов в activeRooms) оставляй без изменений:
    Object.keys(activeRooms).forEach(roomId => {
      const room = activeRooms[roomId];
      const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
      if (fighter) fighter.socketId = null;
    });
    console.log(`❌ Сокет отключен: ${socket.id}`);
  });
});