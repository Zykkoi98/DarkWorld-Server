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
// Серверный расчет правильного уровня на основе текущего опыта
function getServerCorrectLevelByXp(xp) {
  // Идем с конца таблицы опыта к началу
  for (let lvl = SERVER_XP_TABLE.length - 1; lvl >= 1; lvl--) {
    if (xp >= SERVER_XP_TABLE[lvl]) {
      return lvl; 
    }
  }
  return 1;
}
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
  // 🛡️ ЗАЩИЩЕННАЯ ЗАГРУЗКА И ТОТАЛЬНЫЙ АУДИТ ПРОФИЛЯ ПРИ ВХОДЕ (АНТИЧИТ)
  // ============================================================================
  socket.on('load_game_secure', async ({ userId, username }) => {
    try {
      const nUserId = Number(userId);
      console.log(`\n🔍 [АУДИТ ВХОДА] Игрок ID: ${nUserId} (${username}) подключается. Начинаем проверку...`);

      const { data, error } = await sb.from('players').select('*').eq('id', nUserId);
      if (error) return socket.emit('load_game_failed', { message: error.message });

      if (data && data.length > 0) {
        let cloudPlayer = data[0]; 
        
        // 1. Вычисляем эталонный уровень строго по серверной таблице опыта
        const currentXp = Number(cloudPlayer.xp ?? cloudPlayer.XP ?? 0);
        const correctLevel = getServerCorrectLevelByXp(currentXp);
        const dbLevel = Number(cloudPlayer.level ?? cloudPlayer.Level ?? 1);

        // 2. Собираем и проверяем текущие характеристики из базы данных
        const getDBStat = (key) => {
          return Number(
            cloudPlayer[key] ?? 
            cloudPlayer[key.toLowerCase()] ?? 
            cloudPlayer[key.toUpperCase()] ?? 
            cloudPlayer[key.charAt(0).toUpperCase() + key.slice(1)] ?? 1
          );
        };

        const str = getDBStat('strength');
        const agi = getDBStat('agility');
        const end = getDBStat('endurance');
        const int = getDBStat('intellect');
        const lck = getDBStat('luck');
        
        let pointsKey = cloudPlayer.statpoints !== undefined ? 'statpoints' : (cloudPlayer.statPoints !== undefined ? 'statPoints' : 'statpoints');
        const freePoints = Number(cloudPlayer[pointsKey] ?? 0);

        const totalFighterPoints = str + agi + end + int + lck + freePoints;
        
        // Формула легального максимума: 5 базовых статов (по 1 на каждый) + 5 очков 1-го уровня + по 5 за левел-апы
        const maxLegalPoints = 5 + 5 + ((correctLevel - 1) * 5);

        console.log(`📊 [СТАТИСТИКА ИЗ БД] Уровень в БД: ${dbLevel} | Реальный по XP: ${correctLevel}`);
        console.log(`📊 [СТАТИСТИКА ИЗ БД] Сумма характеристик игрока + свободные очки: ${totalFighterPoints} (Макс. легально: ${maxLegalPoints})`);

        let needsDbSync = false;
        let updatePayload = {};

        // 3. АНТИЧИТ-ФИЛЬТР А: Проверка накрутки очков характеристик или несоответствия уровня
        if (dbLevel !== correctLevel || totalFighterPoints > maxLegalPoints) {
          
          if (dbLevel !== correctLevel) {
            console.log(`🚨 [АНАЛИЗ] Обнаружено расхождение уровней! БД: ${dbLevel}, Должен быть: ${correctLevel}`);
          }
          if (totalFighterPoints > maxLegalPoints) {
            console.log(`🚨 [АНТИЧИТ ЗАФИКСИРОВАЛ ЧИТ] Превышен тотальный лимит очков навыков! Найдено: ${totalFighterPoints}, Лимит: ${maxLegalPoints}`);
          }
          
          console.log(`🔄 [РЕШЕНИЕ] Запускаем принудительный безопасный сброс характеристик на базу 1...`);

          let levelKey = cloudPlayer.level !== undefined ? 'level' : (cloudPlayer.Level !== undefined ? 'Level' : 'level');
          
          // Жестко сбрасываем все 5 характеристик обратно на стартовую единицу
          const statsKeys = ['strength', 'agility', 'endurance', 'intellect', 'luck'];
          statsKeys.forEach(key => {
            let finalKey = key;
            if (cloudPlayer[key] !== undefined) finalKey = key;
            else if (cloudPlayer[key.toLowerCase()] !== undefined) finalKey = key.toLowerCase();
            else if (cloudPlayer[key.toUpperCase()] !== undefined) finalKey = key.toUpperCase();
            else finalKey = key.charAt(0).toUpperCase() + key.slice(1);
            
            updatePayload[finalKey] = 1;
          });

          // Возвращаем игроку честный максимум свободных очков для его реального уровня
          updatePayload[levelKey] = correctLevel;
          updatePayload[pointsKey] = maxLegalPoints - 5; // Вычитаем 5 очков, которые ушли на базу (1+1+1+1+1)
          
          // Полностью восстанавливаем здоровье до новой нормы базовой выносливости
          let hpKey = cloudPlayer.hp !== undefined ? 'hp' : (cloudPlayer.HP !== undefined ? 'HP' : 'hp');
          const freshMaxHp = getServerMaxHp({
            strength: 1, agility: 1, endurance: 1, intellect: 1, luck: 1,
            equipped: cloudPlayer.equipped || {}
          });
          updatePayload[hpKey] = freshMaxHp;

          needsDbSync = true;
        }

        // 4. Если профиль был поврежден или накручен, обновляем БД и перечитываем строку
        if (needsDbSync) {
          console.log(`📤 Записываем восстановленный легальный профиль в Supabase...`);
          const { error: syncErr } = await sb.from('players').update(updatePayload).eq('id', nUserId);
          
          if (!syncErr) {
            const { data: freshData } = await sb.from('players').select('*').eq('id', nUserId);
            if (freshData && freshData.length > 0) {
              cloudPlayer = freshData[0];
              console.log("🎯 [АУДИТ ЗАВЕРШЕН] Профиль успешно очищен, восстановлен и загружен в ОЗУ сервера.");
            }
          } else {
            console.error("❌ Критическая ошибка Supabase при попытке лечения статов:", syncErr);
          }
        } else {
          console.log("✅ [АУДИТ ЗАВЕРШЕН] Профиль чист. Характеристики полностью соответствуют правилам игры.");
        }

        // Формируем чистый объект для отправки на игровой клиент
        const playerProfile = {
          id: cloudPlayer.id,
          name: cloudPlayer.name,
          avatar: cloudPlayer.avatar,
          level: Number(cloudPlayer.level ?? cloudPlayer.Level ?? 1),
          gold: Number(cloudPlayer.gold ?? 0),
          xp: Number(cloudPlayer.xp ?? 0),
          hp: Number(cloudPlayer.hp ?? cloudPlayer.HP ?? 10),
          statPoints: Number(cloudPlayer[pointsKey] ?? 0),
          currentTownIndex: Number(cloudPlayer.currenttownindex ?? 0),
          stats: {
            strength: getDBStat('strength'),
            agility: getDBStat('agility'),
            endurance: getDBStat('endurance'),
            intellect: getDBStat('intellect'),
            luck: getDBStat('luck')
          },
          inventory: cloudPlayer.inventory || { equipment: [], resources: [], consumables: [] },
          equipped: cloudPlayer.equipped || { rings: [null, null, null] }
        };
        
        socket.emit('load_game_success', { player: playerProfile });
      } else {
        console.log(`🆕 Новый игрок! Запись в очереди создания персонажа...`);
        socket.emit('player_not_found', { userId, username });
      }
    } catch (err) {
      console.error("❌ Критическая ошибка в модуле загрузки игры:", err);
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
  // 🛡️ АНТИЧИТ-ОБРАБОТЧИК: БЕЗОПАСНОЕ РАСПРЕДЕЛЕНИЕ ХАРАКТЕРИСТИК ИЗ БУФЕРА
  // ============================================================================
  socket.on('confirm_stat_distribution_secure', async ({ userId, distribution }) => {
    console.log(`📥 [СТАРТ РАСПРЕДЕЛЕНИЯ] Игрок: ${userId}, Буфер:`, distribution);
    try {
      const nUserId = Number(userId);
      if (!distribution) return socket.emit('stat_distribution_error', 'Данные распределения пусты.');

      // 1. Запрашиваем эталонную строку игрока напрямую из базы данных Supabase
      const { data: dbPlayer, error: fetchErr } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      if (fetchErr || !dbPlayer) return socket.emit('stat_distribution_error', 'Персонаж не найден в БД.');

      // Вычисляем точные регистры колонок в твоей Supabase
      const getDBStat = (key) => {
        return Number(
          dbPlayer[key] ?? 
          dbPlayer[key.toLowerCase()] ?? 
          dbPlayer[key.toUpperCase()] ?? 
          dbPlayer[key.charAt(0).toUpperCase() + key.slice(1)] ?? 1
        );
      };

      const currentXp = Number(dbPlayer.xp ?? dbPlayer.XP ?? 0);
      const cloudLevel = getServerCorrectLevelByXp(currentXp); // Реальный уровень по опыту

      // 2. Считаем, сколько очков игрок ХОЧЕТ распределить сейчас из буфера
      let totalSpentNow = 0;
      const statsKeys = ['strength', 'agility', 'endurance', 'intellect', 'luck'];
      for (const key of statsKeys) {
        const spent = Number(distribution[key] || 0);
        if (spent < 0) return socket.emit('stat_distribution_error', '🚨 Обнаружено отрицательное значение стата!');
        totalSpentNow += spent;
      }

      if (totalSpentNow === 0) return socket.emit('stat_distribution_error', 'Вы не выбрали ни одной характеристики для прокачки.');

      // 3. 🔥 ГЛАВНЫЙ АНТИЧИТ: Проверка тотального лимита очков (Сумма статов в БД + Буфер кликов)
      const currentDbStrength = getDBStat('strength');
      const currentDbAgility = getDBStat('agility');
      const currentDbEndurance = getDBStat('endurance');
      const currentDbIntellect = getDBStat('intellect');
      const currentDbLuck = getDBStat('luck');

      // Суммируем статы, которые УЖЕ лежат в базе данных
      const totalDbStatsSum = currentDbStrength + currentDbAgility + currentDbEndurance + currentDbIntellect + currentDbLuck;
      
      // Читаем остаток свободных очков в базе данных
      let finalPointsKey = dbPlayer.statpoints !== undefined ? 'statpoints' : (dbPlayer.statPoints !== undefined ? 'statPoints' : 'statpoints');
      const currentDbFreePoints = Number(dbPlayer[finalPointsKey] || 0);

      // Математический лимит уровня: 5 базовых статов + 5 очков 1-го уровня + по 5 за каждый левел выше
      const maxLegalTotalPoints = 5 + 5 + ((cloudLevel - 1) * 5);

      // Проверяем: База статов + То, что тратим сейчас + То, что останется свободным
      const projectedTotal = totalDbStatsSum + totalSpentNow + (currentDbFreePoints - totalSpentNow);

      console.log(`🛡️ [АНТИЧИТ АУДИТ] Уровень: ${cloudLevel} | Легальный Лимит: ${maxLegalTotalPoints} | Итого в сумме у игрока: ${projectedTotal}`);

      if (projectedTotal > maxLegalTotalPoints) {
        console.error(`🚨 ЧИТЕРСТВО ИЛИ БАГ СЕССИИ! Игрок ${nUserId} превысил лимит очков! Лимит: ${maxLegalTotalPoints}, Попытка: ${projectedTotal}`);
        return socket.emit('stat_distribution_error', `🚨 Ошибка безопасности: Превышена норма очков характеристик для ${cloudLevel} уровня! Распределение заблокировано.`);
      }

      if (totalSpentNow > currentDbFreePoints) {
        return socket.emit('stat_distribution_error', `Недостаточно свободных очков навыков. Доступно в базе: ${currentDbFreePoints}`);
      }

      // 4. ФОРМИРУЕМ ПАКЕТ ОБНОВЛЕНИЯ (Все проверки пройдены успешно)
      const updatePayload = {
        [finalPointsKey]: currentDbFreePoints - totalSpentNow
      };

      // Накатываем новые характеристики поверх старых из БД
      statsKeys.forEach(key => {
        let finalKey = key;
        if (dbPlayer[key] !== undefined) finalKey = key;
        else if (dbPlayer[key.toLowerCase()] !== undefined) finalKey = key.toLowerCase();
        else if (dbPlayer[key.toUpperCase()] !== undefined) finalKey = key.toUpperCase();
        else if (dbPlayer[key.charAt(0).toUpperCase() + key.slice(1)] !== undefined) finalKey = key.charAt(0).toUpperCase() + key.slice(1);
        
        updatePayload[finalKey] = getDBStat(key) + (Number(distribution[key]) || 0);
      });

      // Пересчитываем здоровье на случай, если качалась Выносливость
      const addedEnd = Number(distribution.endurance) || 0;
      if (addedEnd > 0) {
        let hpKey = dbPlayer.hp !== undefined ? 'hp' : (dbPlayer.HP !== undefined ? 'HP' : 'hp');
        let currentHp = Number(dbPlayer[hpKey] ?? 10);
        updatePayload[hpKey] = currentHp + (addedEnd * 10);
      }

      // 5. СОХРАНЯЕМ В SUPABASE И ВОЗВРАЩАЕМ ПРОФИЛЬ КЛИЕНТУ
      const { error: updateErr } = await sb.from('players').update(updatePayload).eq('id', nUserId);
      if (updateErr) {
        console.error("❌ Ошибка Supabase при сохранении характеристик:", updateErr);
        return socket.emit('stat_distribution_error', `Ошибка Supabase: ${updateErr.message}`);
      }

      const { data: finalPlayer } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      const getFinalStat = (k) => Number(finalPlayer[k] ?? finalPlayer[k.toLowerCase()] ?? finalPlayer[k.charAt(0).toUpperCase() + finalPlayer.slice(1)] ?? 1);

      const refreshedProfile = {
        id: finalPlayer.id,
        name: finalPlayer.name,
        avatar: finalPlayer.avatar,
        level: cloudLevel,
        gold: Number(finalPlayer.gold ?? 0),
        xp: Number(finalPlayer.xp ?? 0),
        hp: Number(finalPlayer.hp ?? 10),
        statPoints: Number(finalPlayer[finalPointsKey] ?? 0),
        currentTownIndex: Number(finalPlayer.currenttownindex ?? 0),
        stats: {
          strength: getFinalStat('strength'),
          agility: getFinalStat('agility'),
          endurance: getFinalStat('endurance'),
          intellect: getFinalStat('intellect'),
          luck: getFinalStat('luck')
        },
        inventory: finalPlayer.inventory || { equipment: [], resources: [], consumables: [] },
        equipped: finalPlayer.equipped || { rings: [null, null, null] }
      };

      socket.emit('load_game_success', { player: refreshedProfile });
    } catch (err) {
      console.error("❌ Критический сбой в методе распределения статов:", err);
      socket.emit('stat_distribution_error', 'Внутренняя критическая ошибка боевого сервера.');
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

  let canExecuteRound = false;

  if (room.type === 'pve') {
    const awaitingPvE = room.teamA.filter(p => !p.isBot && p.currentHp > 0 && !p.turn);
    if (awaitingPvE.length === 0) canExecuteRound = true;
  } 
  else if (room.type === 'pvp') {
    // 🔥 Жесткое ожидание: раунд считается ТОЛЬКО когда сделано столько ходов, сколько на арене живых людей!
    const alivePlayersCount = [...room.teamA, ...room.teamB].filter(p => p.currentHp > 0).length;
    const submittedTurnsCount = [...room.teamA, ...room.teamB].filter(p => p.turn !== null).length;
    
    if (submittedTurnsCount === alivePlayersCount) {
      canExecuteRound = true;
    } else {
      console.log(`⏳ [PvP ОЖИДАНИЕ] Ход принят. Ждем соперника... (${submittedTurnsCount}/${alivePlayersCount})`);
    }
  }

  if (canExecuteRound) {
    clearTimeout(room.timeoutRef);
    executeRoundCalculations(roomId);
  }
}); 

  socket.on('instant_use_potion', async ({ roomId }) => {
    const room = activeRooms[roomId];
    if (!room) return;

    const fighter = room.teamA.find(p => p.socketId === socket.id);
    if (!fighter || fighter.currentHp <= 0) return;

    const potionSlot = fighter.equipped?.potion;

    if (potionSlot && typeof potionSlot === 'object' && potionSlot.id && potionSlot.count > 0) {
      const potionData = CONSUMABLE_DATABASE[potionSlot.id];

      if (potionData) {
        fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + potionData.heal);
        
        // Уменьшаем количество банок в стаке на 1
        potionSlot.count--;
        let displayCountLog = potionSlot.count;

        // Если стак полностью израсходован, освобождаем слот
        if (potionSlot.count <= 0) {
          fighter.equipped.potion = null;
        }

        io.to(roomId).emit('battle_effect_potion', {
          uuid: fighter.uuid, 
          currentHp: fighter.currentHp,
          equipped: fighter.equipped, 
          logMsg: `🧪 <strong>${fighter.name}</strong> выпил ${potionData.name} (+${potionData.heal} HP)! Осталось в бою: ${displayCountLog} шт.`
        });

        await sb.from('players').update({ 
          hp: fighter.currentHp, 
          equipped: fighter.equipped 
        }).eq('id', Number(fighter.id));
      }
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

// ============================================================================
// 🏆 СЕРВЕРНАЯ ИНИЦИАЛИЗАЦИЯ PvP С КОНКРЕТНЫМИ СТАТИЧНЫМИ UUID
// ============================================================================
function initiatePvpMatch(roomId, p1Data, p1Hp, p2Data) {
  const p1MaxHp = getServerMaxHp(p1Data);
  const p2MaxHp = getServerMaxHp(p2Data);

  // Игрок 1 — жесткий UUID без привязки к дате
  const teamA = [{
    uuid: `player_${p1Data.id}`, 
    id: String(p1Data.id), 
    name: p1Data.name, 
    icon: '👤', 
    isBot: false,
    level: Number(p1Data.level), 
    strength: Number(p1Data.stats?.strength ?? p1Data.strength ?? 1), 
    agility: Number(p1Data.stats?.agility ?? p1Data.agility ?? 1),
    endurance: Number(p1Data.stats?.endurance ?? p1Data.endurance ?? 1), 
    intellect: Number(p1Data.stats?.intellect ?? p1Data.intellect ?? 1), 
    luck: Number(p1Data.stats?.luck ?? p1Data.luck ?? 1),
    currentHp: Math.min(Number(p1Hp), p1MaxHp), 
    maxHp: p1MaxHp, 
    socketId: null, 
    turn: null,
    equipped: p1Data.equipped || {}, 
    inventory: p1Data.inventory || {}
  }];

  // Игрок 2 — жесткий UUID без привязки к дате
  const teamB = [{
    uuid: `player_${p2Data.id}`, 
    id: String(p2Data.id), 
    name: p2Data.name, 
    icon: '👤', 
    isBot: false, 
    level: Number(p2Data.level), 
    strength: Number(p2Data.strength ?? p2Data.stats?.strength ?? 1), 
    agility: Number(p2Data.agility ?? p2Data.stats?.agility ?? 1),
    endurance: Number(p2Data.endurance ?? p2Data.stats?.endurance ?? 1), 
    intellect: Number(p2Data.intellect ?? p2Data.stats?.intellect ?? 1), 
    luck: Number(p2Data.luck ?? p2Data.stats?.luck ?? 1),
    currentHp: Number(p2Data.hp || p2MaxHp), 
    maxHp: p2MaxHp, 
    socketId: null, 
    turn: null,
    equipped: p2Data.equipped || {}, 
    inventory: p2Data.inventory || {}
  }];

  activeRooms[roomId] = { id: roomId, type: 'pvp', teamA, teamB, turnCount: 1, timeoutRef: null };
  
  console.log(`⚔️ [PvP МОСТ ВЫСТРОЕН] Комната: ${roomId}. Запуск таймера...`);
  
  // 🔥 Даем сокетам 150мс фонового времени, чтобы завершить удаление лобби и надежно принять редирект
  setTimeout(() => {
    io.emit('arena_lobby_updated');
    io.emit('arena_redirect_to_battle', { roomId: roomId });
  }, 150);

  startServerTurnTimer(roomId);
}

function startServerTurnTimer(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;
  if (room.timeoutRef) clearTimeout(room.timeoutRef);

  room.timeoutRef = setTimeout(() => {
    if (!activeRooms[roomId]) return;
    
    console.log(`⏱️ [ТАЙМАУТ БОЯ] Время на ход истекло в комнате ${roomId}. Авто-пропуск для АФК.`);

    // Собираем всех живых участников из обеих команд, кто не успел походить за 30 секунд
    const allFighters = [...room.teamA, ...room.teamB];
    
    allFighters.forEach(f => {
      if (!f.isBot && !f.turn && f.currentHp > 0) {
        const opposingTeam = room.teamA.includes(f) ? room.teamB : room.teamA;
        const aliveEnemies = opposingTeam.filter(e => e.currentHp > 0);
        
        // Принудительно ставим пропуск хода
        f.turn = { 
          targetUuid: aliveEnemies.length > 0 ? aliveEnemies[0].uuid : null, 
          attack: null, 
          defends: [] 
        };
      }
    });
    
    // Запускаем принудительный расчет раунда по таймауту
    executeRoundCalculations(roomId);
  }, 30000); // Полные 30 секунд на размышление
}

// ============================================================================
// 📊 ИСПРАВЛЕННЫЙ СЕРВЕРНЫЙ КАЛЬКУЛЯТОР БОЕВЫХ РАУНДОВ
// ============================================================================
function executeRoundCalculations(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;

  const logs = [];
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // ============================================================================
  // 🔥 ФИКС 1: Автоматический ИИ роботов ходит ТОЛЬКО в PvE! В PvP он полностью спит
  // ============================================================================
  if (room.type === 'pve') {
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
  }

  // Сортируем общую очередь ходов по динамической ловкости персонажей
  let queue = [...room.teamA, ...room.teamB];
  queue.sort((a, b) => getServerAgility(b) - getServerAgility(a));

  // Перебираем удары участников в раунде
  queue.forEach(attacker => {
    if (attacker.currentHp <= 0 || !attacker.turn || !attacker.turn.targetUuid) return;

    let target = [...room.teamA, ...room.teamB].find(f => f.uuid === attacker.turn.targetUuid);
    
    // Если изначальная цель погибла раньше времени, ищем любого живого врага напротив
    if (!target || target.currentHp <= 0) {
      const opposingTeam = room.teamA.includes(attacker) ? room.teamB : room.teamA;
      const newAlive = opposingTeam.filter(t => t.currentHp > 0);
      if (newAlive.length === 0) return;
      target = newAlive[0];
    }

    // 🔥 ФИКС 2: ТОТАЛЬНАЯ ЗАЩИТА ОТ САМОУДАРОВ (СВЕРКА UUID)
    if (attacker.uuid === target.uuid) {
      console.error(`🚨 [АНТИ-БАГ БЛОК] Боец ${attacker.name} попытался ударить сам себя! Ход отменен.`);
      return;
    }

    // Если игрок AFK или не выбрал зону атаки
    if (attacker.turn.attack === null) {
      logs.push(`❌ <strong>${attacker.name}</strong> замешкался и пропустил свою атаку.`);
      return;
    }

    // Проверяем, попал ли удар в одну из зон защиты соперника
    if (target.turn && target.turn.defends.includes(attacker.turn.attack)) {
      logs.push(`🛡️ <strong>${target.name}</strong> заблокировал удар от <strong>${attacker.name}</strong> в ${ZONE_NAMES[attacker.turn.attack]}.`);
    } else {
      // Расчет критического удара на основе Удачи (Luck)
      const attLuck = getServerLuck(attacker);
      const critChance = Math.min(50, 5 + (attLuck * 0.5));
      const isCrit = rand(1, 100) <= critChance;
      
      let baseDmg = getServerAtk(attacker);
      if (isCrit) baseDmg = Math.floor(baseDmg * 1.5);

      // Вычитаем защиту цели из атаки нападающего
      const targetDef = getServerDef(target);
      const dmg = Math.max(1, baseDmg - targetDef);

      target.currentHp = Math.max(0, target.currentHp - dmg);
      logs.push(`⚔️ <strong>${attacker.name}</strong> нанес <strong>${target.name}</strong> <strong>${dmg}</strong> урона в ${ZONE_NAMES[attacker.turn.attack]} ${isCrit ? '💥 КРИТ!' : ''}`);
    }
  });

  // Обнуляем буферы ходов участников для следующего раунда
  room.teamA.forEach(f => f.turn = null);
  room.teamB.forEach(f => f.turn = null);

  const isTeamADead = room.teamA.every(f => f.currentHp <= 0);
  const isTeamBDead = room.teamB.every(f => f.currentHp <= 0);
  const currentRound = room.turnCount;
  room.turnCount++;

  // Проверяем условия официального финала
  if (isTeamADead || isTeamBDead || room.turnCount > 40) {
    let result = 'draw';
    if (!isTeamADead && isTeamBDead) result = 'win';  // Победила команда А
    if (isTeamADead && !isTeamBDead) result = 'lose'; // Победила команда B

    // Разделяем финал по типу игровых комнат
    if (room.type === 'pve') {
      finalizePveBattle(room, result, logs, currentRound);
    } 
    else if (room.type === 'pvp') {
      finalizePvpBattle(room, result, logs, currentRound);
    }
  } else {
    // Бой продолжается — рассылаем новые пакеты раунда всем активным сокетам
    [...room.teamA, ...room.teamB].forEach(p => {
      if (p.socketId) {
        io.to(p.socketId).emit('round_result', { 
          turnCount: currentRound, 
          logs, 
          isOver: false, 
          teamA: sanitizeTeam(room.teamA), 
          teamB: sanitizeTeam(room.teamB) 
        });
      }
    });
    // Перезапускаем серверный таймер защиты от АФК
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
    
    // 🔥 ФИКС: Пересчитываем уровень игрока на сервере после получения нового опыта!
    const oldLevel = Number(player.level || 1);
    const correctLevel = getServerCorrectLevelByXp(player.xp);
    
    if (correctLevel > oldLevel) {
      const levelsGained = correctLevel - oldLevel;
      // Честно начисляем по +5 очков за каждый новый уровень
      player.statpoints = (player.statpoints || 0) + (levelsGained * 5);
      player.level = correctLevel;
      
      // Полностью восстанавливаем здоровье при повышении уровня
      player.currentHp = getServerMaxHp(player); 
      
      logs.push(`🎉 <strong>ПОВЫШЕНИЕ УРОВНЯ!</strong> Теперь вы ${correctLevel} уровня! Получено +${levelsGained * 5} очков характеристик.`);
    }

    logs.push(`🏁 <strong>ПОБЕДА!</strong> Награда: 💰 ${gainedGold} монет, ✨ ${gainedXp} опыта.`);
  } else {
    logs.push(`🏁 <strong>ВАС ОДОЛЕЛИ...</strong> Воскрешение в городе.`);
    player.currentHp = Math.max(1, Math.floor(player.maxHp * 0.2));
  }

  if (player.socketId) {
    io.to(player.socketId).emit('round_result', { turnCount: finalRound, logs, isOver: true, resultType: result, teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB) });
  }

  try {
    // Теперь в базу данных уйдет 100% обновленный и правильный level и statpoints
    await sb.from('players').update({ 
      gold: player.gold, 
      xp: player.xp, 
      hp: player.currentHp, 
      level: player.level, // Уровень запишется корректно!
      statpoints: player.statpoints, 
      inventory: player.inventory 
    }).eq('id', Number(player.id));
  } catch (err) { console.error(err); }
  
  delete activeRooms[room.id];
}
// ============================================================================
// 🏆 ФИЛЬТР ЗАВЕРШЕНИЯ PvP МАТЧА: СХРАНЕНИЕ ХП И НАЧИСЛЕНИЕ НАГРАД
// ============================================================================
async function finalizePvpBattle(room, result, logs, finalRound) {
  const playerA = room.teamA[0];
  const playerB = room.teamB[0];
  
  if (!playerA || !playerB) return delete activeRooms[room.id];

  console.log(`🏁 [PvP ФИНАЛ] Матч окончен в комнате ${room.id}. Результат команды А: ${result}`);

  let goldReward = 25; // Базовая ставка золота за победу на Арене

  if (result === 'win') {
    logs.push(`🏁 <strong>ПОБЕДА!</strong> Гладиатор <strong>${playerA.name}</strong> поверг соперника и получает 💰 ${goldReward} монет!`);
    playerA.gold = (playerA.gold || 0) + goldReward;
    
    // Проигравший выживает, но отправляется в город с 20% ХП
    playerB.currentHp = Math.max(1, Math.floor(playerB.maxHp * 0.2));
  } 
  else if (result === 'lose') {
    logs.push(`🏁 <strong>ПОБЕДА!</strong> Гладиатор <strong>${playerB.name}</strong> одержал верх и получает 💰 ${goldReward} монет!`);
    playerB.gold = (playerB.gold || 0) + goldReward;
    
    // Игрок А отправляется в город с 20% ХП
    playerA.currentHp = Math.max(1, Math.floor(playerA.maxHp * 0.2));
  } 
  else {
    logs.push(`🏁 <strong>НИЧЬЯ!</strong> Оба бойца обессилены. Боги Арены не выбрали победителя.`);
    playerA.currentHp = Math.max(1, Math.floor(playerA.maxHp * 0.2));
    playerB.currentHp = Math.max(1, Math.floor(playerB.maxHp * 0.2));
  }

  // 1. Отправляем финальные пакеты логов обоим участникам соревнований
  [playerA, playerB].forEach(p => {
    if (p.socketId) {
      io.to(p.socketId).emit('round_result', { 
        turnCount: finalRound, 
        logs, 
        isOver: true, 
        resultType: (p === playerA) ? result : (result === 'win' ? 'lose' : (result === 'lose' ? 'win' : 'draw')),
        teamA: sanitizeTeam(room.teamA), 
        teamB: sanitizeTeam(room.teamB) 
      });
    }
  });

  // 2. Мгновенно синхронизируем новые показатели золота и ХП обоих игроков в Supabase
  try {
    await sb.from('players').update({ gold: playerA.gold, hp: playerA.currentHp }).eq('id', Number(playerA.id));
    await sb.from('players').update({ gold: playerB.gold, hp: playerB.currentHp }).eq('id', Number(playerB.id));
    console.log(`☁️ [БД PvP ЗАПИСЬ] Профили участников дуэли успешно обновлены в Supabase.`);
  } catch (err) {
    console.error("❌ Ошибка записи итогов PvP в Supabase:", err);
  }

  // 3. Вычищаем комнату из оперативной памяти сервера
  delete activeRooms[room.id];
}
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Боевой сервер успешно запущен на порту ${PORT}`));