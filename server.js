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
// 🔥 [АВТОНОМНАЯ РЕГЕНЕРАЦИЯ HP] — Полный код без конфликтов с другими файлами
// ============================================================================
const activeOnlinePlayers = {}; 

// Локальный чистый сборщик бонусов выносливости со шмоток для защиты от Build Failed
function getLocalEnduranceBonus(equipped) {
  if (!equipped) return 0;
  let bonus = 0;
  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand', 'extra'];
  
  slots.forEach(slot => {
    const itemId = equipped[slot];
    if (!itemId) return;
    // Безопасно ищем предмет в глобальной базе, которую подключил server.js
    const item = GAME_ITEMS_DATABASE ? GAME_ITEMS_DATABASE[itemId] : null;
    if (item && item.bonus) {
      if (item.bonus.endurance !== undefined) bonus += item.bonus.endurance;
      if (item.bonus.stats && item.bonus.stats.endurance !== undefined) bonus += item.bonus.stats.endurance;
    }
  });

  if (equipped.rings && Array.isArray(equipped.rings)) {
    equipped.rings.forEach(itemId => {
      if (!itemId) return;
      const item = GAME_ITEMS_DATABASE ? GAME_ITEMS_DATABASE[itemId] : null;
      if (item && item.bonus) {
        if (item.bonus.endurance !== undefined) bonus += item.bonus.endurance;
        if (item.bonus.stats && item.bonus.stats.endurance !== undefined) bonus += item.bonus.stats.endurance;
      }
    });
  }
  return bonus;
}

// 1. Ежесекундное лечение
setInterval(async () => {
  const socketIds = Object.keys(activeOnlinePlayers);
  if (socketIds.length === 0) return;

  socketIds.forEach(sId => {
    const p = activeOnlinePlayers[sId];
    
    // Заморозка в бою
    const isInBattle = Object.keys(global.activeRooms || {}).some(roomId => {
      const room = global.activeRooms[roomId];
      return room.teamA.some(f => String(f.id) === String(p.id)) || 
             room.teamB.some(f => String(f.id) === String(p.id));
    });

    if (isInBattle) return;

    // 🔥 Чистый автономный расчет ХП: (Базовая выносливость + Выносливость шмоток) * 10
    const totalEndurance = Number(p.endurance || 1) + getLocalEnduranceBonus(p.equipped);
    const maxHp = totalEndurance * 10;
    
    if (p.hp < maxHp) {
      const regenAmount = Math.max(1, Math.floor(maxHp * 0.01)); // 1% в секунду
      p.hp = Math.min(maxHp, p.hp + regenAmount);
      p.needsSave = true;

      io.to(sId).emit('town_hp_regen_update', { 
        currentHp: p.hp, 
        maxHp: maxHp 
      });
    }
  });
}, 1000);

// 2. Сброс в Supabase раз в 15 секунд
setInterval(async () => {
  const socketIds = Object.keys(activeOnlinePlayers);
  for (const sId of socketIds) {
    const p = activeOnlinePlayers[sId];
    if (p && p.needsSave) {
      p.needsSave = false;
      try {
        await sb.from('players').update({ hp: Number(p.hp) }).eq('id', Number(p.id));
        console.log(`☁️ [БД РЕГЕНЕРАЦИЯ] Здоровье ${p.name} синхронизировано: ${p.hp} HP.`);
      } catch (err) {
        console.error("🚨 Ошибка сохранения ХП:", err.message);
      }
    }
  }
}, 15000);
io.on('connection', (socket) => {
  console.log(`🔌 Подключен сокет игрока: ${socket.id}`);
   // 1. ТРИГГЕР ВХОДА (Запоминаем игрока в ОЗУ регенерации)
  // Регистрация в тикер регенерации
  socket.on('load_game_secure', async (payload) => {
    try {
      const nUserId = Number(payload?.userId || payload?.id || 0);
      if (!nUserId) return;

      const { data: row } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      if (row) {
        // Защита регистров полей из Supabase
        const dbEndurance = row.endurance ?? row.Endurance ?? row.stats?.endurance ?? 1;
        
        activeOnlinePlayers[socket.id] = {
          id: row.id,
          name: row.name,
          hp: Number(row.hp || 10),
          endurance: Number(dbEndurance),
          equipped: row.equipped || {},
          needsSave: false
        };
        console.log(`✅ [РЕГЕНЕРАЦИЯ] Игрок ${row.name} добавлен в список лечения.`);
      }
    } catch (e) { console.error("🚨 Ошибка тикера:", e.message); }
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