// ============================================================================
// ===== 🏆 СЕРВЕРНАЯ ЛОГИКА АРЕНЫ (ARENA_LOGIC.JS) — v3 =====
// ===== Поддержка N×N групповых боёв (без ботов пока) =====
// ============================================================================

const dbHelper = require('./../db_helper');
const core = require('./../battle/battle_core');
const state = require('./../battle/battle_state');
const router = require('./../battle/battle_router');

// 🔥 In-memory лобби: Map<playerId, entry>
const arenaLobby = new Map();
global.arenaLobby = arenaLobby;

// TTL заявки
// 🔥 ДЛЯ ТЕСТОВ: 60 секунд. В продакшене вернуть 5 * 60 * 1000
const REQUEST_TTL_MS = 60 * 1000;

// ============================================================================
// ХЕЛПЕРЫ
// ============================================================================

function getTeamSizeFromMode(mode) {
  if (mode === 'duel_1v1') return 1;
  if (mode.startsWith('group_')) {
    const parts = mode.split('_')[1];   // "2v2" | "3v3" | "5v5"
    const vs = parts.split('v');
    return Number(vs[0]) || 1;
  }
  return 1;
}

function getModeMaxPlayers(mode) {
  return getTeamSizeFromMode(mode) * 2;
}

function buildLobbyEntry(playerRow, mode, team, socketId) {
  const teamSize = getTeamSizeFromMode(mode);
  const maxPlayers = teamSize * 2;

  return {
    id: Number(playerRow.id),
    ownerId: Number(playerRow.id),   // для создателя = его id
    name: playerRow.name,
    level: Number(playerRow.level || 1),
    hp: Number(playerRow.hp || 0),
    maxHp: dbHelper.getServerMaxHp(playerRow),
    mode,
    teamSize,
    maxPlayers,
    team,   // 🔥 'A' | 'B' | null
    playerData: {
      equipped: playerRow.equipped || {},
      inventory: playerRow.inventory || {},
      stats: {
        strength:  dbHelper.safeReadField(playerRow, 'strength', 1),
        agility:   dbHelper.safeReadField(playerRow, 'agility', 1),
        endurance: dbHelper.safeReadField(playerRow, 'endurance', 1),
        luck:      dbHelper.safeReadField(playerRow, 'luck', 1)
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
    team: entry.team,
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
      team: entry.team,
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
// ГРУППИРОВКА — комнаты по ownerId
// ============================================================================

function getGroupedLobby() {
  const grouped = new Map();   // ownerId → [entries]

  for (const entry of arenaLobby.values()) {
    if (!grouped.has(entry.ownerId)) grouped.set(entry.ownerId, []);
    grouped.get(entry.ownerId).push(entry);
  }

  return Array.from(grouped.values()).map(members => {
    const owner = members.find(m => m.id === m.ownerId) || members[0];
    const teamA = members.filter(m => m.team === 'A');
    const teamB = members.filter(m => m.team === 'B');

    return {
      ownerId: owner.ownerId,
      ownerName: owner.name,
      ownerLevel: owner.level,
      mode: owner.mode,
      teamSize: owner.teamSize,
      maxPlayers: owner.maxPlayers,
      members: members.map(serializeLobbyEntry),
      teamA: teamA.map(serializeLobbyEntry),
      teamB: teamB.map(serializeLobbyEntry),
      currentCount: members.length,
      teamACount: teamA.length,
      teamBCount: teamB.length,
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

      // Восстановление после F5
      const existing = arenaLobby.get(userId);
      if (existing) {
        if (existing.disconnectedAt) {
          console.log(`♻️ [ARENA] ${existing.name} вернулся после F5 — восстанавливаем заявку`);
          existing.socketId = socket.id;
          existing.disconnectedAt = null;
          io.emit('arena_lobby_updated');
          return socket.emit('arena_lobby_updated_self', { restored: true });
        }
        return socket.emit('arena_error', 'У вас уже есть активная заявка');
      }

      const { data: row } = await sb.from('players').select('*').eq('id', userId).maybeSingle();
      if (!row) return socket.emit('arena_error', 'Персонаж не найден');

      if (Number(row.hp || 0) <= 0) {
        return socket.emit('arena_error', 'Нельзя выйти на арену с 0 HP. Излечитесь в городе.');
      }

      // 🔥 Создатель всегда в команду A
      const entry = buildLobbyEntry(row, mode, 'A', socket.id);
      arenaLobby.set(userId, entry);
      await saveLobbyEntryToDb(sb, entry);

      console.log(`🏆 [ARENA] ${entry.name} создал заявку ${mode} (команда A)`);

      io.emit('arena_lobby_updated');
      await checkAndStartBattle(io, sb, activeRooms, entry.ownerId);

    } catch (err) {
      console.error('🚨 [arena_create_request]', err.message);
      socket.emit('arena_error', 'Ошибка сервера');
    }
  });

  // --------------------------------------------------------------------------
  // 3. ПРИСОЕДИНЕНИЕ К ЧУЖОЙ ЗАЯВКЕ (с выбором команды)
  // --------------------------------------------------------------------------
  socket.on('arena_join_request', async ({ ownerId, team }) => {
    try {
      const userId = Number(socket.data?.userId || socket.handshake?.auth?.userId);
      if (!userId) return socket.emit('arena_error', 'Не авторизован');

      ownerId = Number(ownerId);
      team = (team === 'A' || team === 'B') ? team : null;

      if (!team) return socket.emit('arena_error', 'Выберите команду');

      if (arenaLobby.has(userId)) {
        return socket.emit('arena_error', 'У вас уже есть активная заявка');
      }

      const ownerEntry = arenaLobby.get(ownerId);
      if (!ownerEntry) {
        return socket.emit('arena_error', 'Заявка не найдена или уже стартовала');
      }

      const members = Array.from(arenaLobby.values()).filter(e => e.ownerId === ownerId);
      const teamMembers = members.filter(m => m.team === team);

      // 🔥 Проверка заполненности команды
      if (teamMembers.length >= ownerEntry.teamSize) {
        return socket.emit('arena_error', `Команда ${team} заполнена`);
      }

      const { data: row } = await sb.from('players').select('*').eq('id', userId).maybeSingle();
      if (!row) return socket.emit('arena_error', 'Персонаж не найден');

      if (Number(row.hp || 0) <= 0) {
        return socket.emit('arena_error', 'Нельзя выйти на арену с 0 HP');
      }

      const entry = buildLobbyEntry(row, ownerEntry.mode, team, socket.id);
      entry.ownerId = ownerId;
      entry.expiresAt = ownerEntry.expiresAt;   // 🔥 синхронизируем таймер с владельцем

      arenaLobby.set(userId, entry);
      await saveLobbyEntryToDb(sb, entry);

      console.log(`🏆 [ARENA] ${entry.name} присоединился к комнате ${ownerId} (команда ${team})`);

      socket.emit('arena_request_joined', { ownerId, team });
      io.emit('arena_lobby_updated');

      await checkAndStartBattle(io, sb, activeRooms, ownerId);

    } catch (err) {
      console.error('🚨 [arena_join_request]', err.message);
      socket.emit('arena_error', 'Ошибка сервера');
    }
  });

  // --------------------------------------------------------------------------
  // 4. ОТМЕНА / ВЫХОД
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
        console.log(`🏆 [ARENA] ${entry.name} отменяет свою комнату (ownerId=${ownerId})`);

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

  socket.on('arena_leave_request', async () => {
    socket.emit('arena_cancel_request');
  });

  // --------------------------------------------------------------------------
  // 5. ПРОВЕРКА Я В ЛОББИ (для F5)
  // --------------------------------------------------------------------------
  socket.on('arena_check_my_request', (arg1, arg2) => {
    try {
      const callback = (typeof arg1 === 'function') ? arg1
                     : (typeof arg2 === 'function') ? arg2
                     : null;

      const userId = Number(socket.data?.userId || socket.handshake?.auth?.userId);
      if (!userId) {
        if (callback) callback({ restored: false });
        return;
      }

      const entry = arenaLobby.get(userId);
      if (!entry) {
        if (callback) callback({ restored: false });
        socket.emit('arena_lobby_updated_self', { restored: false });
        return;
      }

      console.log(`♻️ [ARENA] ${entry.name} вернулся после F5 — восстанавливаем заявку`);
      entry.socketId = socket.id;
      entry.disconnectedAt = null;

      if (callback) callback({ restored: true });
      socket.emit('arena_lobby_updated_self', { restored: true });
      io.emit('arena_lobby_updated');
    } catch (err) {
      console.error('🚨 [arena_check_my_request]', err.message);
      if (typeof arg1 === 'function') arg1({ restored: false });
    }
  });

  // --------------------------------------------------------------------------
  // 6. СТАРТ БОЯ
  // --------------------------------------------------------------------------
  async function checkAndStartBattle(io, sb, activeRooms, ownerId) {
    const members = Array.from(arenaLobby.values()).filter(e => e.ownerId === ownerId);
    if (members.length === 0) return;

    const owner = members[0];
    const maxPlayers = owner.maxPlayers;
    const teamSize = owner.teamSize;

    // Считаем по командам
    const teamA = members.filter(m => m.team === 'A');
    const teamB = members.filter(m => m.team === 'B');

    // 🔥 Обе команды должны быть заполнены ПОЛНОСТЬЮ (для старта)
    if (teamA.length < teamSize || teamB.length < teamSize) {
      return;   // ещё не набралось
    }

    console.log(`🎬 [ARENA] Комната ${ownerId} набрала ${members.length}/${maxPlayers}. Стартуем!`);

    // Удаляем из лобби
    for (const m of members) {
      arenaLobby.delete(m.id);
    }
    await deleteLobbyFromDb(sb, ownerId);

    // Собираем бойцов
    const buildFighter = (entry) => ({
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

    const teamAFighters = teamA.map(buildFighter);
    const teamBFighters = teamB.map(buildFighter);

    const config = router.getConfig('arena_pvp');
    const room = core.createRoom({
      battleType: 'arena_pvp',
      teamA: teamAFighters,
      teamB: teamBFighters,
      config,
      params: {}
    });

    activeRooms[room.id] = room;

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
        battleType: 'arena_pvp'
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
        if (members.length === 0) continue;

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
  }, 5 * 1000);   // 🔥 проверка каждые 5 секунд (было 30)

  // --------------------------------------------------------------------------
  // 8. DISCONNECT — 30 сек на возврат после F5
  // --------------------------------------------------------------------------
  socket.on('disconnect', () => {
    const userId = Number(socket.data?.userId || socket.handshake?.auth?.userId);
    if (!userId) return;

    const entry = arenaLobby.get(userId);
    if (!entry) return;

    console.log(`⚠️ [ARENA] ${entry.name} отключился — заявка остаётся на 30 сек`);
    entry.disconnectedAt = Date.now();
    const disconnectTime = entry.disconnectedAt;

    setTimeout(() => {
      const current = arenaLobby.get(userId);
      if (!current) return;
      if (current.disconnectedAt !== disconnectTime) return;

      console.log(`🚪 [ARENA] ${current.name} не вернулся за 30 сек — убираем`);

      const ownerId = current.ownerId;
      const wasOwner = (current.id === ownerId);
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
    }, 30 * 1000);
  });
};