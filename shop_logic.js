// ============================================================================
// ===== 🛒 ИЗОЛИРОВАННЫЙ БЕЗОПАСНЫЙ СЕРВЕРНЫЙ МОДУЛЬ МАГАЗИНА (SHOP_LOGIC.JS) =====
// ============================================================================

const dbHelper = require('./db_helper');

// 🔥 СЕРВЕРНЫЙ КАТАЛОГ МАГАЗИНА (SHOP_LOGIC.JS) — ВСЕ 3 КЛАССА НА 10 УРОВНЕЙ
const SERVER_SHOP_DATABASE = {
  // Уровень 1 — Сет Плута
  'rogue_knife_1':     { price: 10,  level: 1, type: 'equipment', slotType: 'mainHand' },
  'rogue_bandana_1':   { price: 8,   level: 1, type: 'equipment', slotType: 'head' },
  'rogue_vest_1':      { price: 12,  level: 1, type: 'equipment', slotType: 'body' },
  'rogue_boots_1':     { price: 8,   level: 1, type: 'equipment', slotType: 'legs' },
  'rogue_wraps_1':     { price: 6,   level: 1, type: 'equipment', slotType: 'gloves' },
  'rogue_ring_1':      { price: 10,  level: 1, type: 'equipment', slotType: 'ring' },

  // Уровень 2 — Сет Бродяги
  'bandit_dagger_2':   { price: 25,  level: 2, type: 'equipment', slotType: 'mainHand' },
  'bandit_hood_2':     { price: 18,  level: 2, type: 'equipment', slotType: 'head' },
  'bandit_jacket_2':   { price: 30,  level: 2, type: 'equipment', slotType: 'body' },
  'bandit_boots_2':    { price: 18,  level: 2, type: 'equipment', slotType: 'legs' },
  'bandit_gloves_2':   { price: 14,  level: 2, type: 'equipment', slotType: 'gloves' },
  'bandit_ring_2':     { price: 20,  level: 2, type: 'equipment', slotType: 'ring' },

  // Уровень 3 — Сет Вора
  'thief_blade_3':     { price: 50,  level: 3, type: 'equipment', slotType: 'mainHand' },
  'thief_mask_3':      { price: 35,  level: 3, type: 'equipment', slotType: 'head' },
  'thief_armor_3':     { price: 60,  level: 3, type: 'equipment', slotType: 'body' },
  'thief_shoes_3':     { price: 35,  level: 3, type: 'equipment', slotType: 'legs' },
  'thief_bracers_3':   { price: 28,  level: 3, type: 'equipment', slotType: 'gloves' },
  'thief_signet_3':    { price: 40,  level: 3, type: 'equipment', slotType: 'ring' },

  // Уровень 4 — Сет Наемника
  'mercenary_kris_4':  { price: 90,  level: 4, type: 'equipment', slotType: 'mainHand' },
  'mercenary_cap_4':   { price: 65,  level: 4, type: 'equipment', slotType: 'head' },
  'mercenary_coat_4':  { price: 110, level: 4, type: 'equipment', slotType: 'body' },
  'mercenary_boots_4': { price: 65,  level: 4, type: 'equipment', slotType: 'legs' },
  'mercenary_gloves_4':{ price: 50,  level: 4, type: 'equipment', slotType: 'gloves' },
  'mercenary_loop_4':  { price: 75,  level: 4, type: 'equipment', slotType: 'ring' },

  // Уровень 5 — Сет Ассасина
  'assassin_stiletto_5':{ price: 160, level: 5, type: 'equipment', slotType: 'mainHand' },
  'assassin_cowl_5':   { price: 120, level: 5, type: 'equipment', slotType: 'head' },
  'assassin_shroud_5': { price: 190, level: 5, type: 'equipment', slotType: 'body' },
  'assassin_boots_5':  { price: 120, level: 5, type: 'equipment', slotType: 'legs' },
  'assassin_grips_5':  { price: 95,  level: 5, type: 'equipment', slotType: 'gloves' },
  'assassin_band_5':   { price: 130, level: 5, type: 'equipment', slotType: 'ring' },

  // Уровень 6 — Сет Сталкера
  'stalker_fang_6':    { price: 240, level: 6, type: 'equipment', slotType: 'mainHand' },
  'stalker_goggles_6': { price: 180, level: 6, type: 'equipment', slotType: 'head' },
  'stalker_harness_6': { price: 290, level: 6, type: 'equipment', slotType: 'body' },
  'stalker_treads_6':  { price: 180, level: 6, type: 'equipment', slotType: 'legs' },
  'stalker_claws_6':   { price: 140, level: 6, type: 'equipment', slotType: 'gloves' },
  'stalker_eye_6':     { price: 200, level: 6, type: 'equipment', slotType: 'ring' },

  // Уровень 7 — Сет Тени
  'shadow_wakizashi_7':{ price: 360, level: 7, type: 'equipment', slotType: 'mainHand' },
  'shadow_visage_7':   { price: 270, level: 7, type: 'equipment', slotType: 'head' },
  'shadow_garb_7':     { price: 420, level: 7, type: 'equipment', slotType: 'body' },
  'shadow_boots_7':    { price: 270, level: 7, type: 'equipment', slotType: 'legs' },
  'shadow_hands_7':    { price: 210, level: 7, type: 'equipment', slotType: 'gloves' },
  'shadow_seal_7':     { price: 300, level: 7, type: 'equipment', slotType: 'ring' },

  // Уровень 8 — Сет Призрака
  'phantom_edge_8':    { price: 500, level: 8, type: 'equipment', slotType: 'mainHand' },
  'phantom_hood_8':    { price: 380, level: 8, type: 'equipment', slotType: 'head' },
  'phantom_robes_8':   { price: 580, level: 8, type: 'equipment', slotType: 'body' },
  'phantom_mist_8':    { price: 380, level: 8, type: 'equipment', slotType: 'legs' },
  'phantom_touch_8':   { price: 300, level: 8, type: 'equipment', slotType: 'gloves' },
  'phantom_coil_8':    { price: 420, level: 8, type: 'equipment', slotType: 'ring' },

  // Уровень 9 — Сет Ветра
  'gale_scimitar_9':   { price: 720, level: 9, type: 'equipment', slotType: 'mainHand' },
  'gale_crown_9':      { price: 520, level: 9, type: 'equipment', slotType: 'head' },
  'gale_cuirass_9':    { price: 850, level: 9, type: 'equipment', slotType: 'body' },
  'gale_greaves_9':    { price: 520, level: 9, type: 'equipment', slotType: 'legs' },
  'gale_gauntlets_9':  { price: 410, level: 9, type: 'equipment', slotType: 'gloves' },
  'gale_cyclone_9':    { price: 600, level: 9, type: 'equipment', slotType: 'ring' },

  // Уровень 10 — Сет Мастера Уворотчика (Грандмастер)
  'grandmaster_kris_10':{ price: 1000, level: 10, type: 'equipment', slotType: 'mainHand' },
  'grandmaster_mask_10':{ price: 800,  level: 10, type: 'equipment', slotType: 'head' },
  'grandmaster_gi_10':  { price: 1200, level: 10, type: 'equipment', slotType: 'body' },
  'grandmaster_tabi_10':{ price: 800,  level: 10, type: 'equipment', slotType: 'legs' },
  'grandmaster_gloves_10':{ price: 650, level: 10, type: 'equipment', slotType: 'gloves' },
  'grandmaster_ring_10':{ price: 900,  level: 10, type: 'equipment', slotType: 'ring' }
};

