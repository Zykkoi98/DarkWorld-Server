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
app.get('/admin/generate-world', async (req, res) => {
  try {
    const { generateWorld, worldExists } = require('./world/world_generator');
    
    if (!(await worldExists(sb, 'ashenvale_main'))) {
      await generateWorld(sb, 'ashenvale_main', 50, 50);
    }
    if (!(await worldExists(sb, 'dragonhold_main'))) {
      await generateWorld(sb, 'dragonhold_main', 100, 100);
    }
    if (!(await worldExists(sb, 'mine_1'))) {
      await generateWorld(sb, 'mine_1', 20, 20);
    }
    
    res.send('✅ Генерация карт завершена!');
  } catch (err) {
    console.error(err);
    res.status(500).send(`🚨 Ошибка: ${err.message}`);
  }
});

// Глобальная память для активных боевых комнат
let activeRooms = {}; 
global.activeRooms = activeRooms;
global.onlinePlayers = new Map(); 

// ----------------------------------------------------------------------------
// РЕГИСТРАЦИЯ ИГРОКА В ТИКЕРЕ ЛЕЧЕНИЯ
// Вызывается автоматически при connect через handshake, а также по эвентам load_*
// ----------------------------------------------------------------------------
async function registerPlayerForRegen(userId, socketId, sb, io) {
  const nUserId = Number(userId);
  if (!nUserId) return;

  const key = String(nUserId);

  // Если игрок уже зарегистрирован — просто добавляем новый socketId
  if (global.onlinePlayers.has(key)) {
    const existing = global.onlinePlayers.get(key);
    existing.socketIds.add(socketId);
    console.log(`♻️ [РЕГЕН] ${existing.name} уже в очереди (сокетов: ${existing.socketIds.size})`);
    return;
  }

  // Иначе — грузим из БД и регистрируем
  try {
    const { data: row } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
    if (!row) {
      console.log(`⚠️ [РЕГЕН] Игрок ID ${nUserId} не найден в БД, пропускаем регистрацию`);
      return;
    }

    // 🔥 Считаем maxHp правильно — через dbHelper (если доступен) или fallback
    let maxHp = 100;
    if (dbHelper && typeof dbHelper.getServerMaxHp === 'function') {
      maxHp = dbHelper.getServerMaxHp(row);
    } else {
      maxHp = (Number(row.endurance || 1) * 10);
    }

    global.onlinePlayers.set(key, {
      id: nUserId,
      name: row.name,
      hp: Math.min(Number(row.hp || 10), maxHp),
      maxHp: maxHp,
      endurance: Number(row.endurance || 1),
      equipped: row.equipped || {},
      needsSave: false,
      socketIds: new Set([socketId])
    });
    
    console.log(`✅ [РЕГЕН ВХОД] ${row.name} (ID ${nUserId}) добавлен в очередь лечения. HP: ${row.hp}/${maxHp}`);
  } catch (e) {
    console.error("🚨 Ошибка регистрации в регене:", e.message);
  }
}

// ----------------------------------------------------------------------------
// УДАЛЕНИЕ СОКЕТА ИГРОКА (при disconnect)
// ----------------------------------------------------------------------------
function unregisterPlayerSocket(userId, socketId) {
  const key = String(userId);
  if (!global.onlinePlayers.has(key)) return;

  const player = global.onlinePlayers.get(key);
  player.socketIds.delete(socketId);

  // Если у игрока больше нет активных сокетов — сохраняем HP и удаляем
  if (player.socketIds.size === 0) {
    if (player.needsSave && player.id && sb) {
      sb.from('players').update({ hp: Number(player.hp) }).eq('id', Number(player.id))
        .then(() => console.log(`☁️ [РЕГЕН ВЫХОД] ${player.name}: финальное HP ${player.hp} сохранено`))
        .catch(err => console.error("🚨 Ошибка финального сохранения:", err.message));
    }
    global.onlinePlayers.delete(key);
    console.log(`🧹 [РЕГЕН] ${player.name} удалён из очереди (все сокеты закрыты)`);
  } else {
    console.log(`♻️ [РЕГЕН] ${player.name} ещё онлайн на ${player.socketIds.size} сокетах`);
  }
}

