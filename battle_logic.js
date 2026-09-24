const dbHelper = require('./db_helper');
const GAME_ITEMS_DATABASE = require('./shop/shop_items_config'); 

const ZONE_NAMES = { head: "Голову", breast: "Грудь", torso: "Торс", belt: "Пояс", legs: "Ноги" };

// Умная проверка: является ли предмет в левой руке щитом по данным из shop_items_config
function isShield(itemId) {
  if (!itemId) return false;
  
  // Ищем предмет в нашей глобальной базе данных предметов из папки shop
  const itemData = global.SERVER_SHOP_DATABASE ? global.SERVER_SHOP_DATABASE[itemId] : null;
  
  if (itemData && itemData.name) {
    const name = itemData.name.toLowerCase();
    // Если в красивом русском названии вещи есть "щит", "баклер" или "эгида" — это щит!
    return name.includes('щит') || name.includes('баклер') || name.includes('эгида');
  }
  
  // Подстраховка по системному ID, если база еще не прогрузилась
  const id = itemId.toLowerCase();
  return id.includes('shield') || id.includes('buckler') || id.includes('aegis') || id.includes('screen') || id.includes('mirror') || id.includes('wall');
}
//ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ:
// Вспомогательная функция сбора бонусов экипировки для расчета боя
function getEquipmentBonus(equipped, bonusKey) {
  if (!equipped) return 0;
  let totalBonus = 0;
  const slots = ['head', 'body', 'legs', 'gloves', 'neck', 'mainHand', 'offHand', 'extra', 'potion', 'scroll'];
  
  slots.forEach(slot => {
    const itemId = equipped[slot];
    if (!itemId) return;

    // 🔥 ФИКС: Ищем предмет сначала в старой базе, а затем в нашем новом глобальном конфиге
    let item =  GAME_ITEMS_DATABASE[itemId];

    if (item) {
      // Проверяем старый формат (если статы лежат на верхнем уровне объекта)
      if (item[bonusKey] !== undefined) totalBonus += item[bonusKey];
      
      // 🔥 Проверяем новый формат (если статы лежат внутри объекта bonus, как на фронтенде)
      if (item.bonus) {
        if (item.bonus[bonusKey] !== undefined) totalBonus += item.bonus[bonusKey];
        if (item.bonus.stats && item.bonus.stats[bonusKey] !== undefined) {
          totalBonus += item.bonus.stats[bonusKey];
        }
      }
    }
  });

  // Обсчет колец в слотах бижутерии
  if (equipped.rings && Array.isArray(equipped.rings)) {
    equipped.rings.forEach(itemId => {
      if (!itemId) return;
      let item =  GAME_ITEMS_DATABASE[itemId];
      if (item) {
        if (item[bonusKey] !== undefined) totalBonus += item[bonusKey];
        if (item.bonus) {
          if (item.bonus[bonusKey] !== undefined) totalBonus += item.bonus[bonusKey];
          if (item.bonus.stats && item.bonus.stats[bonusKey] !== undefined) {
            totalBonus += item.bonus.stats[bonusKey];
          }
        }
      }
    });
  }
  return totalBonus;
}
// 🔥 ГЛОБАЛЬНАЯ СЕРВЕРНАЯ ФУНКЦИЯ АВТОДОПОЛНЕНИЯ БАНОК ПОСЛЕ ЛЮБОГО БОЯ (PvE и PvP)
function autoRefillPotionsAfterBattle(playerRow) {
  try {
    if (playerRow && playerRow.equipped && playerRow.inventory && playerRow.inventory.consumables) {
      let equipped = playerRow.equipped;
      let consumables = playerRow.inventory.consumables;
      const potionSlot = equipped.potion;

      // Если в слоте банок что-то есть, но стак меньше максимальных 5 штук
      if (potionSlot && typeof potionSlot === 'object' && potionSlot.id) {
        let currentCount = Number(potionSlot.count || 0);
        
        if (currentCount < 5) {
          const needQty = 5 - currentCount; // Сколько банок не хватает до фулла
          
          // Ищем такую же банку в инвентаре расходников игрока
          const invPotionIdx = consumables.findIndex(c => c && c.id === potionSlot.id);
          
          if (invPotionIdx !== -1) {
            const availableInInv = Number(consumables[invPotionIdx].count || 0);
            const takeQty = Math.min(needQty, availableInInv); // Берем сколько нужно, но не больше, чем есть
            
            if (takeQty > 0) {
              potionSlot.count = currentCount + takeQty; // Доливаем стак на кукле
              
              if (availableInInv > takeQty) {
                consumables[invPotionIdx].count -= takeQty; // Уменьшаем запас в рюкзаке
              } else {
                consumables.splice(invPotionIdx, 1); // Вырезаем из сумки, если забрали последнюю
              }
              console.log(`🧪 [АВТОДОПОЛНЕНИЕ СЕРВЕРА] Игроку ID ${playerRow.id} доложено +${takeQty} шт. банок (${potionSlot.id})`);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("🚨 Ошибка при автодополнении банок:", err.message);
  }
}
// Честный серверный расчет боевых параметров персонажей
function getServerAtk(fighter) {
  // Базовая сила + сила от вещей (например, Амулет Волка дает +2 к силе)
  const totalStrength = Number(fighter.strength || 1) + getEquipmentBonus(fighter.equipped, 'strength');
  const baseAtk = Math.floor(2 + (totalStrength * 1.5));
  
  // Добавляем чистый урон оружия (например, Меч дает +7 к атаке)
  return baseAtk + getEquipmentBonus(fighter.equipped, 'atk');
}

function getServerDef(fighter) {
  const baseEndurance = Number(fighter.endurance || 1);
  const gearEndurance = getEquipmentBonus(fighter.equipped, 'endurance');
  return Math.floor((baseEndurance + gearEndurance) * 0.5) + getEquipmentBonus(fighter.equipped, 'def');
}

function getServerAgility(fighter) {
  return Number(fighter.agility || 1) + getEquipmentBonus(fighter.equipped, 'agility');
}

function getServerLuck(fighter) {
  return Number(fighter.luck || 1) + getEquipmentBonus(fighter.equipped, 'luck');
}

function sanitizeTeam(team) {
  return team.map(f => ({
    uuid: f.uuid, name: f.name, icon: f.icon, level: f.level,
    currentHp: f.currentHp, maxHp: f.maxHp, isBot: f.isBot,
    hasSubmitted: !!f.turn, equipped: f.equipped || null 
  }));
}

// Главный экспорт модуля боевой логики
module.exports = function(io, socket, sb, activeRooms) {
  
  const triggerLoadGameSuccess = dbHelper.triggerLoadGameSuccess;
  const getServerMaxHp = dbHelper.getServerMaxHp;
  const getServerCorrectLevelByXp = dbHelper.getServerCorrectLevelByXp;

  // --- 1. ОБРАБОТЧИК: ЗАПРОС СПИСКА ДУЭЛЕЙ НА АРЕНЕ ---
  socket.on('arena_get_lobby', async () => {
    try {
      const nowISO = new Date().toISOString();
      const { data, error } = await sb.from('arena_lobby').select('*').gt('arena_expires_at', nowISO);
      if (!error && data) socket.emit('arena_lobby_data', data);
    } catch (e) { console.error(e); }
  });

  // --- 2. ОБРАБОТЧИК: ПУБЛИКАЦИЯ СВОЕГО ВЫЗОВА В ЛОББИ ---
  socket.on('arena_create_request', async ({ playerData, currentHp }) => {
    try {
      const expiresAt = new Date(Date.now() + 180000).toISOString(); // 3 минуты жизни заявки
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

  // --- 3. ОБРАБОТЧИК: ОТМЕНА СВОЕГО ВЫЗОВА В ЛОББИ ---
  socket.on('arena_cancel_request', async ({ userId }) => {
    try {
      const { error } = await sb.from('arena_lobby').delete().eq('id', Number(userId));
      if (!error) io.emit('arena_lobby_updated');
    } catch (e) { console.error(e); }
  });

  // --- 4. ОБРАБОТЧИК: ПРИНЯТИЕ ЧУЖОГО PvP ВЫЗОВА ---
  socket.on('arena_accept_challenge_request', async ({ myId, opponentId, playerData, currentHp }) => {
    try {
      const nMyId = Number(myId);
      const nOpponentId = Number(opponentId);

      // Атомарный перехват: кто первый удалил строку из лобби, тот и забрал бой
      const { data, error } = await sb.from('arena_lobby').delete().eq('id', nOpponentId).select();
      if (error || !data || data.length === 0) {
        return socket.emit('error', 'Вызов уже принят другим гладиатором!');
      }

      // Аннулируем собственную заявку, если она висела
      await sb.from('arena_lobby').delete().eq('id', nMyId);

      const roomId = `room_pvp_${opponentId}_vs_${myId}_${Date.now()}`;
      
      const { data: oppData, error: oppErr } = await sb.from('players').select('*').eq('id', nOpponentId).maybeSingle();
      if (oppErr || !oppData) {
        return socket.emit('error', 'Не удалось загрузить профиль соперника.');
      }

      initiatePvpMatch(roomId, playerData, currentHp, oppData, activeRooms, io);
    } catch (e) { 
      console.error(e); 
    }
  });

  // --- 5. ОБРАБОТЧИКИ РЕКОННЕКТОВ И ПРОВЕРКИ СЕССИЙ (АНТИ-СБОЙ F5) ---
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

  // --- 6. ОБРАБОТЧИК: ЗАПУСК PvE БОЯ (ВЫХОД НА ПРИРОДУ) ---
  socket.on('search_pve_match', async ({ playerData, monsterKey, count }) => {
    try {
      const sPlayerId = String(playerData.id);
      const nPlayerId = Number(playerData.id);

      // Аннулируем вызов на Арене, так как игрок ушел в PvE лес
      await sb.from('arena_lobby').delete().eq('id', nPlayerId);
      io.emit('arena_lobby_updated');

      // Защита от дубликатов комнат
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
      const { data: dbPlayer } = await sb.from('players').select('*').eq('id', nPlayerId).single();

      if (!dbMonster || !dbPlayer) return socket.emit('error', 'Ошибка инициализации данных PvE.');

      const roomId = `room_pve_${dbPlayer.id}_${Date.now()}`;
      const pMaxHp = getServerMaxHp(dbPlayer);

      const teamA = [{
        uuid: `player_${dbPlayer.id}`, id: String(dbPlayer.id), name: dbPlayer.name, icon: '👤', isBot: false,
        level: Number(dbPlayer.level), strength: Number(dbPlayer.strength), agility: Number(dbPlayer.agility), endurance: Number(dbPlayer.endurance), luck: Number(dbPlayer.luck),
        currentHp: Math.min(Number(dbPlayer.hp), pMaxHp), maxHp: pMaxHp, socketId: socket.id, turn: null,
        gold: Number(dbPlayer.gold), xp: Number(dbPlayer.xp), statpoints: Number(dbPlayer.statpoints),
        equipped: dbPlayer.equipped || {}, inventory: dbPlayer.inventory || {}, afkTurns: 0 
      }];

      const teamB = [];
      const mMaxHp = getServerMaxHp(dbMonster);
      for (let i = 0; i < monsterCount; i++) {
        teamB.push({
          uuid: `bot_${dbMonster.id}_${i}_${Date.now()}`, id: dbMonster.id,
          name: monsterCount > 1 ? `${dbMonster.name} #${i + 1}` : dbMonster.name, icon: dbMonster.icon,
          isBot: true, level: Number(dbMonster.level), strength: Number(dbMonster.strength),
          agility: Number(dbMonster.agility), endurance: Number(dbMonster.endurance),
          luck: Number(dbMonster.luck), currentHp: mMaxHp, maxHp: mMaxHp, rewardXp: Number(dbMonster.reward_xp),
          rewardGold: Number(dbMonster.reward_gold), turn: null
        });
      }

      activeRooms[roomId] = { id: roomId, type: 'pve', teamA, teamB, turnCount: 1, timeoutRef: null };
      // ============================================================================
      // 🔥 ЭКСПРЕСС-АУДИТ ХАРАКТЕРИСТИК ПРИ ЗАГРУЗКЕ В БОЙ (ЛОГ В КОНСОЛЬ СЕРВЕРА)
      // ============================================================================
      const testFighter = teamA[0];
                if (testFighter) {
                  console.log(`
          📊 === [БОЕВОЙ АУДИТ ПЕРСОНАЖА: ${testFighter.name.toUpperCase()}] ===
          👤 Базовые статы из БД: 💪Сил:${testFighter.strength} | 🏹Ловк:${testFighter.agility} | 🛡️Вын:${testFighter.endurance} | 🍀Уд:${testFighter.luck}
          🎒 Надето в MainHand (Оружие): "${testFighter.equipped?.mainHand || 'НИЧЕГО'}"
          🛡️ Надето в OffHand (Щит/Второе): "${testFighter.equipped?.offHand || 'НИЧЕГО'}"
          ⚔️ Бонус чистого урона от вещей (atk): +${getEquipmentBonus(testFighter.equipped, 'atk')} ед.
          💪 Бонус Силы от вещей (strength): +${getEquipmentBonus(testFighter.equipped, 'strength')} ед.
          🏹 Итоговая боевая Ловкость (getServerAgility): ${getServerAgility(testFighter)}
          🍀 Итоговая боевая Удача (getServerLuck): ${getServerLuck(testFighter)}
          🛡️ Итоговая боевая Защита (getServerDef): ${getServerDef(testFighter)} ед.
          💥 ИТОГОВАЯ БОЕВАЯ АТАКА СЕРВЕРА (getServerAtk): ${getServerAtk(testFighter)} ед.
          ======================================================
                  `);
                }

      socket.join(roomId);
      
      socket.emit('battle_init_data', {
        roomId, turnCount: 1, myUuid: `player_${dbPlayer.id}`,
        teamA: sanitizeTeam(teamA), teamB: sanitizeTeam(teamB)
      });

      startServerTurnTimer(roomId, activeRooms, io);
    } catch (err) {
      socket.emit('error', `Внутренняя ошибка: ${err.message}`);
    }
  });

  // --- 7. ОБРАБОТЧИК: ПРИЕМ ХОДА (АТАКА / БЛОК) ---
  socket.on('submit_turn', ({ roomId, targetUuid, attack, defends }) => {
    const room = activeRooms[roomId];
    if (!room) {
      console.log(`⚠️ [ХОД ОТКЛОНЕН] Комната ${roomId} не найдена в ОЗУ.`);
      return;
    }

    const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
    if (!fighter) {
      console.log(`⚠️ [ХОД ОТКЛОНЕН] Боец с сокетом ${socket.id} не найден в комнате ${roomId}.`);
      return;
    }

    if (fighter.currentHp <= 0) return;
    if (fighter.turn) {
      console.log(`⚠️ [ХОД ОТКЛОНЕН] Гладиатор ${fighter.name} уже отправил ход в этом раунде.`);
      return;
    }

    // ============================================================================
    // 🛡️ 🔥 [АНТИЧИТ АУДИТ ЗОН ХОДА]: ПРОВЕРКА ЛЕГАЛЬНОСТИ КОЛИЧЕСТВА АТАК И БЛОКОВ
    // ============================================================================
    let serverMaxAttacks = 1;
    let serverMaxDefends = 1;

    if (fighter.equipped) {
      const mainHand = fighter.equipped.mainHand;
      const offHand = fighter.equipped.offHand;

      // 1. ПРОВЕРКА ЛИМИТА АТАК АНТИЧИТОМ
      const mainItemData = global.SERVER_SHOP_DATABASE ? global.SERVER_SHOP_DATABASE[mainHand] : null;
      const isTwoHanded = (mainHand && mainHand.includes('twoHanded')) || 
                          (mainItemData && mainItemData.slotType === 'twoHanded') || 
                          (mainHand === 'heavy_halberd');

      if (isTwoHanded) {
        serverMaxAttacks = 1; // Двуручник легально дает 2 удара
      } else if (offHand && !isShield(offHand)) {
        serverMaxAttacks = 2; // 🔥 ДУАЛЫ: Если в левой руке оружие (не щит) — разрешаем 2 удара!
      } else {
        serverMaxAttacks = 1;
      }
      // Сверяем наличие щита на сервере
      if (offHand && isShield(offHand)) {
        serverMaxDefends = 3;
      } else if (Number(fighter.level || 1) <= 1) {
        serverMaxDefends = 2; // Новичкам 1 уровня разрешено 2 блока
      }
    } else {
      serverMaxDefends = (Number(fighter.level || 1) <= 1) ? 2 : 1;
    }

    // Чистим и фильтруем входящие массивы от читера
    let checkedDefends = Array.isArray(defends) ? defends.filter(z => typeof z === 'string') : [];
    let checkedAttack = attack;

    // Если читер прислал больше блоков, чем ему положено — сервер насильно оставляет только первые разрешенные
    if (checkedDefends.length > serverMaxDefends) {
      console.warn(`🚨 [АНТИЧИТ ТРИГГЕР] Игрок ${fighter.name} пытался заблокировать ${checkedDefends.length} зон вместо ${serverMaxDefends}! Обрезаем лишнее.`);
      checkedDefends = checkedDefends.slice(0, serverMaxDefends);
    }

    // Если читер без двуручника прислал массив атак — берем только первую атаку
    if (serverMaxAttacks === 1 && Array.isArray(checkedAttack)) {
      console.warn(`🚨 [АНТИЧИТ ТРИГГЕР] Игрок ${fighter.name} прислал массив атак без двуручного оружия. Берем первую зону.`);
      checkedAttack = checkedAttack[0] || "torso";
    } 
    // Если у него двуручник, но он прислал больше 2 зон
    else if (serverMaxAttacks === 2 && Array.isArray(checkedAttack) && checkedAttack.length > 2) {
      checkedAttack = checkedAttack.slice(0, 2);
    }

    // Записываем проверенную, безопасную тактику в ОЗУ сервера
    fighter.turn = { 
      targetUuid: String(targetUuid), 
      attack: checkedAttack, 
      defends: checkedDefends 
    };
    fighter.afkTurns = 0; 

    // Лог на сервере для контроля
    const logDefendsText = checkedDefends.join(', ');
    const logAttackText = Array.isArray(checkedAttack) ? checkedAttack.join(', ') : checkedAttack;
    console.log(`📥 [ОБРАБОТАН ХОД (ЗАЩИЩЕН)] ${fighter.name} | Удар: ${logAttackText} | Блок: [${logDefendsText}]`);

    // ============================================================================
    // Условия запуска раунда (остаются без изменений)
    // ============================================================================
    let canExecuteRound = false;

    if (room.type === 'pve') {
      const awaitingPvE = room.teamA.filter(p => !p.isBot && p.currentHp > 0 && !p.turn);
      if (awaitingPvE.length === 0) canExecuteRound = true;
    } 
    else if (room.type === 'pvp') {
      const playerA = room.teamA[0];
      const playerB = room.teamB[0];
      
      if (playerA && playerB) {
        const isReadyA = (playerA.currentHp <= 0 || playerA.turn !== null);
        const isReadyB = (playerB.currentHp <= 0 || playerB.turn !== null);
        if (isReadyA && isReadyB) canExecuteRound = true;
      }
    }

    if (canExecuteRound) {
      console.log(`🔔 [УДАР В КОЛОКОЛ] Все ходы проверены и собраны! Запускаем executeRoundCalculations...`);
      clearTimeout(room.timeoutRef);
      executeRoundCalculations(roomId, activeRooms, io); 
    }
  });

  // --- 8. ОБРАБОТЧИК: ИСПОЛЬЗОВАНИЕ ЗЕЛИЙ В БОЮ ---
   socket.on('instant_use_potion', async ({ roomId }) => {
    try {
      const room = activeRooms[roomId];
      if (!room) return;

      // 🔥 ИСПРАВЛЕНО: Ищем тебя в обеих командах, чтобы в PvP за команду Б сервер не падал!
      const fighter = [...room.teamA, ...room.teamB].find(p => p.socketId === socket.id);
      if (!fighter || fighter.currentHp <= 0) return;

      const potionSlot = fighter.equipped?.potion;

      if (potionSlot && typeof potionSlot === 'object' && potionSlot.id && potionSlot.count > 0) {
        
        // 🔥 ИСПРАВЛЕНО: Читаем данные из новой базы GAME_ITEMS_DATABASE, так как старую ты удалил
        const itemConfig = GAME_ITEMS_DATABASE[potionSlot.id];
        
        // Вытаскиваем хил или берём резервное значение, если в конфиге пусто
        let healAmount = 25;
        let potionName = "Зелье HP";
        
        if (itemConfig) {
          potionName = itemConfig.name || "Зелье HP";
          healAmount = itemConfig.heal || itemConfig.bonus?.heal || itemConfig.bonus?.stats?.heal || 0;
        }
        
        // Подстраховка дефолтных банок
        if (!healAmount) {
          if (potionSlot.id === 'hp_potion_small') { healAmount = 25; potionName = "Малое зелье HP"; }
          if (potionSlot.id === 'hp_potion_big') { healAmount = 60; potionName = "Большое зелье HP"; }
          if (potionSlot.id === 'fish_soup') { healAmount = 40; potionName = "Уха из таверны"; }
        }

        // Твой каноничный код логики применения
        fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + healAmount);
        potionSlot.count--;
        let displayCountLog = potionSlot.count;

        if (potionSlot.count <= 0) fighter.equipped.potion = null;

        // Твоя каноничная отправка пакета на фронтенд
        io.to(roomId).emit('battle_effect_potion', {
          uuid: fighter.uuid, 
          currentHp: fighter.currentHp, 
          equipped: fighter.equipped, 
          logMsg: `🧪 <strong>${fighter.name}</strong> выпил ${potionName} (+${healAmount} HP)! Осталось: ${displayCountLog} шт.`
        });

        await sb.from('players').update({ hp: fighter.currentHp, equipped: fighter.equipped }).eq('id', Number(fighter.id));
      }
    } catch (err) {
      // Защитный барьер: если что-то пойдёт не так, сервер выдаст лог, но НЕ упадёт в 503!
      console.error("🚨 Ошибка применения банки в бою:", err.message);
    }
  });

  // --- 9. ВНУТРЕННЯЯ ФУНКЦИЯ: СБОРКА PvP КОМНАТЫ С БАЛАНСОМ ХП ---
  function initiatePvpMatch(roomId, playerData, p1Hp, p2Data, activeRooms, io) {
    const p1Stats = {
      strength: Number(playerData.strength ?? playerData.stats?.strength ?? 1),
      agility: Number(playerData.agility ?? playerData.stats?.agility ?? 1),
      endurance: Number(playerData.endurance ?? playerData.stats?.endurance ?? 1),
      luck: Number(playerData.luck ?? playerData.stats?.luck ?? 1), // Интеллект полностью удален
      equipped: playerData.equipped || {}
    };

    const p2Stats = {
      strength: Number(p2Data.strength ?? p2Data.stats?.strength ?? 1),
      agility: Number(p2Data.agility ?? p2Data.stats?.agility ?? 1),
      endurance: Number(p2Data.endurance ?? p2Data.stats?.endurance ?? 1),
      luck: Number(p2Data.luck ?? p2Data.stats?.luck ?? 1), // Интеллект полностью удален
      equipped: p2Data.equipped || {}
    };

    const p1MaxHp = getServerMaxHp(p1Stats);
    const p2MaxHp = getServerMaxHp(p2Stats);
     console.log(`🔎 [ИНСПЕКЦИЯ АРЕНЫ] Создатель заявки уровень:`, playerData.level, `| Оппонент уровень:`, p2Data.level);

    const teamA = [{
      uuid: `player_${playerData.id}`, id: String(playerData.id), name: playerData.name, icon: '👤', isBot: false,
      level: Number(playerData.level ?? 1), strength: p1Stats.strength, agility: p1Stats.agility,
      endurance: p1Stats.endurance,  luck: p1Stats.luck,
      currentHp: Math.min(Number(p1Hp || p1MaxHp), p1MaxHp), maxHp: p1MaxHp, socketId: null, turn: null,
      equipped: playerData.equipped || {}, inventory: playerData.inventory || {}, afkTurns: 0
    }];

    const teamB = [{
      uuid: `player_${p2Data.id}`, id: String(p2Data.id), name: p2Data.name, icon: '👤', isBot: false, 
      level: Number(p2Data.level ?? 1), strength: p2Stats.strength, agility: p2Stats.agility,
      endurance: p2Stats.endurance, luck: p2Stats.luck,
      currentHp: Math.min(Number(p2Data.hp || p2MaxHp), p2MaxHp), maxHp: p2MaxHp, socketId: null, turn: null,
      equipped: p2Data.equipped || {}, inventory: p2Data.inventory || {}, afkTurns: 0
    }];

    activeRooms[roomId] = { id: roomId, type: 'pvp', teamA, teamB, turnCount: 1, timeoutRef: null };
    console.log(`⚔️ [PvP ЗАПУСК] Комната: ${roomId} для ${playerData.name} vs ${p2Data.name}`);
    
    setTimeout(() => {
      io.emit('arena_lobby_updated');
      io.emit('arena_redirect_to_battle', { roomId: roomId });
    }, 150);

    startServerTurnTimer(roomId, activeRooms, io);
  }

  // --- 10. ВНУТРЕННЯЯ ФУНКЦИЯ: ТАЙМЕР АФК КЛИЕНТОВ (30 СЕКУНД) ---
  function startServerTurnTimer(roomId, activeRooms, io) {
    const room = activeRooms[roomId];
    if (!room) return;
    if (room.timeoutRef) clearTimeout(room.timeoutRef);

    room.timeoutRef = setTimeout(() => {
      if (!activeRooms[roomId]) return;
      
      console.log(`⏱️ [АФК ТРИГГЕР] Время на ход вышло в комнате ${roomId}.`);
      const allFighters = [...room.teamA, ...room.teamB];
      
      allFighters.forEach(f => {
        if (!f.isBot && f.currentHp > 0) {
          if (!f.turn) {
            f.afkTurns = (f.afkTurns || 0) + 1;
            const opposingTeam = room.teamA.includes(f) ? room.teamB : room.teamA;
            const aliveEnemies = opposingTeam.filter(e => e.currentHp > 0);
            
            f.turn = { 
              targetUuid: aliveEnemies.length > 0 ? aliveEnemies[0].uuid : null, 
              attack: null, 
              defends: [] 
            };
          } else {
            f.afkTurns = 0;
          }
        }
      });
      
      executeRoundCalculations(roomId, activeRooms, io);
    }, 60000); 
  }

  // --- 11. ВНУТРЕННЯЯ ФУНКЦИЯ: СЕРВЕРНЫЙ КАЛЬКУЛЯТОР БОЯ И ОБМЕНА УДАРАМИ ---
  function executeRoundCalculations(roomId, activeRooms, io) {
    const room = activeRooms[roomId];
    if (!room) return;

    const logs = [];
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    // Проверка тотальной АФК дисквалификации (3 пропуска подряд)
    const allHumanFighters = [...room.teamA, ...room.teamB].filter(f => !f.isBot && f.currentHp > 0);
    let afkDisqualifiedFighter = allHumanFighters.find(f => (f.afkTurns || 0) >= 3);

    if (afkDisqualifiedFighter) {
      logs.push(`🛑 Гладиатор <strong>${afkDisqualifiedFighter.name}</strong> застыл на месте слишком долго. Техническое поражение.`);
      afkDisqualifiedFighter.currentHp = 0;

      const isTeamADead = room.teamA.every(f => f.currentHp <= 0);
      const isTeamBDead = room.teamB.every(f => f.currentHp <= 0);
      let result = 'draw';
      if (!isTeamADead && isTeamBDead) result = 'win';
      if (isTeamADead && !isTeamBDead) result = 'lose';

      if (room.type === 'pve') finalizePveBattle(room, result, logs, room.turnCount, io);
      else if (room.type === 'pvp') finalizePvpBattle(room, result, logs, room.turnCount, io);
      return;
    }

    // Расчет ИИ монстров в режиме PvE
  if (room.type === 'pve') {
      room.teamB.forEach(bot => {
        if (bot.currentHp <= 0 || !bot.isBot) return;
        const aliveTargets = room.teamA.filter(a => a.currentHp > 0);
        if (aliveTargets.length === 0) return;

        const targetFighter = aliveTargets[rand(0, aliveTargets.length - 1)];
        
        // Каноничные 5 зон Бойцовского Клуба
        const zones = ["head", "breast", "torso", "belt", "legs"];
        
        // Считываем «голые» статы монстра из ОЗУ комнаты
        const bAgi = Number(bot.agility || 1);
        const bLuck = Number(bot.luck || 1);
        const bEnd = Number(bot.endurance || 1);

        let botMaxAttacks = 1;
        let botMaxDefends = 2; // Базовая схема по умолчанию

        // 🔥 АНАЛИЗИРУЕМ КЛАСС МОНСТРА НА ОСНОВЕ ЕГО ХАРАКТЕРИСТИК:
        if (bEnd > bAgi && bEnd > bLuck) {
          // СЦЕНАРИЙ А: ТАНК (Выносливость выше всего). Пример: Каменный Голем
          botMaxAttacks = 1;
          botMaxDefends = 3; // Ставит 3 блока, бьет 1 раз
        } 
        else if (bAgi > bEnd || bLuck > bEnd) {
          // СЦЕНАРИЙ Б: ЛОВКАЧ / КРИТОВИК. Пример: Дикий Волк или Бешеный Гоблин
          botMaxAttacks = 2; // Атакует дуалами (2 удара)
          botMaxDefends = 2; // Но защищает всего 2 зоны!
        }

        // 1. ГЕНЕРИРУЕМ БЛОКИ МОНСТРА (в зависимости от botMaxDefends)
        const mDefend = [];
        while (mDefend.length < botMaxDefends) {
          const rz = zones[rand(0, zones.length - 1)];
          if (!mDefend.includes(rz)) mDefend.push(rz);
        }

        // 2. ГЕНЕРИРУЕМ АТАКУ МОНСТРА (в зависимости от botMaxAttacks)
        let botAttackPayload = null;
        if (botMaxAttacks === 2) {
          // Если монстр — ловкач, генерируем СДВОЕННЫЙ УДАР (массив из двух случайных зон)
          const firstHit = zones[rand(0, zones.length - 1)];
          const secondHit = zones[rand(0, zones.length - 1)];
          botAttackPayload = [firstHit, secondHit];
          
          console.log(`🤖⚔️ [ИИ ДУАЛЫ] Бот ${bot.name} (Ловкач/Крит) бьет 2 раза: [${firstHit}, ${secondHit}]`);
        } else {
          // Обычный танк — бьет 1 раз (строка)
          botAttackPayload = zones[rand(0, zones.length - 1)];
        }

        // Записываем собранный классовый ход ИИ в ОЗУ сервера
        bot.turn = { 
          targetUuid: targetFighter.uuid, 
          attack: botAttackPayload, 
          defends: mDefend 
        };
      });
    }

    // Сортировка очереди ходов по показателю серверной Ловкости
    let queue = [...room.teamA, ...room.teamB];
    const aliveAtStart = queue.filter(f => f.currentHp > 0).map(f => f.uuid);
      // === СЕРВЕРНАЯ ЗАМЕНА ОБСЧЕТА ОДНО/ДВУРУЧНЫХ УДАРОВ В BATTLE_LOGIC.JS ===
    queue.forEach(attacker => {
      if (!aliveAtStart.includes(attacker.uuid) || !attacker.turn || !attacker.turn.targetUuid) return;

      let target = [...room.teamA, ...room.teamB].find(f => f.uuid === attacker.turn.targetUuid);
      if (!target) {
        const opposingTeam = room.teamA.includes(attacker) ? room.teamB : room.teamA;
        const flatOpponents = Array.isArray(opposingTeam) ? opposingTeam : [opposingTeam];
        const newAlive = flatOpponents.filter(t => t && t.currentHp > 0);
        if (newAlive.length === 0) return;
        target = newAlive[0];
      }

  

      // Превращаем атаку в массив, чтобы код одинаково обрабатывал и 1 удар (строку), и 2 удара (массив двуручника)
      if (attacker.uuid === target.uuid) return;

      // 🔥 УНИВЕРСАЛЬНЫЙ СБОРЩИК АТАК (ДЛЯ ИГРОКОВ И КЛАССОВЫХ МОНСТРОВ)
    let attacksList = [];

    if (attacker.isBot) {
      // Если ходит монстр — просто берем то, что сгенерировал ему наш новый ИИ (массив из 2-х зон или 1 строку)
      attacksList = Array.isArray(attacker.turn.attack) ? attacker.turn.attack : [attacker.turn.attack];
    } else {
      // Если ходит живой игрок — проверяем его дуалы/двуручники на сервере
      const mainWeapon = attacker.equipped?.mainHand;
      const offWeapon = attacker.equipped?.offHand;

      if (mainWeapon && (mainWeapon.includes('twoHanded') || mainWeapon === 'heavy_halberd')) {
        // Двуручник — берем массив двух зон, отправленный с фронтенда
        attacksList = Array.isArray(attacker.turn.attack) ? attacker.turn.attack : [attacker.turn.attack];
      } else if (offWeapon && !isShield(offWeapon)) {
        // Игрок с дуалами бьет в выбранную зону + случайную из 5 зон БК
        const primaryAttackZone = Array.isArray(attacker.turn.attack) ? attacker.turn.attack[0] : attacker.turn.attack;
        const zones = ["head", "breast", "torso", "belt", "legs"];
        const leftHandZone = zones[Math.floor(Math.random() * zones.length)];
        
        attacksList = [primaryAttackZone, leftHandZone]; 
        console.log(`⚔️⚔️ [ОБМЕН УДАРАМИ] Игрок ${attacker.name} бьет дуалами! Правая: ${primaryAttackZone}, Левая: ${leftHandZone}`);
      } else {
        // Обычный одноручник/щитовик — 1 выбранный удар
        const singleZone = Array.isArray(attacker.turn.attack) ? attacker.turn.attack[0] : attacker.turn.attack;
        attacksList = [singleZone];
      }
    }

      const targetDefends = (target.turn && Array.isArray(target.turn.defends)) ? target.turn.defends : [];
        
      attacksList.forEach(currentAttackZone => {
        if (currentAttackZone === null) return;

        // 1. ПРОВЕРКА БЛОКА: Закрыл ли защитник (target) именно ту зону, куда летит удар?
        if (targetDefends.includes(currentAttackZone)) {
          logs.push(`🛡️ <strong>${target.name}</strong> заблокировал удар от <strong>${attacker.name}</strong> в ${ZONE_NAMES[currentAttackZone]}.`);
          return; // Удар успешно заблокирован целью, переходим к следующей зоне атаки
        }

        // 2. БК-МЕХАНИКА: Расчет Уворота цели (Используем яркие функции!)
        const targetAgi = getServerAgility(target);      // 🔥 Вызываем функцию! Больше никакого тусклого цвета!
        const attackerAgi = getServerAgility(attacker);  // 🔥 Считываем полную ловкость атакующего
        
        const targetMfInv = (targetAgi * 10) + getEquipmentBonus(target.equipped, 'mf_inv');
        const attackerMfAntiInv = (attackerAgi * 4) + getEquipmentBonus(attacker.equipped, 'mf_antiinv');

        let finalEvadeChance = 5 + (targetAgi - attackerAgi) * 1 + Math.floor((targetMfInv - attackerMfAntiInv) / 10);
        const evadeChance = Math.min(70, Math.max(5, finalEvadeChance));

        if (rand(1, 100) <= evadeChance) {
          logs.push(`🏹 <strong>${target.name}</strong> увернулся от удара <strong>${attacker.name}</strong> в ${ZONE_NAMES[currentAttackZone]}!`);
          return; // Цель увернулась, урон обнулен, прерываем этот удар
        }

        // 3. БК-МЕХАНИКА: Расчет Крита (Используем яркие функции!)
        const attackerLuck = getServerLuck(attacker);  // 🔥 Вызываем функцию! Больше никакого тусклого цвета!
        const targetLuck = getServerLuck(target);      // 🔥 Считываем полную удачу защищающегося
        
        const attackerMfCrit = (attackerLuck * 10) + getEquipmentBonus(attacker.equipped, 'mf_crit');
        const targetMfAntiCrit = (targetLuck * 4) + getEquipmentBonus(target.equipped, 'mf_anticrit');

        let finalCritChance = 10 + (attackerLuck - targetLuck) * 2 + Math.floor((attackerMfCrit - targetMfAntiCrit) / 10);
        const criticalChance = Math.min(65, Math.max(5, finalCritChance));
        const isCrit = rand(1, 100) <= criticalChance;

        // Базовый физ-урон (если у нас 2 удара двуручником, делим урон каждого удара на 1.3 для баланса)
        let dmgFactor = (attacksList.length === 2) ? 1.3 : 1.0;
        
        // 🔥 ФИКС: Вызываем честный серверный калькулятор атаки!
        let dmg = Math.floor(getServerAtk(attacker) / dmgFactor);
        
        if (isCrit) dmg = Math.floor(dmg * 2.0);

        // 🔥 ФИКС ЗАЩИТЫ: Поглощение урона броней Выносливости (Убрали dbHelper, вызываем напрямую!)
        dmg = Math.max(1, dmg - getServerDef(target)); 
        target.currentHp = Math.max(0, Number(target.currentHp || 0) - dmg);
        
        logs.push(`⚔️ <strong>${attacker.name}</strong> нанес <strong>${target.name}</strong> <strong>${dmg}</strong> урона в ${ZONE_NAMES[currentAttackZone]} ${isCrit ? '💥 КРИТ!' : ''}`);
      });
    });

    room.teamA.forEach(f => f.turn = null);
    room.teamB.forEach(f => f.turn = null);
    console.log(`⚔️ [МАТЕМАТИКА РАУНДА ЗАВЕРШЕНА] Логи урона собраны. Переходим к отправке round_result и вызову базы наград...`);

    const isTeamADead = room.teamA.every(f => f.currentHp <= 0);
    const isTeamBDead = room.teamB.every(f => f.currentHp <= 0);
    const currentRound = room.turnCount;
    room.turnCount++;

    if (isTeamADead || isTeamBDead || room.turnCount > 40) {
      let result = 'draw';
      if (!isTeamADead && isTeamBDead) result = 'win';  // Победила команда А
      if (isTeamADead && !isTeamBDead) result = 'lose'; // Победила команда B

      console.log(`🏁 [ФИНАЛ МАТЧА] Тип комнаты: ${room.type}. Результат для TeamA: ${result}`);

      // ============================================================================
      // 🌲 ВЕТВЬ А: РАСЧЕТ ЛОГОВ НАГРАД СТРОГО ДЛЯ PvE (БИТВА С МОНСТРАМИ)
      // ============================================================================
      if (room.type === 'pve') {
        const player = room.teamA[0];
        if (player && result === 'win') {
          let gainedXp = 0;
          let gainedGold = 0;
          room.teamB.forEach(m => {
            gainedXp += Number(m.rewardXp || 0);
            gainedGold += Number(m.rewardGold || 0);
          });

          const oldLevel = Number(player.level || 1);
          const correctLevel = dbHelper.getServerCorrectLevelByXp(player.xp + gainedXp);

          if (correctLevel > oldLevel) {
            logs.push(`🎉 <strong>УРОВЕНЬ ПОВЫШЕН!</strong> Вы достигли ${correctLevel} уровня!`);
          }
          logs.push(`🏁 <strong>ПОБЕДА!</strong> Награда: 💰 ${gainedGold} монет, ✨ ${gainedXp} опыта.`);
        } else if (player && result === 'lose') {
          logs.push(`🏁 <strong>ВАС ОДОЛЕЛИ...</strong> Воскрешение в городе.`);
        }
      }

      // ============================================================================
      // 🏆 ВЕТВЬ Б: 🔥 ФИКС PvP ЛОГОВ НАГРАД (ДО ОТПРАВКИ ПАКЕТА НА ТЕЛЕФОН)
      // ============================================================================
      if (room.type === 'pvp') {
        const playerA = room.teamA[0]; 
        const playerB = room.teamB[0]; 
        const goldReward = 25;

        const calculatePvpXpLog = (winnerLvl, loserLvl) => {
          let baseXp = Number(loserLvl || 1) * 15;
          let multiplier = 1;
          if (loserLvl > winnerLvl) multiplier = 1 + ((loserLvl - winnerLvl) * 0.25);
          else if (loserLvl < winnerLvl) multiplier = Math.max(0.1, 1 - ((winnerLvl - loserLvl) * 0.20));
          return Math.floor(baseXp * multiplier);
        };

        if (result === 'win' && playerA && playerB) {
          const xpGained = calculatePvpXpLog(playerA.level, playerB.level);
          logs.push(`🏁 <strong>ПОБЕДА НА АРЕНЕ!</strong> Гладиатор <strong>${playerA.name}</strong> поверг соперника! Награда: 💰 ${goldReward} монет, ✨ ${xpGained} опыта.`);
        } else if (result === 'lose' && playerA && playerB) {
          const xpGained = calculatePvpXpLog(playerB.level, playerA.level);
          logs.push(`🏁 <strong>ПОБЕДА НА АРЕНЕ!</strong> Гладиатор <strong>${playerB.name}</strong> одержал верх! Награда: 💰 ${goldReward} монет, ✨ ${xpGained} опыта.`);
        } else {
          logs.push(`🏁 <strong>НИЧЬЯ НА АРЕНЕ!</strong> Силы гладиаторов равны. Награды аннулированы.`);
        }
      }

      // ============================================================================
      // 📤 ОТПРАВКА СЕТЕВОГО ПАКЕТА ФИНАЛА
      // ============================================================================
      [...room.teamA, ...room.teamB].forEach(p => {
        if (p.socketId) {
          let personalResult = result;
          if (room.type === 'pvp') {
            const isTargetInTeamA = room.teamA.some(f => f.uuid === p.uuid);
            if (isTargetInTeamA) personalResult = result;
            else personalResult = (result === 'win') ? 'lose' : (result === 'lose' ? 'win' : 'draw');
          }

          io.to(p.socketId).emit('round_result', { 
            turnCount: currentRound, 
            logs: logs, 
            isOver: true, 
            resultType: personalResult,
            teamA: sanitizeTeam(room.teamA), 
            teamB: sanitizeTeam(room.teamB) 
          });
        }
      });

        if (room.type === 'pve') {
            finalizePveBattle(room, result, logs, currentRound, io);
        } else if (room.type === 'pvp') {
            finalizePvpBattle(room, result, logs, currentRound, io);
        }
      
      setTimeout(() => {
        delete activeRooms[room.id];
        console.log(`🗑️ [ОЗУ] Комната ${room.id} полностью выгружена.`);
      }, 1200);
      
    } else {
      [...room.teamA, ...room.teamB].forEach(p => {
        if (p.socketId) {
          io.to(p.socketId).emit('round_result', { 
            turnCount: currentRound, logs: logs, isOver: false, 
            teamA: sanitizeTeam(room.teamA), teamB: sanitizeTeam(room.teamB) 
          });
        }
      });
      startServerTurnTimer(roomId, activeRooms, io);
    }
  }

  // --- 12. ВНУТРЕННЯЯ ФУНКЦИЯ: ФИНАЛИЗАЦИЯ PvE И СИНХРОНИЗАЦИЯ НАГРАД ---
  async function finalizePveBattle(room, result, logs, finalRound, io) {
  try {
    // Безопасно достаем объект игрока, проверяя, массив это или одиночный объект
    const player = (room && room.teamA && Array.isArray(room.teamA)) ? room.teamA[0] : (room ? room.teamA : null);
    if (!player) {
      console.error("🚨 [КРИТ] finalizePveBattle: Объект игрока в комнате не найден!");
      return;
    }

    let gainedXp = 0; 
    let gainedGold = 0;
    let dbHpPayload = Number(player.currentHp || 0);
    autoRefillPotionsAfterBattle(player);

    if (result === 'win') {
      if (room.teamB && Array.isArray(room.teamB)) {
        room.teamB.forEach(m => { 
          gainedXp += Number(m.rewardXp || 0); 
          gainedGold += Number(m.rewardGold || 0); 
        });
      }
      player.gold = Number(player.gold || 0) + gainedGold;
      player.xp = Number(player.xp || 0) + gainedXp;
      
      const oldLevel = Number(player.level || 1);
      const correctLevel = dbHelper.getServerCorrectLevelByXp(player.xp);
      
    if (correctLevel > oldLevel) {
        const levelsGained = correctLevel - oldLevel;
        player.statpoints = Number(player.statpoints || player.statPoints || 0) + (levelsGained * 5);
        player.level = correctLevel;
        player.currentHp = dbHelper.getServerMaxHp(player);
      }
      dbHpPayload = player.currentHp;
    } else {
      player.currentHp = 0;
      dbHpPayload = Math.max(1, Math.floor(dbHelper.getServerMaxHp(player) * 0.2));
    }

    // 🔥 ФИКС РЕГИСТРА: Проверяем, какое имя поля используется в вашей базе Supabase для статпоинтов
    let pointsKey = (player.statpoints !== undefined) ? 'statpoints' : 'statPoints';

    console.log(`📡 [БД PvE БЕЗОПАСНЫЙ АПДЕЙТ] Отправка наград для игрока ID: ${player.id} в Supabase...`);
    
    // Выполняем запись в базу данных
    const { error } = await sb.from('players').update({ 
      gold: Number(player.gold), 
      xp: Number(player.xp), 
      hp: Number(dbHpPayload), 
      level: Number(player.level), 
      inventory: player.inventory, // <-- Сохраняем рюкзак, откуда забрали банки
      equipped: player.equipped,   // <-- Сохраняем куклу, куда доложили банки
      [pointsKey]: Number(player.statpoints || player.statPoints || 0) 
    }).eq('id', Number(player.id));

    if (error) {
      console.error("🚨 [Supabase SQL Error]:", error.message);
      // 🔥 ДАЖЕ ЕСЛИ БАЗА ВЫДАЛА ОШИБКУ, МЫ НЕ ПАДАЕМ, А ДАЕМ БОЮ ЗАВЕРШИТЬСЯ, ЧТОБЫ ЭКРАН НЕ ВИС!
    } else {
      console.log(`☁️ [БД PvE УСПЕХ] Награды для ${player.name} успешно зафиксированы в облаке.`);
    }

  } catch (err) {
    // Ловим любые синтаксические ошибки и опечатки (например, undefined полей), защищая поток сокета от зависания
    console.error("❌ Фатальный сбой внутри функции finalizePveBattle:", err.message);
  }
}

  // --- 13. ВНУТРЕННЯЯ ФУНКЦИЯ: ФИНАЛИЗАЦИЯ PvP ДУЭЛЕЙ ГЛАДИАТОРОВ ---
  async function finalizePvpBattle(room, result, logs, finalRound, io) {
  const playerA = room.teamA[0]; // Напрямую берем первый элемент из массива заявки
  const playerB = room.teamB[0]; 
    
    if (!playerA || !playerB) return;

    const [dbDataA, dbDataB] = await Promise.all([
      sb.from('players').select('*').eq('id', Number(playerA.id)).maybeSingle(),
      sb.from('players').select('*').eq('id', Number(playerB.id)).maybeSingle()
    ]);
    
    console.log(`
🏁 [PvP ФИНАЛИЗАЦИЯ] Начинаем защищенную транзакцию наград. Исход для TeamA: ${result}`);

    const goldReward = 25; 

    const calculatePvpXp = (winnerLvl, loserLvl) => {
      let baseXp = Number(loserLvl || 1) * 15; 
      let multiplier = 1;
      if (loserLvl > winnerLvl) multiplier = 1 + ((loserLvl - winnerLvl) * 0.25);
      else if (loserLvl < winnerLvl) multiplier = Math.max(0.1, 1 - ((winnerLvl - loserLvl) * 0.20));
      return Math.floor(baseXp * multiplier);
    };

    try {
      const [dbDataA, dbDataB] = await Promise.all([
        sb.from('players').select('*').eq('id', Number(playerA.id)).maybeSingle(),
        sb.from('players').select('*').eq('id', Number(playerB.id)).maybeSingle()
      ]);

      if (!dbDataA.data || !dbDataB.data) {
        console.error("🚨 [КРИТ] Не удалось прочитать профили из БД перед выдачей PvP наград!");
        return;
      }

      const rowA = dbDataA.data;
      const rowB = dbDataB.data;
      // 🔥 ТРИГГЕРЫ АВТОДОПОЛНЕНИЯ ЗЕЛИЙ ДЛЯ ОБЛИКА ОБОИХ ИГРОКОВ PvP АРЕНЫ
      autoRefillPotionsAfterBattle(rowA);
      autoRefillPotionsAfterBattle(rowB);
      const safeRead = (row, field, def = 0) => {
        const low = field.toLowerCase();
        const up = field.toUpperCase();
        const cap = field.charAt(0).toUpperCase() + field.slice(1);
        return Number(row[low] ?? row[up] ?? row[cap] ?? row[field] ?? def);
      };

      let pointsKeyA = rowA.statpoints !== undefined ? 'statpoints' : 'statPoints';
      let pointsKeyB = rowB.statpoints !== undefined ? 'statpoints' : 'statPoints';

      let goldA = safeRead(rowA, 'gold', 0);
      let xpA = safeRead(rowA, 'xp', 0);
      let levelA = safeRead(rowA, 'level', 1);
      let statpointsA = safeRead(rowA, pointsKeyA, 0);

      let goldB = safeRead(rowB, 'gold', 0);
      let xpB = safeRead(rowB, 'xp', 0);
      let levelB = safeRead(rowB, 'level', 1);
      let statpointsB = safeRead(rowB, pointsKeyB, 0);

      const maxHpA = dbHelper.getServerMaxHp({ endurance: safeRead(rowA, 'endurance', 1), equipped: rowA.equipped || {} });
      const maxHpB = dbHelper.getServerMaxHp({ endurance: safeRead(rowB, 'endurance', 1), equipped: rowB.equipped || {} });

      let endHpA = maxHpA;
      let endHpB = maxHpB;

      if (result === 'win') {
        const pvpXp = calculatePvpXp(levelA, levelB);
        goldA += goldReward;
        xpA += pvpXp;

        const correctLevelA = dbHelper.getServerCorrectLevelByXp(xpA);
        if (correctLevelA > levelA) {
          statpointsA += (correctLevelA - levelA) * 5;
          levelA = correctLevelA;
        }

        // 🔥 ИСПРАВЛЕНО: Победитель сохраняет остаток своего ХП из боя (но не меньше 1)
        endHpA = Math.max(1, Number(playerA.currentHp));
        endHpB = Math.max(1, Math.floor(maxHpB * 0.2)); // Проигравшему Evil пишем легальные 20%
      } 
      else if (result === 'lose') {
        const pvpXp = calculatePvpXp(levelB, levelA);
        goldB += goldReward;
        xpB += pvpXp;

        const correctLevelB = dbHelper.getServerCorrectLevelByXp(xpB);
        if (correctLevelB > levelB) {
          statpointsB += (correctLevelB - levelB) * 5;
          levelB = correctLevelB;
        }

        endHpA = Math.max(1, Math.floor(maxHpA * 0.2)); // Проигравшему Яну пишем легальные 20%
        // 🔥 ИСПРАВЛЕНО: Победитель сохраняет остаток своего ХП из боя (но не меньше 1)
        endHpB = Math.max(1, Number(playerB.currentHp));
      }
      else if (result === 'lose') {
        const pvpXp = calculatePvpXp(levelB, levelA);
        goldB += goldReward;
        xpB += pvpXp;

        const correctLevelB = dbHelper.getServerCorrectLevelByXp(xpB);
        if (correctLevelB > levelB) {
          statpointsB += (correctLevelB - levelB) * 5;
          levelB = correctLevelB;
        }

        endHpA = Math.max(1, Math.floor(maxHpA * 0.2));
        endHpB = maxHpB;
      } 
      else {
        endHpA = Math.max(1, Math.floor(maxHpA * 0.2));
        endHpB = Math.max(1, Math.floor(maxHpB * 0.2));
      }

    await Promise.all([
        sb.from('players').update({
          gold: Number(goldA), xp: Number(xpA), level: Number(levelA),
          inventory: rowA.inventory,
          equipped: rowA.equipped,
          [pointsKeyA]: Number(statpointsA), hp: Number(endHpA)
        }).eq('id', Number(playerA.id)),

        sb.from('players').update({
          gold: Number(goldB), xp: Number(xpB), level: Number(levelB),
          inventory: rowB.inventory,
          equipped: rowB.equipped,
          [pointsKeyB]: Number(statpointsB), hp: Number(endHpB)
        }).eq('id', Number(playerB.id))
      ]);

      console.log("☁️ [БД PvP УСПЕХ] Данные успешно сохранены.");

    } catch (err) {
      console.error("❌ Фатальная ошибка транзакции PvP наград:", err);
    }
  }

};