module.exports = function(io, socket, sb) {
  const triggerLoadGameSuccess = dbHelper.triggerLoadGameSuccess;

  // ОБРАБОТЧИК: АБСОЛЮТНО ЗАЩИЩЕННАЯ ПОКУПКА В МАГАЗИНЕ С АНТИ-ХАКОМ ЦЕН
  socket.on('buy_item_secure', async ({ userId, itemId }) => {
    try {
      const nUserId = Number(userId);
      
      // 1. Проверяем, существует ли вообще такой товар на сервере
      const itemConfig = SERVER_SHOP_DATABASE[itemId];
      if (!itemConfig) {
        return socket.emit('shop_buy_error', { message: "🚨 Товар не существует в каталоге магазина!" });
      }

      console.log(`🛒 [МАГАЗИН ЗАПРОС] Игрок ID ${nUserId} пытается купить предмет: ${itemId}`);

      // 2. Достаем свежие данные игрока напрямую из базы (Защита от подмены баланса на телефоне)
      const { data: playerRow, error: dbError } = await sb.from('players')
        .select('*')
        .eq('id', nUserId)
        .maybeSingle();

      if (dbError || !playerRow) {
        return socket.emit('shop_buy_error', { message: "🚨 Не удалось связаться с базой данных профиля." });
      }

      // Безопасное чтение текущего золота и уровня игрока из БД
      const currentGold = Number(playerRow.gold ?? 0);
      const currentLevel = Number(playerRow.level ?? 1);

      // 3. АУДИТ БАЛАНСА И ТРЕБОВАНИЙ УРОВНЯ
      if (currentGold < itemConfig.price) {
        return socket.emit('shop_buy_error', { message: `❌ Недостаточно золота! Нужно: 💰${itemConfig.price}, у вас: 💰${currentGold}` });
      }
      if (currentLevel < itemConfig.level) {
        return socket.emit('shop_buy_error', { message: `❌ Слишком низкий уровень! Требуется: Lv. ${itemConfig.level}, у вас: Lv. ${currentLevel}` });
      }

      // 4. МОДИФИКАЦИЯ ИНВЕНТАРЯ В ОЗУ СЕРВЕРА
      let inventory = playerRow.inventory || { equipment: [], consumables: [], resources: [] };
      if (!inventory.equipment) inventory.equipment = [];

      // Генерируем уникальный UUID для вещи, чтобы можно было купить 2 одинаковых меча
      const newInstance = {
        uuid: `${itemId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        id: itemId
      };
      
      inventory.equipment.push(newInstance);
      const updatedGold = currentGold - itemConfig.price;

      // 5. СОХРАНЕНИЕ ОЧИЩЕННОЙ ТРАНЗАКЦИИ В SUPABASE
      const { error: updateError } = await sb.from('players')
        .update({
          gold: updatedGold,
          inventory: inventory
        })
        .eq('id', nUserId);

      if (updateError) {
        console.error(`❌ Ошибка финализации покупки в БД для ID ${nUserId}:`, updateError.message);
        return socket.emit('shop_buy_error', { message: "🚨 Ошибка записи данных в облако." });
      }

      console.log(`✨ [МАГАЗИН УСПЕХ] Предмет ${itemId} успешно выдан игроку ID ${nUserId}. Списано: 💰${itemConfig.price}`);

      // 6. СИНХРОНИЗАЦИЯ: Шлем клиенту сигнал об успехе и принудительно обновляем его профиль в городе
      socket.emit('shop_buy_success', { message: "🎉 Предмет успешно куплен и добавлен в рюкзак!" });
      
      // Принудительно пушим свежие данные золота и инвентаря на фронтенд
      await triggerLoadGameSuccess(nUserId, socket, sb);

    } catch (err) {
      console.error("❌ Критический сбой внутри buy_item_secure:", err);
      socket.emit('shop_buy_error', { message: "🚨 Внутренняя ошибка сервера при обработке покупки." });
    }
  });
};