// ----------------------------------------------------------------------------
// ТИКЕР РЕГЕНЕРАЦИИ (1% от maxHp в секунду)
// ----------------------------------------------------------------------------
setInterval(() => {
  try {
    if (!global.onlinePlayers || global.onlinePlayers.size === 0) return;

    for (const [userId, player] of global.onlinePlayers.entries()) {
      if (!player || player.hp <= 0) continue;
      if (player.hp >= player.maxHp) continue;

      // Проверяем, не в бою ли игрок (в бою HP не восстанавливается)
      const isInBattle = Object.keys(global.activeRooms || {}).some(roomId => {
        const room = global.activeRooms[roomId];
        if (!room) return false;
        return (room.teamA && room.teamA.some(f => f && String(f.id) === String(userId)))
            || (room.teamB && room.teamB.some(f => f && String(f.id) === String(userId)));
      });

      if (isInBattle) continue;

      // Регенерация 1% от максимума
      const regenAmount = Math.max(1, Math.floor(player.maxHp * 0.01));
      player.hp = Math.min(player.maxHp, player.hp + regenAmount);
      player.needsSave = true;

      // Отправляем всем активным сокетам игрока
      player.socketIds.forEach(sId => {
        io.to(sId).emit('town_hp_regen_update', { 
          currentHp: player.hp, 
          maxHp: player.maxHp 
        });
      });
    }
  } catch (err) {
    console.error("🚨 Сбой тикера регенерации:", err.message);
  }
}, 1000);

// ----------------------------------------------------------------------------
// ФОНОВОЕ СОХРАНЕНИЕ HP В SUPABASE (раз в 15 сек)
// ----------------------------------------------------------------------------
setInterval(async () => {
  try {
    if (!global.onlinePlayers || global.onlinePlayers.size === 0) return;

    for (const [userId, player] of global.onlinePlayers.entries()) {
      if (player.needsSave && player.id) {
        player.needsSave = false;
        await sb.from('players').update({ hp: Number(player.hp) }).eq('id', Number(player.id));
        console.log(`☁️ [БД РЕГЕН] ${player.name}: ${player.hp} HP сохранено`);
      }
    }
  } catch (err) {
    console.error("🚨 Сбой фонового сохранения регена:", err.message);
  }
}, 15000);
io.on('connection', (socket) => {
  console.log(`🔌 Подключен сокет игрока: ${socket.id}`);

  // ============================================================================
  // 🔥 АВТО-РЕГИСТРАЦИЯ В РЕГЕНЕРАЦИИ ЧЕРЕЗ HANDSHAKE
  // ============================================================================
  const handshakeUserId = socket.handshake?.auth?.userId;
  if (handshakeUserId) {
    socket.data = socket.data || {};
    socket.data.userId = Number(handshakeUserId);
    registerPlayerForRegen(handshakeUserId, socket.id, sb, io);
    console.log(`✅ [АВТО-РЕГЕН] Игрок ID ${handshakeUserId} зарегистрирован через handshake`);
  } else {
    console.log(`⚠️ [АВТО-РЕГЕН] Handshake без userId — ждём load_game_secure`);
  }

  // ============================================================================
  // 🔥 УНИВЕРСАЛЬНАЯ РЕГИСТРАЦИЯ ЧЕРЕЗ ЛЮБОЙ load_* ЭВЕНТ (страховка)
  // ============================================================================
  const universalRegister = (payload) => {
    const nUserId = Number(payload?.userId || payload?.id || socket.data?.userId || 0);
    if (nUserId && !socket.data?.registeredUserId) {
      socket.data = socket.data || {};
      socket.data.userId = nUserId;
      socket.data.registeredUserId = true;
      registerPlayerForRegen(nUserId, socket.id, sb, io);
    }
  };

  // Ловим любые события авторизации
  socket.on('load_game_secure', universalRegister);
  socket.on('load_tower_game_secure', universalRegister);
  socket.on('load_shop_game_secure', universalRegister);     // на будущее
  socket.on('load_arena_game_secure', universalRegister);    // на будущее
  socket.on('load_forest_game_secure', universalRegister);   // на будущее
  // 🔥 Просто добавляй новые локации сюда

  // ============================================================================
  // 1. Инициализируем модуль базы данных и античита
  // ============================================================================
  if (dbHelper && typeof dbHelper.init === 'function') {
    dbHelper.init(io, socket, sb);
  } else if (typeof dbHelper === 'function') {
    dbHelper(io, socket, sb);
  }

  // 2. Инициализируем защищенный модуль инвентаря
  if (typeof inventoryLogic === 'function') {
    inventoryLogic(io, socket, sb);
  }

  // 3. Инициализируем боевой движок
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

  // ============================================================================
  // 🔥 DISCONNECT: убираем игрока из регена + чистим боевые комнаты
  // ============================================================================
  socket.on('disconnect', () => {
    // 1. Убираем из регенерации
    const userId = socket.data?.userId;
    if (userId) {
      unregisterPlayerSocket(userId, socket.id);
    }

    // 2. Отвязываем от боевых комнат
    Object.keys(activeRooms).forEach(roomId => {
      const room = activeRooms[roomId];
      if (room && room.teamA) {
        const fighter = [...room.teamA, ...room.teamB].find(f => f && f.socketId === socket.id);
        if (fighter) {
          fighter.socketId = null;
          fighter.disconnectedAt = Date.now();
        }
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