// ============================================================================
// ===== 🗺️ СЕРВЕРНАЯ ЛОГИКА КАРТЫ МИРА (WORLD_LOGIC.JS) =====
// ===== С ЗАДЕРЖКОЙ ПЕРЕХОДА 15 СЕКУНД + ЗАЩИТОЙ ОТ СПАМА =====
// ============================================================================

const { WORLD_REGIONS, RESOURCES_DB, BUILDINGS_DB } = require('./world_config');

const VIEW_RADIUS = 7;
const MOVE_DURATION_MS = 15000;

// Хранилище активных переходов
const activeMoves = new Map();

module.exports = function(io, socket, sb, activeRooms) {
  if (!socket) return;

  // --------------------------------------------------------------------------
  // ХЕЛПЕР: Получить позицию игрока
  // --------------------------------------------------------------------------
  async function getPlayerPosition(userId) {
    const { data } = await sb
      .from('player_position')
      .select('*')
      .eq('user_id', Number(userId))
      .maybeSingle();

    if (data) return data;

    const defaultPos = {
      user_id: Number(userId),
      current_map_id: 'ashenvale_main',
      x: 25, y: 25,
      updated_at: new Date().toISOString()
    };

    await sb.from('player_position').insert(defaultPos);
    return defaultPos;
  }

  // --------------------------------------------------------------------------
  // ХЕЛПЕР: Онлайн-игроки на карте
  // --------------------------------------------------------------------------
  async function getOnlinePlayersOnMap(mapId, excludeUserId = null) {
    if (!global.onlinePlayers) return [];

    const onlineIds = [];
    for (const [userId, player] of global.onlinePlayers.entries()) {
      if (excludeUserId && String(userId) === String(excludeUserId)) continue;
      onlineIds.push(Number(userId));
    }

    if (onlineIds.length === 0) return [];

    const { data } = await sb
      .from('player_position')
      .select('user_id, x, y')
      .eq('current_map_id', mapId)
      .in('user_id', onlineIds);

    if (!data) return [];

    return data.map(p => {
      const online = global.onlinePlayers.get(String(p.user_id));
      return {
        user_id: p.user_id,
        name: online ? online.name : 'Игрок',
        x: p.x, y: p.y
      };
    });
  }

  // --------------------------------------------------------------------------
  // 1. ЗАПРОС КАРТЫ
  // --------------------------------------------------------------------------
  socket.on('world_get_map', async ({ userId }) => {
    try {
      const pos = await getPlayerPosition(userId);
      const mapId = pos.current_map_id;
      const cx = pos.x, cy = pos.y;

      const xMin = Math.max(0, cx - VIEW_RADIUS);
      const xMax = cx + VIEW_RADIUS;
      const yMin = Math.max(0, cy - VIEW_RADIUS);
      const yMax = cy + VIEW_RADIUS;

      const [tilesRes, resourcesRes, monstersRes, players] = await Promise.all([
        sb.from('world_tiles').select('*').eq('map_id', mapId)
          .gte('x', xMin).lte('x', xMax).gte('y', yMin).lte('y', yMax),
        sb.from('world_resources').select('*').eq('map_id', mapId)
          .gte('x', xMin).lte('x', xMax).gte('y', yMin).lte('y', yMax),
        sb.from('world_monsters').select('*').eq('map_id', mapId)
          .gte('x', xMin).lte('x', xMax).gte('y', yMin).lte('y', yMax),
        getOnlinePlayersOnMap(mapId, userId)
      ]);

      // Активный переход (если есть)
      const nUserId = Number(userId);
      let activeMoveData = null;
      if (activeMoves.has(nUserId)) {
        const move = activeMoves.get(nUserId);
        const remainingMs = Math.max(0, move.endsAt - Date.now());
        if (remainingMs > 0) {
          activeMoveData = {
            targetX: move.targetX,
            targetY: move.targetY,
            endsAt: move.endsAt,
            durationMs: remainingMs
          };
        }
      }

      socket.emit('world_map_data', {
        mapId,
        myX: cx, myY: cy,
        tiles: tilesRes.data || [],
        resources: resourcesRes.data || [],
        monsters: monstersRes.data || [],
        players: players,
        resourcesDB: RESOURCES_DB,
        regionsDB: WORLD_REGIONS,
        buildingsDB: BUILDINGS_DB,
        activeMove: activeMoveData
      });

      console.log(`🗺️ [МИР] ${userId} запросил карту (${cx}, ${cy})`);
    } catch (err) {
      console.error("🚨 Ошибка world_get_map:", err.message);
      socket.emit('error', 'Ошибка загрузки карты мира');
    }
  });

  // --------------------------------------------------------------------------
  // 2. НАЧАЛО ПЕРЕХОДА (С ЖЁСТКОЙ ЗАЩИТОЙ ОТ СПАМА)
  // --------------------------------------------------------------------------
  socket.on('world_move_start', async ({ userId, dx, dy }) => {
    let nUserId = null;
    try {
      nUserId = Number(userId);

      // 🔥 ЖЕЛЕЗНАЯ БЛОКИРОВКА: помечаем игрока СРАЗУ, до любых await
      if (activeMoves.has(nUserId)) {
        return socket.emit('world_move_blocked', { reason: 'Вы уже в пути' });
      }
      // Заглушка — блокирует повторные запросы, пока идёт проверка
      activeMoves.set(nUserId, {
        endsAt: Date.now() + MOVE_DURATION_MS,
        dx, dy,
        targetX: 0, targetY: 0,
        timerId: null,
        isInitializing: true
      });

      const pos = await getPlayerPosition(userId);
      const mapId = pos.current_map_id;
      const newX = pos.x + dx;
      const newY = pos.y + dy;

      const { data: mapInfo } = await sb
        .from('world_maps').select('width, height').eq('id', mapId).maybeSingle();
      if (!mapInfo) {
        activeMoves.delete(nUserId);
        return socket.emit('error', 'Карта не найдена');
      }

      if (newX < 0 || newX >= mapInfo.width || newY < 0 || newY >= mapInfo.height) {
        activeMoves.delete(nUserId);
        return socket.emit('world_move_blocked', { reason: 'За границей карты' });
      }

      const { data: tile } = await sb
        .from('world_tiles').select('is_blocked')
        .eq('map_id', mapId).eq('x', newX).eq('y', newY).maybeSingle();

      if (!tile) {
        activeMoves.delete(nUserId);
        return socket.emit('error', 'Клетка не существует');
      }
      if (tile.is_blocked) {
        activeMoves.delete(nUserId);
        return socket.emit('world_move_blocked', { reason: 'Клетка непроходима' });
      }

      const endsAt = Date.now() + MOVE_DURATION_MS;

      socket.emit('world_move_started', {
        fromX: pos.x, fromY: pos.y,
        toX: newX, toY: newY,
        durationMs: MOVE_DURATION_MS,
        endsAt: endsAt
      });

      console.log(`🚶 [МИР] ${userId} начал переход (${pos.x},${pos.y}) → (${newX},${newY}) за ${MOVE_DURATION_MS / 1000}с`);

        const timerId = setTimeout(async () => {
        try {
            const currentPos = await getPlayerPosition(userId);
            if (currentPos.x !== pos.x || currentPos.y !== pos.y) {
            console.log(`⚠️ [МИР] Позиция изменилась — переход отменён`);
            activeMoves.delete(nUserId);
            // 🔥 ФИКС: всё равно уведомляем клиента, чтобы модалка закрылась
            socket.emit('world_move_completed', { x: currentPos.x, y: currentPos.y, cancelled: true });
            return;
            }

            await sb.from('player_position').update({
            x: newX, y: newY, updated_at: new Date().toISOString()
            }).eq('user_id', nUserId);

            console.log(`✅ [МИР] ${userId} прибыл в (${newX},${newY})`);

            socket.emit('world_move_completed', { x: newX, y: newY });
            socket.emit('world_get_map', { userId: nUserId });
            
            activeMoves.delete(nUserId);
        } catch (err) {
            console.error("🚨 Ошибка завершения перехода:", err.message);
            activeMoves.delete(nUserId);
            // 🔥 ФИКС: даже при ошибке уведомляем клиента
            socket.emit('world_move_completed', { x: pos.x, y: pos.y, error: true });
        }
        }, MOVE_DURATION_MS);

      activeMoves.set(nUserId, {
        endsAt, dx, dy,
        targetX: newX, targetY: newY,
        timerId
      });

    } catch (err) {
      console.error("🚨 Ошибка world_move_start:", err.message);
      if (nUserId) activeMoves.delete(nUserId);
    }
  });

  // --------------------------------------------------------------------------
  // 3. ОТМЕНА ПЕРЕХОДА
  // --------------------------------------------------------------------------
  socket.on('world_move_cancel', async ({ userId }) => {
    const nUserId = Number(userId);
    const move = activeMoves.get(nUserId);
    if (!move) return;

    if (move.timerId) clearTimeout(move.timerId);
    activeMoves.delete(nUserId);
    socket.emit('world_move_cancelled');
    console.log(`🚫 [МИР] ${userId} отменил переход`);
  });

  // --------------------------------------------------------------------------
  // 4. ПЕРЕХОД ЧЕРЕЗ ПОРТАЛ
  // --------------------------------------------------------------------------
  socket.on('world_teleport', async ({ userId }) => {
    try {
      const pos = await getPlayerPosition(userId);

      const { data: tile } = await sb
        .from('world_tiles').select('portal_to')
        .eq('map_id', pos.current_map_id).eq('x', pos.x).eq('y', pos.y).maybeSingle();

      if (!tile || !tile.portal_to) {
        return socket.emit('error', 'Здесь нет портала');
      }

      const { data: targetMap } = await sb
        .from('world_maps').select('id, name, width, height')
        .eq('id', tile.portal_to).maybeSingle();
      if (!targetMap) return socket.emit('error', 'Целевая карта не найдена');

      const newX = Math.floor(targetMap.width / 2);
      const newY = Math.floor(targetMap.height / 2);

      await sb.from('player_position').update({
        current_map_id: tile.portal_to,
        x: newX, y: newY,
        updated_at: new Date().toISOString()
      }).eq('user_id', Number(userId));

      console.log(`🌀 [МИР] ${userId} телепортирован в ${tile.portal_to}`);

      socket.emit('world_get_map', { userId });
      socket.emit('world_teleported', {
        mapId: tile.portal_to,
        mapName: targetMap.name
      });
    } catch (err) {
      console.error("🚨 Ошибка world_teleport:", err.message);
    }
  });

  // --------------------------------------------------------------------------
  // 5. СБОР РЕСУРСА
  // --------------------------------------------------------------------------
  socket.on('world_gather', async ({ userId }) => {
    try {
      const pos = await getPlayerPosition(userId);

      const { data: resource } = await sb
        .from('world_resources').select('*')
        .eq('map_id', pos.current_map_id).eq('x', pos.x).eq('y', pos.y).maybeSingle();

      if (!resource || !resource.resource_id) {
        return socket.emit('error', 'Здесь нечего собирать');
      }

      const resourceData = RESOURCES_DB[resource.resource_id];
      if (!resourceData) return socket.emit('error', 'Неизвестный ресурс');

      const { data: playerRow } = await sb
        .from('players').select('inventory').eq('id', Number(userId)).maybeSingle();

      let inventory = playerRow?.inventory || { equipment: [], resources: [], consumables: [] };
      if (!inventory.resources) inventory.resources = [];

      const stack = inventory.resources.find(r => r.id === resource.resource_id);
      if (stack) {
        stack.count = (stack.count || 1) + 1;
      } else {
        inventory.resources.push({ id: resource.resource_id, count: 1 });
      }

      const respawnAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await sb.from('world_resources').update({
        resource_id: null, respawn_at: respawnAt
      }).eq('id', resource.id);

      await sb.from('players').update({ inventory }).eq('id', Number(userId));

      console.log(`🌿 [МИР] ${userId} собрал ${resourceData.name}`);

      socket.emit('world_gathered', {
        resourceId: resource.resource_id,
        resourceName: resourceData.name,
        resourceIcon: resourceData.icon
      });

      socket.emit('world_get_map', { userId });
    } catch (err) {
      console.error("🚨 Ошибка world_gather:", err.message);
    }
  });

  // --------------------------------------------------------------------------
  // 6. АТАКА МОБА
  // --------------------------------------------------------------------------
  socket.on('world_attack', async ({ userId, monsterId }) => {
    try {
      const pos = await getPlayerPosition(userId);
      const { data: monster } = await sb
        .from('world_monsters').select('*').eq('id', monsterId).maybeSingle();
      if (!monster) return socket.emit('error', 'Моб не найден');

      // 🔥 ФИКС: атаковать можно ТОЛЬКО моба на своей клетке
      if (monster.x !== pos.x || monster.y !== pos.y) {
        return socket.emit('error', '⚔️ Моб не на вашей клетке! Сначала перейдите к нему.');
      }

      const { data: botBase } = await sb
        .from('bots').select('*').eq('id', monster.monster_id).maybeSingle();
      if (!botBase) return socket.emit('error', 'База моба не найдена');

      const statMultiplier = 1 + ((monster.level - 1) * 0.20);

      const monsterStats = {
        id: botBase.id,
        name: `${botBase.name} ${monster.level} ур.`,
        icon: botBase.icon,
        level: monster.level,
        strength: Math.floor(Number(botBase.strength || 1) * statMultiplier),
        agility: Math.floor(Number(botBase.agility || 1) * statMultiplier),
        endurance: Math.floor(Number(botBase.endurance || 1) * statMultiplier),
        luck: Math.floor(Number(botBase.luck || 1) * statMultiplier),
        rewardXp: Math.floor(Number(botBase.reward_xp || 5) * statMultiplier),
        rewardGold: Math.floor(Number(botBase.reward_gold || 2) * statMultiplier)
      };

      console.log(`⚔️ [МИР] ${userId} атакует ${monsterStats.name}`);

      socket.emit('world_monster_data', {
        monster: monsterStats,
        worldMonsterId: monster.id,
        x: monster.x, y: monster.y
      });
    } catch (err) {
      console.error("🚨 Ошибка world_attack:", err.message);
    }
  });

  // --------------------------------------------------------------------------
  // 7. DISCONNECT — сброс блокировки перехода
  // --------------------------------------------------------------------------
    socket.on('disconnect', () => {
    // 🔥 НЕ удаляем переход при disconnect — игрок может вернуться через F5
    // Переход завершится сам по таймеру, и позиция обновится в БД
    const nUserId = Number(socket.data?.userId);
    if (nUserId) {
        console.log(`❌ [МИР] Сокет игрока ${nUserId} отключён, но переход продолжается`);
    }
    });

};