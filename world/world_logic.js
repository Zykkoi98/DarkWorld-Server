// ============================================================================
// ===== 🗺️ СЕРВЕРНАЯ ЛОГИКА КАРТЫ МИРА (WORLD_LOGIC.JS) =====
// ============================================================================

const { WORLD_REGIONS, RESOURCES_DB, BUILDINGS_DB } = require('./world_config');

// Радиус обзора (окно 7×7 вокруг игрока)
const VIEW_RADIUS = 3;

module.exports = function(io, socket, sb, activeRooms) {
  if (!socket) return;

  // --------------------------------------------------------------------------
  // 🔥 ХЕЛПЕР: Получить позицию игрока из БД (или создать дефолтную)
  // --------------------------------------------------------------------------
  async function getPlayerPosition(userId) {
    const { data } = await sb
      .from('player_position')
      .select('*')
      .eq('user_id', Number(userId))
      .maybeSingle();

    if (data) return data;

    // Если нет записи — создаём дефолтную
    const defaultPos = {
      user_id: Number(userId),
      current_map_id: 'ashenvale_main',
      x: 25,
      y: 25,
      updated_at: new Date().toISOString()
    };

    await sb.from('player_position').insert(defaultPos);
    return defaultPos;
  }

  // --------------------------------------------------------------------------
  // 🔥 ХЕЛПЕР: Получить онлайн-игроков на карте
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
        x: p.x,
        y: p.y
      };
    });
  }

  // --------------------------------------------------------------------------
  // 1. ЗАПРОС КАРТЫ (окно 7×7 вокруг игрока)
  // --------------------------------------------------------------------------
  socket.on('world_get_map', async ({ userId }) => {
    try {
      const pos = await getPlayerPosition(userId);
      const mapId = pos.current_map_id;
      const cx = pos.x;
      const cy = pos.y;

      // Запрашиваем клетки, ресурсы, мобов в радиусе
      const xMin = Math.max(0, cx - VIEW_RADIUS);
      const xMax = cx + VIEW_RADIUS;
      const yMin = Math.max(0, cy - VIEW_RADIUS);
      const yMax = cy + VIEW_RADIUS;

      const [tilesRes, resourcesRes, monstersRes, players] = await Promise.all([
        sb.from('world_tiles')
          .select('*')
          .eq('map_id', mapId)
          .gte('x', xMin).lte('x', xMax)
          .gte('y', yMin).lte('y', yMax),
        sb.from('world_resources')
          .select('*')
          .eq('map_id', mapId)
          .gte('x', xMin).lte('x', xMax)
          .gte('y', yMin).lte('y', yMax),
        sb.from('world_monsters')
          .select('*')
          .eq('map_id', mapId)
          .gte('x', xMin).lte('x', xMax)
          .gte('y', yMin).lte('y', yMax),
        getOnlinePlayersOnMap(mapId, userId)
      ]);

      // Собираем всё в один пакет
      socket.emit('world_map_data', {
        mapId,
        myX: cx,
        myY: cy,
        tiles: tilesRes.data || [],
        resources: resourcesRes.data || [],
        monsters: monstersRes.data || [],
        players: players,
        resourcesDB: RESOURCES_DB,
        regionsDB: WORLD_REGIONS,
        buildingsDB: BUILDINGS_DB
      });

      console.log(`🗺️ [МИР] ${userId} запросил карту (${cx}, ${cy})`);
    } catch (err) {
      console.error("🚨 Ошибка world_get_map:", err.message);
      socket.emit('error', 'Ошибка загрузки карты мира');
    }
  });

  // --------------------------------------------------------------------------
  // 2. ДВИЖЕНИЕ ИГРОКА
  // --------------------------------------------------------------------------
  socket.on('world_move', async ({ userId, dx, dy }) => {
    try {
      const pos = await getPlayerPosition(userId);
      const mapId = pos.current_map_id;
      const newX = pos.x + dx;
      const newY = pos.y + dy;

      // Проверка границ карты
      const { data: mapInfo } = await sb
        .from('world_maps')
        .select('width, height')
        .eq('id', mapId)
        .maybeSingle();

      if (!mapInfo) return socket.emit('error', 'Карта не найдена');

      if (newX < 0 || newX >= mapInfo.width || newY < 0 || newY >= mapInfo.height) {
        return socket.emit('world_move_blocked', { reason: 'За границей карты' });
      }

      // Проверка: не заблокирована ли клетка
      const { data: tile } = await sb
        .from('world_tiles')
        .select('is_blocked, building, portal_to')
        .eq('map_id', mapId)
        .eq('x', newX)
        .eq('y', newY)
        .maybeSingle();

      if (!tile) return socket.emit('error', 'Клетка не существует');

      if (tile.is_blocked) {
        return socket.emit('world_move_blocked', { reason: 'Клетка непроходима' });
      }

      // Обновляем позицию игрока
      await sb.from('player_position').update({
        x: newX, y: newY, updated_at: new Date().toISOString()
      }).eq('user_id', Number(userId));

      console.log(`🚶 [МИР] ${userId} двинулся с (${pos.x},${pos.y}) на (${newX},${newY})`);

      // Отправляем игроку новую карту
      socket.emit('world_get_map', { userId });

      // Оповещаем ВСЕХ онлайн-игроков на этой карте, что игрок сдвинулся
      if (global.onlinePlayers) {
        for (const [otherUserId, player] of global.onlinePlayers.entries()) {
          if (String(otherUserId) === String(userId)) continue;
          player.socketIds.forEach(sId => {
            io.to(sId).emit('world_player_moved', {
              user_id: Number(userId),
              x: newX, y: newY
            });
          });
        }
      }

      // Если на клетке портал — сообщаем игроку
      if (tile.portal_to) {
        socket.emit('world_portal_found', {
          portal_to: tile.portal_to
        });
      }

      // Если на клетке строение — сообщаем
      if (tile.building) {
        socket.emit('world_building_found', {
          building: tile.building,
          buildingData: BUILDINGS_DB[tile.building] || null
        });
      }

    } catch (err) {
      console.error("🚨 Ошибка world_move:", err.message);
    }
  });

  // --------------------------------------------------------------------------
  // 3. ПЕРЕХОД ЧЕРЕЗ ПОРТАЛ (смена карты)
  // --------------------------------------------------------------------------
  socket.on('world_teleport', async ({ userId }) => {
    try {
      const pos = await getPlayerPosition(userId);

      const { data: tile } = await sb
        .from('world_tiles')
        .select('portal_to')
        .eq('map_id', pos.current_map_id)
        .eq('x', pos.x)
        .eq('y', pos.y)
        .maybeSingle();

      if (!tile || !tile.portal_to) {
        return socket.emit('error', 'Здесь нет портала');
      }

      // Проверяем, что целевая карта существует
      const { data: targetMap } = await sb
        .from('world_maps')
        .select('id, name, width, height')
        .eq('id', tile.portal_to)
        .maybeSingle();

      if (!targetMap) return socket.emit('error', 'Целевая карта не найдена');

      // Находим точку входа на новой карте (центр)
      const newX = Math.floor(targetMap.width / 2);
      const newY = Math.floor(targetMap.height / 2);

      await sb.from('player_position').update({
        current_map_id: tile.portal_to,
        x: newX, y: newY,
        updated_at: new Date().toISOString()
      }).eq('user_id', Number(userId));

      console.log(`🌀 [МИР] ${userId} телепортирован в ${tile.portal_to} (${newX},${newY})`);

      // Отдаём новую карту
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
  // 4. СБОР РЕСУРСА
  // --------------------------------------------------------------------------
  socket.on('world_gather', async ({ userId }) => {
    try {
      const pos = await getPlayerPosition(userId);

      // Ищем ресурс на клетке, где стоит игрок
      const { data: resource } = await sb
        .from('world_resources')
        .select('*')
        .eq('map_id', pos.current_map_id)
        .eq('x', pos.x)
        .eq('y', pos.y)
        .maybeSingle();

      if (!resource || !resource.resource_id) {
        return socket.emit('error', 'Здесь нечего собирать');
      }

      const resourceData = RESOURCES_DB[resource.resource_id];
      if (!resourceData) return socket.emit('error', 'Неизвестный ресурс');

      // Получаем текущий инвентарь
      const { data: playerRow } = await sb
        .from('players')
        .select('inventory')
        .eq('id', Number(userId))
        .maybeSingle();

      let inventory = playerRow?.inventory || { equipment: [], resources: [], consumables: [] };
      if (!inventory.resources) inventory.resources = [];

      // Ищем стак
      const stack = inventory.resources.find(r => r.id === resource.resource_id);
      if (stack) {
        stack.count = (stack.count || 1) + 1;
      } else {
        inventory.resources.push({ id: resource.resource_id, count: 1 });
      }

      // Убираем ресурс с карты (респавн через 5 минут)
      const respawnAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await sb.from('world_resources').update({
        resource_id: null,
        respawn_at: respawnAt
      }).eq('id', resource.id);

      // Сохраняем инвентарь
      await sb.from('players').update({ inventory }).eq('id', Number(userId));

      console.log(`🌿 [МИР] ${userId} собрал ${resourceData.name}`);

      socket.emit('world_gathered', {
        resourceId: resource.resource_id,
        resourceName: resourceData.name,
        resourceIcon: resourceData.icon
      });

      // Обновляем карту
      socket.emit('world_get_map', { userId });
    } catch (err) {
      console.error("🚨 Ошибка world_gather:", err.message);
    }
  });

  // --------------------------------------------------------------------------
  // 5. АТАКА МОБА (пока заглушка — вызовем бой позже)
  // --------------------------------------------------------------------------
  socket.on('world_attack', async ({ userId, monsterId }) => {
    try {
      const { data: monster } = await sb
        .from('world_monsters')
        .select('*')
        .eq('id', monsterId)
        .maybeSingle();

      if (!monster) return socket.emit('error', 'Моб не найден');

      // Получаем базовые статы моба из bots
      const { data: botBase } = await sb
        .from('bots')
        .select('*')
        .eq('id', monster.monster_id)
        .maybeSingle();

      if (!botBase) return socket.emit('error', 'База моба не найдена');

      // Множитель по уровню
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

      // Пока отправляем данные — позже подключим к бою
      socket.emit('world_monster_data', {
        monster: monsterStats,
        worldMonsterId: monster.id,
        x: monster.x,
        y: monster.y
      });
    } catch (err) {
      console.error("🚨 Ошибка world_attack:", err.message);
    }
  });

};