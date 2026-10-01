// ============================================================================
// ===== 🏆 СЕРВЕРНАЯ ЛОГИКА АРЕНЫ (ARENA_LOGIC.JS) =====
// ===== Лобби, заявки, старт боя. Работает через Supabase + in-memory =====
// ============================================================================

const dbHelper = require('./../db_helper');
const core = require('./../battle/battle_core');
const state = require('./../battle/battle_state');
const router = require('./../battle/battle_router');

// 🔥 In-memory лобби: Map<playerId, entry>
const arenaLobby = new Map();
global.arenaLobby = arenaLobby;

// TTL заявки
const REQUEST_TTL_MS = 5 * 60 * 1000;   // 5 минут

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================================

function getModeMaxPlayers(mode, teamSize) {
  // duel_1v1 → 2, group_3v3 → 6, chaos_5v5 → 10
  if (mode === 'duel_1v1') return 2;
  if (mode.startsWith('group_')) return teamSize * 2;
  if (mode.startsWith('chaos_')) return teamSize;   // chaos_N = N игроков всего
  return 2;
}

function getTeamSizeFromMode(mode) {
  if (mode === 'duel_1v1') return 1;
  const parts = mode.split('_');   // ['group', '3v3'] или ['chaos', '10']
  if (parts.length < 2) return 1;
  if (parts[0] === 'group') {
    const vs = parts[1].split('v');
    return Number(vs[0]) || 1;
  }
  if (parts[0] === 'chaos') {
    return Math.floor((Number(parts[1]) || 2) / 2);
  }
  return 1;
}

function buildLobbyEntry(playerRow, playerData, mode, teamSize, socketId) {
  const maxPlayers = getModeMaxPlayers(mode, teamSize);

  return {
    id: Number(playerRow.id),
    ownerId: Number(playerRow.id),
    name: playerRow.name,
    level: Number(playerRow.level || 1),
    hp: Number(playerRow.hp || 0),
    maxHp: dbHelper.getServerMaxHp(playerRow),
    mode,
    teamSize,
    maxPlayers,
    playerData: {
      equipped: playerRow.equipped || {},
      inventory: playerRow.inventory || {},
      stats: {
        strength: dbHelper.safeReadField(playerRow, 'strength', 1),
        agility:  dbHelper.safeReadField(playerRow, 'agility', 1),
        endurance: dbHelper.safeReadField(playerRow, 'endurance', 1),
        luck:     dbHelper.safeReadField(playerRow, 'luck', 1)
      }
    },
    socketId,
    expiresAt: Date.now() + REQUEST_TTL_MS
  };
}

function serializeLobbyEntry(entry) {
  return {
    id: entry.id,
    ownerId: entry.ownerId,
    name: entry.name,
    level: entry.level,
    hp: entry.hp,
    maxHp: entry.maxHp,
    mode: entry.mode,
    teamSize: entry.teamSize,
    maxPlayers: entry.maxPlayers,
    expiresAt: entry.expiresAt,
    arena_expires_at: new Date(entry.expiresAt).toISOString()
  };
}

async function saveLobbyEntryToDb(sb, entry) {
  try {
    await sb.from('arena_lobby').upsert({
      id: entry.id,
      owner_id: entry.ownerId,
      name: entry.name,
      level: entry.level,
      hp: entry.hp,
      max_hp: entry.maxHp,
      mode: entry.mode,
      team_size: entry.teamSize,
      max_players: entry.maxPlayers,
      player_data: entry.playerData,
      socket_id: entry.socketId,
      arena_expires_at: new Date(entry.expiresAt).toISOString()
    }, { onConflict: 'id' });
  } catch (e) {
    console.error('🚨 [ARENA] Ошибка сохранения заявки в БД:', e.message);
  }
}

async function deleteLobbyFromDb(sb, ownerId) {
  try {
    await sb.from('arena_lobby').delete().eq('owner_id', ownerId);
  } catch (e) {
    console.error('🚨 [ARENA] Ошибка удаления заявки из БД:', e.message);
  }
}

// ============================================================================
// ГРУППИРОВКА: разбиваем Map в «комнаты» по ownerId
// ============================================================================

function getGroupedLobby() {
  const grouped = new Map();   // ownerId → [entries]

  for (const entry of arenaLobby.values()) {
    if (!grouped.has(entry.ownerId)) grouped.set(entry.ownerId, []);
    grouped.get(entry.ownerId).push(entry);
  }

  // Возвращаем массив «комнат» с метаданными
  return Array.from(grouped.values()).map(members => {
    const owner = members.find(m => m.id === m.ownerId) || members[0];
    return {
      ownerId: owner.ownerId,
      ownerName: owner.name,
      ownerLevel: owner.level,
      mode: owner.mode,
      teamSize: owner.teamSize,
      maxPlayers: owner.maxPlayers,
      members: members.map(serializeLobbyEntry),
      currentCount: members.length,
      expiresAt: owner.expiresAt,
      arena_expires_at: new Date(owner.expiresAt).toISOString()
    };
  });
}

