// ============================================================================
// ===== 🏰 СЕРВЕРНАЯ ЛОГИКА БАШНИ (TOWER_LOGIC.JS) — v2 =====
// ===== КД + авторизация + лавка. Создание боя теперь через battle_start =====
// ============================================================================

const dbHelper = require('../db_helper');
const { TOWER_SHOP_DATABASE } = require('./tower_config');

module.exports = function(io, socket, sb, activeRooms) {
  if (!socket) return;

  const triggerLoadGameSuccess = dbHelper.triggerLoadGameSuccess;

  // ==========================================================================
  // 1. ПРОВЕРКА КД БАШНИ
  // ==========================================================================
  socket.on('check_tower_cooldown_request', async ({ userId }) => {
    try {
      const nUserId = Number(userId);
      const { data: timerRow } = await sb.from('player_timers')
        .select('ends_at')
        .eq('user_id', nUserId)
        .eq('timer_type', 'tower_cooldown')
        .maybeSingle();

      if (timerRow && new Date(timerRow.ends_at) > new Date()) {
        socket.emit('tower_cooldown_status', { active: true, ends_at: timerRow.ends_at });
      } else {
        if (timerRow) {
          await sb.from('player_timers')
            .delete()
            .eq('user_id', nUserId)
            .eq('timer_type', 'tower_cooldown');
        }
        socket.emit('tower_cooldown_status', { active: false });
      }
    } catch (err) {
      console.error("🚨 Ошибка проверки КД в Башне:", err.message);
    }
  });

  // ==========================================================================
  // 2. АВТОРИЗАЦИЯ СОКЕТА БАШНИ
  // ==========================================================================
  socket.on('load_tower_game_secure', async ({ userId, username }) => {
    console.log(`🔐 [🏰 БАШНЯ АВТОРИЗАЦИЯ] ${username} (${userId})`);
    try {
      const nUserId = Number(userId);
      const { data: dbPlayer } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();

      if (dbPlayer) {
        const currentXp = dbHelper.safeReadField(dbPlayer, 'xp', 0);
        const cloudLevel = dbHelper.getServerCorrectLevelByXp(currentXp);
        let pointsKey = dbPlayer.statpoints !== undefined ? 'statpoints' : 'statPoints';

        const playerProfile = {
          id: dbPlayer.id,
          name: dbPlayer.name,
          avatar: dbPlayer.avatar || "assets/avatars/hero1.png",
          level: cloudLevel,
          gold: dbHelper.safeReadField(dbPlayer, 'gold', 0),
          xp: currentXp,
          hp: dbHelper.safeReadField(dbPlayer, 'hp', 10),
          statPoints: dbHelper.safeReadField(dbPlayer, pointsKey, 0),
          currentTownIndex: dbHelper.safeReadField(dbPlayer, 'currenttownindex', 0),
          tower_floor: dbHelper.safeReadField(dbPlayer, 'tower_floor', 1),
          tower_coins: dbHelper.safeReadField(dbPlayer, 'tower_coins', 0),
          stats: {
            strength: dbHelper.safeReadField(dbPlayer, 'strength', 1),
            agility: dbHelper.safeReadField(dbPlayer, 'agility', 1),
            endurance: dbHelper.safeReadField(dbPlayer, 'endurance', 1),
            luck: dbHelper.safeReadField(dbPlayer, 'luck', 1)
          },
          inventory: dbPlayer.inventory || { equipment: [], resources: [], consumables: [] },
          equipped: dbPlayer.equipped || { rings: [null, null, null] }
        };

        socket.emit('tower_load_game_success', { player: playerProfile });
      }
    } catch (err) {
      console.error("🚨 Ошибка сокет-авторизации Башни:", err.message);
    }
  });

  // ==========================================================================
  // 3. ЛАВКА БАШНИ
  // ==========================================================================
  socket.on('buy_tower_shop_item_secure', async ({ userId, itemId }) => {
    try {
      const nUserId = Number(userId);
      const itemConfig = TOWER_SHOP_DATABASE[itemId];
      if (!itemConfig) return socket.emit('tower_shop_error', { message: "🚨 Предмет отсутствует!" });

      const { data: playerRow } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();

      const currentCoins = Number(playerRow.tower_coins ?? 0);
      if (currentCoins < itemConfig.price) {
        return socket.emit('tower_shop_error', {
          message: `❌ Мало монет Башни! Нужно: ${itemConfig.price}, у вас: ${currentCoins}`
        });
      }

      let inventory = playerRow.inventory || { equipment: [], consumables: [], resources: [] };
      if (itemConfig.type === 'consumable') {
        const existing = inventory.consumables.find(c => c.id === itemId);
        if (existing) existing.count = (existing.count || 1) + 1;
        else inventory.consumables.push({ id: itemId, count: 1 });
      } else {
        inventory.equipment.push({ uuid: `${itemId}_tower_${Date.now()}`, id: itemId });
      }

      await sb.from('players').update({
        tower_coins: currentCoins - itemConfig.price,
        inventory: inventory
      }).eq('id', nUserId);

      // 🔥 Свежий профиль в БАШНЮ
      const { data: freshDb } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
      if (freshDb) {
        const currentXp = dbHelper.safeReadField(freshDb, 'xp', 0);
        const cloudLevel = dbHelper.getServerCorrectLevelByXp(currentXp);
        let pointsKey = freshDb.statpoints !== undefined ? 'statpoints' : 'statPoints';

        const freshProfile = {
          id: freshDb.id,
          name: freshDb.name,
          avatar: freshDb.avatar || "assets/avatars/hero1.png",
          level: cloudLevel,
          gold: dbHelper.safeReadField(freshDb, 'gold', 0),
          xp: currentXp,
          hp: dbHelper.safeReadField(freshDb, 'hp', 10),
          statPoints: dbHelper.safeReadField(freshDb, pointsKey, 0),
          currentTownIndex: dbHelper.safeReadField(freshDb, 'currenttownindex', 0),
          tower_floor: dbHelper.safeReadField(freshDb, 'tower_floor', 1),
          tower_coins: dbHelper.safeReadField(freshDb, 'tower_coins', 0),
          stats: {
            strength: dbHelper.safeReadField(freshDb, 'strength', 1),
            agility: dbHelper.safeReadField(freshDb, 'agility', 1),
            endurance: dbHelper.safeReadField(freshDb, 'endurance', 1),
            luck: dbHelper.safeReadField(freshDb, 'luck', 1)
          },
          inventory: freshDb.inventory || { equipment: [], resources: [], consumables: [] },
          equipped: freshDb.equipped || { rings: [null, null, null] }
        };
        socket.emit('tower_load_game_success', { player: freshProfile });
      }

      socket.emit('tower_shop_success', { message: `🎉 Куплено за ${itemConfig.price} монет Башни!` });
    } catch (err) {
      socket.emit('tower_shop_error', { message: `🚨 Ошибка: ${err.message}` });
    }
  });

  // ⚠️ [УДАЛЕНО] socket.on('start_tower_battle_secure', ...)
  // =========================================================================
  // Бой Башни теперь запускается через:
  //   1. tower_client.js → редирект на battle.html?battleType=tower&floor=N
  //   2. battle_handlers.js → battle_start с battleType: 'tower'
  // =========================================================================
};