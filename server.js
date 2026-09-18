// ============================================================================
// ===== ☁️ ЧАСТЬ 1: ИНИЦИАЛИЗАЦИЯ СЕРВЕРА И ХАРАКТЕРИСТИК ЭКИПИРОВКИ =====
// ============================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
app.get('/', (req, res) => res.send('⚔️ Защищенный боевой сервер Dark World активен!'));

const server = http.createServer(app);
// 🔥 ИСПРАВЛЕННЫЙ БЛОК ИНИЦИАЛИЗАЦИИ СОКЕТОВ С ПОЛНЫМ КАНАЛОМ CORS
const io = new Server(server, { 
  cors: { 
    // Разрешаем запросы со всех твоих адресов разработки и продакшена
    origin: [
      "https://zykkoi98.github.io", 
      "https://github.io", // Вариант с закрывающим слэшем
      "http://localhost:3000",
      "http://127.0.0.1:5500" // Локальный сервер VS Code Live Server на случай тестов
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["my-custom-header"],
    credentials: true // Важный флаг для правильного прохождения авторизации сокетов
  } 
});

// 🔥 БЕЗОПАСНОСТЬ: Ключи скрыты в переменные окружения process.env хостинга Render
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Глобальная оперативная память бэкенда для активных комнат
let activeRooms = {}; 

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
const ZONE_NAMES = { head: "Голову", breast: "Грудь", torso: "Торс", belt: "Пояс", legs: "Ноги" };
const CONSUMABLE_DATABASE = {
  'hp_potion_small': { name: 'Малое зелье HP', heal: 25 },
  'hp_potion_big':   { name: 'Большое зелье HP', heal: 60 },
  'fish_soup':       { name: 'Уха из таверны', heal: 40 }
};

// --- СЕРВЕРНАЯ БАЗА ДАННЫХ ПРЕДМЕТОВ ДЛЯ ЧЕСТНОГО РАСЧЕТА БОЯ ---
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

// Вспомогательная функция для сбора бонусов со всей куклы персонажа
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

// 🔥 СИНХРОНИЗАЦИЯ: Расчет боевых параметров строго с учетом надетых вещей!
function getServerAtk(fighter) {
  const baseStrength = Number(fighter.strength || 1);
  const gearStrength = getEquipmentBonus(fighter.equipped, 'strength');
  const totalStrength = baseStrength + gearStrength;
  
  const baseAtk = Math.floor(2 + (totalStrength * 1.5));
  const weaponAtk = getEquipmentBonus(fighter.equipped, 'atk');
  return baseAtk + weaponAtk;
}

function getServerDef(fighter) {
  const baseEndurance = Number(fighter.endurance || 1);
  const gearEndurance = getEquipmentBonus(fighter.equipped, 'endurance');
  const totalEndurance = baseEndurance + gearEndurance;

  const baseDef = Math.floor(totalEndurance * 0.5);
  const armorDef = getEquipmentBonus(fighter.equipped, 'def');
  return baseDef + armorDef;
}

function getServerMaxHp(fighter) {
  const baseEndurance = Number(fighter.endurance || 1);
  const gearEndurance = getEquipmentBonus(fighter.equipped, 'endurance');
  const totalEndurance = baseEndurance + gearEndurance;

  const armorHp = getEquipmentBonus(fighter.equipped, 'hp');
  return (totalEndurance * 10) + armorHp;
}

function getServerAgility(fighter) {
  const baseAgility = Number(fighter.agility || 1);
  const gearAgility = getEquipmentBonus(fighter.equipped, 'agility');
  return baseAgility + gearAgility;
}

function getServerLuck(fighter) {
  const baseLuck = Number(fighter.luck || 1);
  const gearLuck = getEquipmentBonus(fighter.equipped, 'luck');
  return baseLuck + gearLuck;
}

function sanitizeTeam(team) {
  return team.map(f => ({
    uuid: f.uuid, name: f.name, icon: f.icon, level: f.level,
    currentHp: f.currentHp, maxHp: f.maxHp, isBot: f.isBot,
    hasSubmitted: !!f.turn, equipped: f.equipped || null 
  }));
}
// ============================================================================
// ===== ☁️ ЧАСТЬ 2: СЕТЕВЫЕ ОБРАБОТЧИКИ ПРОФИЛЕЙ И ЛОББИ АРЕНЫ =====
// ============================================================================

io.on('connection', (socket) => {
  console.log(`🔌 Подключен сокет: ${socket.id}`);

  // ============================================================================
  // 🛡️ 1. БЕЗОПАСНАЯ СИНХРОНИЗАЦИЯ ПРОФИЛЯ (БЕЗ API-КЛЮЧЕЙ НА КЛИЕНТЕ)
  // ============================================================================
  
  socket.on('load_game_secure', async ({ userId, username }) => {
    try {
      const nUserId = Number(userId);
      console.log(`🔍 Бэкенд запрашивает БД для игрока ID: ${nUserId}`);

      const { data, error } = await sb.from('players').select('*').eq('id', nUserId);
      if (error) return socket.emit('load_game_failed', { message: error.message });

      if (data && data.length > 0) {
        const cloudPlayer = data[0];
        const playerProfile = {
          id: cloudPlayer.id,
          name: cloudPlayer.name,
          avatar: cloudPlayer.avatar,
          level: Number(cloudPlayer.level || 1),
          gold: Number(cloudPlayer.gold || 0),
          xp: Number(cloudPlayer.xp || 0),
          hp: Number(cloudPlayer.hp || 10),
          statPoints: Number(cloudPlayer.statpoints || 0),
          currentTownIndex: Number(cloudPlayer.currenttownindex || 0),
          stats: {
            strength: Number(cloudPlayer.strength ?? 1),
            agility: Number(cloudPlayer.agility ?? 1),
            endurance: Number(cloudPlayer.endurance ?? 1),
            intellect: Number(cloudPlayer.intellect ?? 1),
            luck: Number(cloudPlayer.luck ?? 1)
          },
          inventory: cloudPlayer.inventory || { equipment: [], resources: [], consumables: [] },
          equipped: cloudPlayer.equipped || { rings: [null, null, null] }
        };
        socket.emit('load_game_success', { player: playerProfile });
      } else {
        socket.emit('player_not_found', { userId, username });
      }
    } catch (err) {
      socket.emit('load_game_failed', { message: err.message });
    }
  });

// ============================================================================
// 🛡️ ИСПРАВЛЕННОЕ БЕЗОПАСНОЕ СОХРАНЕНИЕ МИРНЫХ ДАННЫХ
// ============================================================================
socket.on('save_game_secure', async ({ player }) => {
  if (!player || !player.id) return;
  
  const nUserId = Number(player.id);

  try {
    // 🔥 Защита: Сначала запрашиваем актуальные критические данные из БД, которым мы верим
    const { data: dbPlayer, error: fetchErr } = await sb
      .from('players')
      .select('gold, xp, level, hp, strength, agility, endurance, intellect, luck, statpoints')
      .eq('id', nUserId)
      .maybeSingle();

    if (fetchErr || !dbPlayer) {
      console.error(`[SAVE ANOMALY] Игрок ${nUserId} не найден при попытке сохранения.`);
      return;
    }

    // Собираем пакет для записи: критические статы берем ИЗ БАЗЫ, а рюкзак/куклу — от клиента
    const payload = {
      id: nUserId,
      name: player.name,
      avatar: player.avatar || "assets/avatars/hero1.png",
      currenttownindex: Number(player.currentTownIndex ?? 0),
      
      // Данные инвентаря клиент отправлять может (сортировка, перекладывание)
      inventory: player.inventory,
      equipped: player.equipped,

      // 🛑 ЖЕСТКИЙ ИГНОР КЛИЕНТСКИХ НАКРУТОК: берем строго серверные значения из БД
      gold: Number(dbPlayer.gold),
      xp: Number(dbPlayer.xp),
      level: Number(dbPlayer.level),
      hp: Number(dbPlayer.hp),
      strength: Number(dbPlayer.strength),
      agility: Number(dbPlayer.agility),
      endurance: Number(dbPlayer.endurance),
      intellect: Number(dbPlayer.intellect),
      luck: Number(dbPlayer.luck),
      statpoints: Number(dbPlayer.statpoints)
    };

    const { error: upsertErr } = await sb.from('players').upsert(payload);
    if (!upsertErr) {
      socket.emit('save_game_success_confirmed');
    }
  } catch (e) {
    console.error("❌ Сбой безопасного сохранения на сервере:", e);
  }
});

// ============================================================================
// 🛡️ НОВЫЙ ОБРАБОТЧИК: БЕЗОПАСНАЯ ПРОКАЧКА ХАРАКТЕРИСТИК НА СЕРВЕРЕ
// ============================================================================
socket.on('upgrade_stat_secure', async ({ userId, statName }) => {
  try {
    const nUserId = Number(userId);
    const validStats = ['strength', 'agility', 'endurance', 'intellect', 'luck'];
    
    if (!validStats.includes(statName)) {
      return socket.emit('error', 'Неверное название характеристики.');
    }

    // 1. Берем данные игрока напрямую из базы
    const { data: dbPlayer, error: fetchErr } = await sb
      .from('players')
      .select('*')
      .eq('id', nUserId)
      .maybeSingle();

    if (fetchErr || !dbPlayer) return socket.emit('error', 'Персонаж не найден.');

    // 2. Проверяем, есть ли вообще доступные очки характеристик
    const currentPoints = Number(dbPlayer.statpoints || 0);
    if (currentPoints <= 0) {
      return socket.emit('error', 'У вас нет свободных очков характеристик!');
    }

    // 3. Рассчитываем новые значения характеристик
    const updatedStats = {
      strength: Number(dbPlayer.strength ?? 1),
      agility: Number(dbPlayer.agility ?? 1),
      endurance: Number(dbPlayer.endurance ?? 1),
      intellect: Number(dbPlayer.intellect ?? 1),
      luck: Number(dbPlayer.luck ?? 1)
    };

    // Добавляем стат и списываем одно очко
    updatedStats[statName]++;
    const newStatPoints = currentPoints - 1;

    // Особая логика для выносливости (увеличение ХП)
    let newHp = Number(dbPlayer.hp);
    if (statName === 'endurance') {
      newHp += 10; 
    }

    // 4. Записываем строго обновленные параметры обратно в Supabase
    const { error: updateErr } = await sb
      .from('players')
      .update({
        strength: updatedStats.strength,
        agility: updatedStats.agility,
        endurance: updatedStats.endurance,
        intellect: updatedStats.intellect,
        luck: updatedStats.luck,
        statpoints: newStatPoints,
        hp: newHp
      })
      .eq('id', nUserId);

    if (updateErr) return socket.emit('error', 'Не удалось обновить характеристики в БД.');

    // 5. Отправляем клиенту команду «Перезагрузи профиль с актуальными статами из облака»
    // Для этого просто вызываем уже готовую у тебя процедуру успешной загрузки
    const refreshedPlayerProfile = {
      id: dbPlayer.id,
      name: dbPlayer.name,
      avatar: dbPlayer.avatar,
      level: Number(dbPlayer.level || 1),
      gold: Number(dbPlayer.gold || 0),
      xp: Number(dbPlayer.xp || 0),
      hp: newHp,
      statPoints: newStatPoints,
      currentTownIndex: Number(dbPlayer.currenttownindex || 0),
      stats: updatedStats,
      inventory: dbPlayer.inventory || { equipment: [], resources: [], consumables: [] },
      equipped: dbPlayer.equipped || { rings: [null, null, null] }
    };

    socket.emit('load_game_success', { player: refreshedPlayerProfile });

  } catch (err) {
    console.error("❌ Ошибка прокачки стата на бэкенде:", err);
    socket.emit('error', 'Внутренняя ошибка сервера при прокачке.');
  }
});

  // ============================================================================
  // 🏆 2. УПРАВЛЕНИЕ ЛОББИ АРЕНЫ ЧЕРЕЗ БЭКЕНД
  // ============================================================================

  socket.on('arena_get_lobby', async () => {
    try {
      const nowISO = new Date().toISOString();
      const { data, error } = await sb.from('arena_lobby').select('*').gt('arena_expires_at', nowISO);
      if (!error && data) socket.emit('arena_lobby_data', data);
    } catch (e) { console.error(e); }
  });

  socket.on('arena_create_request', async ({ playerData, currentHp }) => {
    try {
      const expiresAt = new Date(Date.now() + 180000).toISOString(); // 3 минуты
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

  socket.on('arena_cancel_request', async ({ userId }) => {
    try {
      const { error } = await sb.from('arena_lobby').delete().eq('id', Number(userId));
      if (!error) io.emit('arena_lobby_updated');
    } catch (e) { console.error(e); }
  });

  socket.on('arena_accept_challenge_request', async ({ myId, opponentId, playerData, currentHp }) => {
    try {
      // Атомарный перехват: кто первый удалил из базы, тот и забрал вызов
      const { data, error } = await sb.from('arena_lobby').delete().eq('id', Number(opponentId)).select();
      
      if (error || !data || data.length === 0) {
        return socket.emit('error', 'Вызов уже принят другим гладиатором!');
      }

      // Создаем уникальную PvP комнату
      const roomId = `room_pvp_${opponentId}_vs_${myId}_${Date.now()}`;
      
      // Запрашиваем из базы профиль оппонента для сборки комнаты
      const { data: oppData } = await sb.from('players').select('*').eq('id', Number(opponentId)).single();
      if (!oppData) return socket.emit('error', 'Ошибка загрузки профиля оппонента.');

      // Логика инициализации PvP будет вызвана в Части 3
      initiatePvpMatch(roomId, playerData, currentHp, oppData);
    } catch (e) { console.error(e); }
  });

  // ============================================================================
  // ⚔️ 3. СИСТЕМНЫЕ ПЕРЕХВАТЧИКИ И РЕКОННЕКТЫ БОЯ
  // ============================================================================

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
  // ============================================================================
// ===== 🌲 ЧАСТЬ 3.1: ЗАПУСК PvE МАТЧЕЙ И МГНОВЕННЫЕ ДЕЙСТВИЯ =====
// ============================================================================

  socket.on('search_pve_match', async ({ playerData, monsterKey, count }) => {
    try {
      const sPlayerId = String(playerData.id);

      // Проверка на дубликат боя в ОЗУ сервера
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
      const { data: dbPlayer } = await sb.from('players').select('*').eq('id', Number(playerData.id)).single();

      if (!dbMonster || !dbPlayer) return socket.emit('error', 'Ошибка инициализации данных PvE.');

      const roomId = `room_pve_${dbPlayer.id}_${Date.now()}`;
      
      const pMaxHp = getServerMaxHp(dbPlayer);
      const teamA = [{
        uuid: `player_${dbPlayer.id}`, id: String(dbPlayer.id), name: dbPlayer.name, icon: '👤', isBot: false,
        level: Number(dbPlayer.level), strength: Number(dbPlayer.strength), agility: Number(dbPlayer.agility),
        endurance: Number(dbPlayer.endurance), intellect: Number(dbPlayer.intellect), luck: Number(dbPlayer.luck),
        currentHp: Math.min(Number(dbPlayer.hp), pMaxHp), maxHp: pMaxHp, socketId: socket.id, turn: null,
        gold: Number(dbPlayer.gold), xp: Number(dbPlayer.xp), statpoints: Number(dbPlayer.statpoints),
        equipped: dbPlayer.equipped || {}, inventory: dbPlayer.inventory || {}
      }];

      const teamB = [];
      const mMaxHp = getServerMaxHp(dbMonster);
      for (let i = 0; i < monsterCount; i++) {
        teamB.push({
          uuid: `bot_${dbMonster.id}_${i}_${Date.now()}`, id: dbMonster.id,
          name: monsterCount > 1 ? `${dbMonster.name} #${i + 1}` : dbMonster.name, icon: dbMonster.icon,
          isBot: true, level: Number(dbMonster.level), strength: Number(dbMonster.strength),
          agility: Number(dbMonster.agility), endurance: Number(dbMonster.endurance),
          intellect: Number(dbMonster.intellect), luck: Number(dbMonster.luck),
          currentHp: mMaxHp, maxHp: mMaxHp, rewardXp: Number(dbMonster.reward_xp),
          rewardGold: Number(dbMonster.reward_gold), lootTable: dbMonster.loot_table || [], turn: null
        });
      }

      activeRooms[roomId] = { id: roomId, type: 'pve', teamA, teamB, turnCount: 1, timeoutRef: null };
      socket.join(roomId);
      
      socket.emit('battle_init_data', {
        roomId, turnCount: 1, myUuid: `player_${dbPlayer.id}`,
        teamA: sanitizeTeam(teamA), teamB: sanitizeTeam(teamB)
      });

      startServerTurnTimer(roomId);
    } catch (err) {
      socket.emit('error', `Внутренняя ошибка: ${err.message}`);
    }
  });

  socket.on('submit_turn', ({ roomId, targetUuid, attack, defends }) => {
    const room = activeRooms[roomId];
    if (!room) return;

    const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
    if (!fighter || fighter.currentHp <= 0 || fighter.turn) return;

    fighter.turn = { targetUuid, attack, defends: defends || [] };

    const awaitingPlayers = room.teamA.filter(p => !p.isBot && p.currentHp > 0 && !p.turn);
    if (awaitingPlayers.length === 0) {
      clearTimeout(room.timeoutRef);
      executeRoundCalculations(roomId);
    }
  });

  socket.on('instant_use_potion', ({ roomId }) => {
    const room = activeRooms[roomId];
    if (!room) return;

    const fighter = room.teamA.find(p => p.socketId === socket.id);
    if (!fighter || fighter.currentHp <= 0) return;

    const potionId = fighter.equipped?.potion;
    const potionData = CONSUMABLE_DATABASE[potionId];

    if (potionData) {
      fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + potionData.heal);
      if (fighter.equipped) fighter.equipped.potion = null;

      io.to(roomId).emit('battle_effect_potion', {
        uuid: fighter.uuid, currentHp: fighter.currentHp,
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
// ============================================================================
// ===== ⚔️ ЧАСТЬ 3.2: ДВИЖОК РАУНДОВ, PvP И СОХРАНЕНИЕ НАГРАД =====
// ============================================================================

// Инициализатор защищенной PvP-комнаты между двумя игроками
function initiatePvpMatch(roomId, p1Data, p1Hp, p2Data) {
  const p1MaxHp = getServerMaxHp(p1Data);
  const p2MaxHp = getServerMaxHp(p2Data);

  const teamA = [{
    uuid: `player_${p1Data.id}`, id: String(p1Data.id), name: p1Data.name, icon: '👤', isBot: false,
    level: Number(p1Data.level), strength: Number(p1Data.stats.strength), agility: Number(p1Data.stats.agility),
    endurance: Number(p1Data.stats.endurance), intellect: Number(p1Data.stats.intellect), luck: Number(p1Data.stats.luck),
    currentHp: Math.min(Number(p1Hp), p1MaxHp), maxHp: p1MaxHp, socketId: null, turn: null,
    equipped: p1Data.equipped, inventory: p1Data.inventory
  }];

  const teamB = [{
    uuid: `player_${p2Data.id}`, id: String(p2Data.id), name: p2Data.name, icon: '👤', isBot: false,
    level: Number(p2Data.level), strength: Number(p2Data.strength), agility: Number(p2Data.agility),
    endurance: Number(p2Data.endurance), intellect: Number(p2Data.intellect), luck: Number(p2Data.luck),
    currentHp: Number(p2Data.hp), maxHp: p2MaxHp, socketId: null, turn: null,
    equipped: p2Data.equipped, inventory: p2Data.inventory
  }];

  activeRooms[roomId] = { id: roomId, type: 'pvp', teamA, teamB, turnCount: 1, timeoutRef: null };
  io.emit('arena_lobby_updated');
}

function startServerTurnTimer(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;
  if (room.timeoutRef) clearTimeout(room.timeoutRef);

  room.timeoutRef = setTimeout(() => {
    if (!activeRooms[roomId]) return;
    room.teamA.forEach(f => {
      if (!f.isBot && !f.turn && f.currentHp > 0) {
        const aliveEnemies = room.teamB.filter(e => e.currentHp > 0);
        f.turn = { targetUuid: aliveEnemies.length > 0 ? aliveEnemies[0].uuid : null, attack: null, defends: [] };
      }
    });
    executeRoundCalculations(roomId);
  }, 30000);
}

// ============================================================================
// 📊 СЕРВЕРНЫЙ КАЛЬКУЛЯТОР БОЕВЫХ РАУНДОВ ПО СКОРОСТИ
// ============================================================================
function executeRoundCalculations(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;

  const logs = [];
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // ИИ для монстров
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

  // Очередь ходов по динамической ловкости персонажей
  let queue = [...room.teamA, ...room.teamB];
  queue.sort((a, b) => getServerAgility(b) - getServerAgility(a));

  queue.forEach(attacker => {
    if (attacker.currentHp <= 0 || !attacker.turn || !attacker.turn.targetUuid) return;

    let target = [...room.teamA, ...room.teamB].find(f => f.uuid === attacker.turn.targetUuid);
    if (!target || target.currentHp <= 0) {
      const opposingTeam = room.teamA.includes(attacker) ? room.teamB : room.teamA;
      const newAlive = opposingTeam.filter(t => t.currentHp > 0);
      if (newAlive.length === 0) return;
      target = newAlive[0];
    }

    if (attacker.turn.attack === null) {
      logs.push(`❌ <strong>${attacker.name}</strong> пропустил атаку.`);
      return;
    }

    if (target.turn && target.turn.defends.includes(attacker.turn.attack)) {
      logs.push(`🛡️ <strong>${target.name}</strong> заблокировал удар от <strong>${attacker.name}</strong> в ${ZONE_NAMES[attacker.turn.attack]}.`);
    } else {
      const attLuck = getServerLuck(attacker);
      const critChance = Math.min(50, 5 + (attLuck * 0.5));
      const isCrit = rand(1, 100) <= critChance;
      
      let baseDmg = getServerAtk(attacker);
      if (isCrit) baseDmg = Math.floor(baseDmg * 1.5);

      const targetDef = getServerDef(target);
      const dmg = Math.max(1, baseDmg - targetDef);

      target.currentHp = Math.max(0, target.currentHp - dmg);
      logs.push(`⚔️ <strong>${attacker.name}</strong> ударил <strong>${target.name}</strong> на <strong>${dmg}</strong> урона в ${ZONE_NAMES[attacker.turn.attack]} ${isCrit ? '💥 КРИТ!' : ''}`);
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
    if (!isTeamADead && isTeamBDead) result = 'win';
    if (isTeamADead && !isTeamBDead) result = 'lose';

    if (room.type === 'pve') finalizePveBattle(room, result, logs, currentRound);
  } else {
    room.teamA.forEach(p => {
      if (p.socketId) io.to(p.socketId).emit('round_result', { turnCount: currentRound, logs, isOver: false, teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB) });
    });
    startServerTurnTimer(roomId);
  }
}

// Расчет наград за победу и сохранение прогресса в Supabase
async function finalizePveBattle(room, result, logs, finalRound) {
  const player = room.teamA[0];
  if (!player) return delete activeRooms[room.id];

  let gainedXp = 0; let gainedGold = 0;

  if (result === 'win') {
    room.teamB.forEach(monster => {
      gainedXp += monster.rewardXp || 0;
      gainedGold += monster.rewardGold || 0;
    });

    player.gold += gainedGold;
    player.xp += gainedXp;
    
    logs.push(`🏁 <strong>ПОБЕДА!</strong> Награда: 💰 ${gainedGold} монет, ✨ ${gainedXp} опыта.`);
  } else {
    logs.push(`🏁 <strong>ВАС ОДОЛЕЛИ...</strong> Воскрешение в городе.`);
    player.currentHp = Math.max(1, Math.floor(player.maxHp * 0.2));
  }

  if (player.socketId) {
    io.to(player.socketId).emit('round_result', { turnCount: finalRound, logs, isOver: true, resultType: result, teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB) });
  }

  try {
    await sb.from('players').update({ gold: player.gold, xp: player.xp, hp: player.currentHp, level: player.level, statpoints: player.statpoints, inventory: player.inventory }).eq('id', Number(player.id));
  } catch (err) { console.error(err); }
  
  delete activeRooms[room.id];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Боевой сервер успешно запущен на порту ${PORT}`));