// ============================================================================
// ОСНОВНОЙ МОДУЛЬ
// ============================================================================

module.exports = function(io, socket, sb, activeRooms) {
  if (!socket) return;

  console.log('🏆 [ARENA] Модуль лобби загружен');

  // --------------------------------------------------------------------------
  // 1. ЗАПРОС СПИСКА ЗАЯВОК
  // --------------------------------------------------------------------------
  socket.on('arena_get_lobby', () => {
    try {
      const lobby = getGroupedLobby();
      socket.emit('arena_lobby_data', lobby);
    } catch (err) {
      console.error('🚨 [arena_get_lobby]', err.message);
      socket.emit('arena_lobby_data', []);
    }
  });

  // --------------------------------------------------------------------------
  // 2. СОЗДАНИЕ СВОЕЙ ЗАЯВКИ
  // --------------------------------------------------------------------------
    socket.on('arena_create_request', async ({ mode = 'duel_1v1' } = {}) => {
    try {
        const userId = Number(socket.data?.userId || socket.handshake?.auth?.userId);
        if (!userId) return socket.emit('arena_error', 'Не авторизован');

        // 🔥 Если игрок уже в лобби, но отключён — обновляем socketId
        const existing = arenaLobby.get(userId);
        if (existing) {
        if (existing.disconnectedAt) {
            console.log(`♻️ [ARENA] ${existing.name} вернулся после F5 — восстанавливаем заявку`);
            existing.socketId = socket.id;
            existing.disconnectedAt = null;
            io.emit('arena_lobby_updated');
            return socket.emit('arena_lobby_updated_self');
        }
        return socket.emit('arena_error', 'У вас уже есть активная заявка');
        }

      // Читаем профиль из БД
      const { data: row } = await sb.from('players').select('*').eq('id', userId).maybeSingle();
      if (!row) return socket.emit('arena_error', 'Персонаж не найден');

      if (Number(row.hp || 0) <= 0) {
        return socket.emit('arena_error', 'Нельзя выйти на арену с 0 HP. Излечитесь в городе.');
      }

      const teamSize = getTeamSizeFromMode(mode);
      const entry = buildLobbyEntry(row, null, mode, teamSize, socket.id);

      arenaLobby.set(userId, entry);
      await saveLobbyEntryToDb(sb, entry);

      console.log(`🏆 [ARENA] ${entry.name} создал заявку ${mode} (${entry.maxPlayers} мест)`);

      // Broadcast всем
      io.emit('arena_lobby_updated');

      // Проверяем — может быть уже набралось?
      await checkAndStartBattle(io, sb, activeRooms, entry.ownerId);

    } catch (err) {
      console.error('🚨 [arena_create_request]', err.message);
      socket.emit('arena_error', 'Ошибка сервера');
    }
  });

  // --------------------------------------------------------------------------
  // 3. ОТМЕНА СВОЕЙ ЗАЯВКИ (или выход из чужой)
  // --------------------------------------------------------------------------
  socket.on('arena_cancel_request', async () => {
    try {
      const userId = Number(socket.data?.userId || socket.handshake?.auth?.userId);
      if (!userId) return;

      const entry = arenaLobby.get(userId);
      if (!entry) return;

      const ownerId = entry.ownerId;
      const isOwner = (entry.id === ownerId);

      if (isOwner) {
        // Владелец отменяет всю комнату
        console.log(`🏆 [ARENA] ${entry.name} отменяет свою комнату (ownerId=${ownerId})`);

        // Удаляем всех участников этой комнаты
        for (const [pid, e] of arenaLobby.entries()) {
          if (e.ownerId === ownerId) {
            arenaLobby.delete(pid);
            io.to(e.socketId).emit('arena_request_cancelled', {
              reason: 'Владелец отменил заявку'
            });
          }
        }
        await deleteLobbyFromDb(sb, ownerId);
      } else {
        // Участник выходит из чужой комнаты
        console.log(`🏆 [ARENA] ${entry.name} вышел из комнаты ${ownerId}`);
        arenaLobby.delete(userId);
        await sb.from('arena_lobby').delete().eq('id', userId);
        socket.emit('arena_request_cancelled', { reason: 'Вы вышли из заявки' });
      }

      io.emit('arena_lobby_updated');

    } catch (err) {
      console.error('🚨 [arena_cancel_request]', err.message);
    }
  });

  // --------------------------------------------------------------------------
  // 4. ПРИСОЕДИНЕНИЕ К ЧУЖОЙ ЗАЯВКЕ
  // --------------------------------------------------------------------------
  socket.on('arena_join_request', async ({ ownerId }) => {
    try {
      const userId = Number(socket.data?.userId || socket.handshake?.auth?.userId);
      if (!userId) return socket.emit('arena_error', 'Не авторизован');

      ownerId = Number(ownerId);

      if (arenaLobby.has(userId)) {
        return socket.emit('arena_error', 'У вас уже есть активная заявка');
      }

      // Ищем владельца
      const ownerEntry = arenaLobby.get(ownerId);
      if (!ownerEntry) {
        return socket.emit('arena_error', 'Заявка не найдена или уже стартовала');
      }

      // Проверяем заполненность
      const members = Array.from(arenaLobby.values()).filter(e => e.ownerId === ownerId);
      if (members.length >= ownerEntry.maxPlayers) {
        return socket.emit('arena_error', 'Заявка уже заполнена');
      }

      // Читаем профиль
      const { data: row } = await sb.from('players').select('*').eq('id', userId).maybeSingle();
      if (!row) return socket.emit('arena_error', 'Персонаж не найден');

      if (Number(row.hp || 0) <= 0) {
        return socket.emit('arena_error', 'Нельзя выйти на арену с 0 HP');
      }

      const entry = buildLobbyEntry(row, null, ownerEntry.mode, ownerEntry.teamSize, socket.id);
      entry.ownerId = ownerId;   // ключевое: привязываем к чужой комнате

      arenaLobby.set(userId, entry);
      await saveLobbyEntryToDb(sb, entry);

      console.log(`🏆 [ARENA] ${entry.name} присоединился к комнате ${ownerId}`);

      socket.emit('arena_request_joined', { ownerId });
      io.emit('arena_lobby_updated');

      // Проверяем — набралось ли?
      await checkAndStartBattle(io, sb, activeRooms, ownerId);

    } catch (err) {
      console.error('🚨 [arena_join_request]', err.message);
      socket.emit('arena_error', 'Ошибка сервера');
    }
  });

  // --------------------------------------------------------------------------
  // 5. ВЫХОД ИЗ ЧУЖОЙ ЗАЯВКИ (алиас для cancel)
  // --------------------------------------------------------------------------
  socket.on('arena_leave_request', async () => {
    // Просто вызываем ту же логику
    socket.emit('arena_cancel_request');
  });

  // --------------------------------------------------------------------------
  // 6. ПРОВЕРКА И СТАРТ БОЯ
  // --------------------------------------------------------------------------
  async function checkAndStartBattle(io, sb, activeRooms, ownerId) {
    const members = Array.from(arenaLobby.values()).filter(e => e.ownerId === ownerId);
    if (members.length === 0) return;

    const owner = members[0];
    const maxPlayers = owner.maxPlayers;

    if (members.length < maxPlayers) return;   // ещё не набралось

    console.log(`🎬 [ARENA] Комната ${ownerId} набрала ${members.length}/${maxPlayers}. Стартуем!`);

    // Удаляем всех из лобби (в БД и в памяти)
    for (const m of members) {
      arenaLobby.delete(m.id);
    }
    await deleteLobbyFromDb(sb, ownerId);

    // Рандомно делим на 2 команды
    const shuffled = members.map(m => ({ ...m })).sort(() => Math.random() - 0.5);
    const half = Math.floor(shuffled.length / 2);
    const teamA = shuffled.slice(0, half);
    const teamB = shuffled.slice(half);

    // Собираем данные для battle_core
    const battleType = 'arena_pvp';
    const config = router.getConfig(battleType);

    // Формируем teamA/teamB в формате battle_core
    const buildFighter = (entry, teamKey) => ({
      uuid: `player_${entry.id}`,
      id: String(entry.id),
      name: entry.name,
      icon: '👤',
      isBot: false,
      level: entry.level,
      strength: entry.playerData.stats.strength,
      agility: entry.playerData.stats.agility,
      endurance: entry.playerData.stats.endurance,
      luck: entry.playerData.stats.luck,
      currentHp: entry.hp,
      maxHp: entry.maxHp,
      equipped: entry.playerData.equipped,
      inventory: entry.playerData.inventory,
      turn: null,
      afkTurns: 0,
      socketId: entry.socketId
    });

    const teamAFighters = teamA.map(e => buildFighter(e, 'A'));
    const teamBFighters = teamB.map(e => buildFighter(e, 'B'));

    // Создаём комнату
    const room = core.createRoom({
      battleType,
      teamA: teamAFighters,
      teamB: teamBFighters,
      config,
      params: {}
    });

    activeRooms[room.id] = room;

    // Каждого игрока — в комнату и редирект
    for (const entry of members) {
      const fighter = [...teamAFighters, ...teamBFighters].find(f => f.id === String(entry.id));
      if (!fighter) continue;

      const fighterSocket = io.sockets.sockets.get(entry.socketId);
      if (fighterSocket) {
        fighterSocket.join(room.id);
      }

      if (!global.activeBattlesByUser) global.activeBattlesByUser = new Map();
      global.activeBattlesByUser.set(String(entry.id), room.id);

      io.to(entry.socketId).emit('arena_redirect_to_battle', {
        roomId: room.id,
        battleType
      });
    }

    console.log(`🏆 [ARENA] Бой создан: roomId=${room.id}, игроков=${members.length}`);
  }

  // --------------------------------------------------------------------------
  // 7. АВТООЧИСТКА ПРОСРОЧЕННЫХ ЗАЯВОК
  // --------------------------------------------------------------------------
  setInterval(async () => {
    try {
      const now = Date.now();
      const expiredOwners = new Set();

      for (const [pid, entry] of arenaLobby.entries()) {
        if (entry.expiresAt <= now) {
          expiredOwners.add(entry.ownerId);
        }
      }

      for (const ownerId of expiredOwners) {
        const members = Array.from(arenaLobby.values()).filter(e => e.ownerId === ownerId);

        console.log(`⏰ [ARENA] Заявка ${ownerId} истекла. Отменяем ${members.length} участников.`);

        for (const m of members) {
          arenaLobby.delete(m.id);
          io.to(m.socketId).emit('arena_request_cancelled', {
            reason: 'Время заявки истекло'
          });
        }
        await deleteLobbyFromDb(sb, ownerId);
      }

      if (expiredOwners.size > 0) {
        io.emit('arena_lobby_updated');
      }
    } catch (err) {
      console.error('🚨 [ARENA] Ошибка очистки:', err.message);
    }
  }, 30 * 1000);   // каждые 30 секунд
 // --------------------------------------------------------------------------
  // 8. DISCONNECT — заявку НЕ удаляем сразу (даём время на F5)
  // --------------------------------------------------------------------------
  socket.on('disconnect', () => {
    const userId = Number(socket.data?.userId || socket.handshake?.auth?.userId);
    if (!userId) return;

    const entry = arenaLobby.get(userId);
    if (!entry) return;

    console.log(`⚠️ [ARENA] ${entry.name} отключился — заявка остаётся на 30 сек`);

    // 🔥 Даём 30 секунд на F5/переподключение
    const disconnectTime = Date.now();
    entry.disconnectedAt = disconnectTime;

    setTimeout(() => {
      const currentEntry = arenaLobby.get(userId);
      if (!currentEntry) return;

      // Если за это время игрок переподключился и обновил socketId — не удаляем
      if (currentEntry.disconnectedAt !== disconnectTime) {
        console.log(`✅ [ARENA] ${currentEntry.name} вернулся — заявка сохранена`);
        return;
      }

      console.log(`🚪 [ARENA] ${currentEntry.name} не вернулся за 30 сек — убираем из лобби`);

      const ownerId = currentEntry.ownerId;
      const wasOwner = (currentEntry.id === ownerId);
      arenaLobby.delete(userId);

      if (wasOwner) {
        const members = Array.from(arenaLobby.values()).filter(e => e.ownerId === ownerId);
        for (const m of members) {
          arenaLobby.delete(m.id);
          io.to(m.socketId).emit('arena_request_cancelled', { reason: 'Владелец покинул лобби' });
        }
        deleteLobbyFromDb(sb, ownerId);
      } else {
        sb.from('arena_lobby').delete().eq('id', userId).then(() => {});
      }

      io.emit('arena_lobby_updated');
    }, 30 * 1000);   // 30 сек
  });
  // --------------------------------------------------------------------------
  // 9. ПРОВЕРКА — я в лобби? (для восстановления после F5)
  // --------------------------------------------------------------------------
  socket.on('arena_check_my_request', () => {
    try {
      const userId = Number(socket.data?.userId || socket.handshake?.auth?.userId);
      if (!userId) return;

      const entry = arenaLobby.get(userId);
      if (!entry) {
        socket.emit('arena_lobby_updated_self', { restored: false });
        return;
      }

      // 🔥 Восстанавливаем: обновляем socketId и снимаем пометку disconnect
      console.log(`♻️ [ARENA] ${entry.name} вернулся после F5 — восстанавливаем заявку`);
      entry.socketId = socket.id;
      entry.disconnectedAt = null;

      socket.emit('arena_lobby_updated_self', { restored: true });
      io.emit('arena_lobby_updated');
    } catch (err) {
      console.error('🚨 [arena_check_my_request]', err.message);
    }
  });
};
