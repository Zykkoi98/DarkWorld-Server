// ============================================================================
// ===== 🛡️ МОДУЛЬ СЕРВЕРНОГО АУДИТА И МАТЕМАТИКИ МОДИФИКАТОРОВ (DB_HELPER.JS) =====
// ============================================================================

const SERVER_XP_TABLE =[
  0, 0, 20, 70, 170, 370, 770, 1570, 3070, 5570, 9570
];

const ITEMS_STAT_DB = {
  'rusty_sword':    { atk: 2, mf_antiinv: 10 },
  'iron_sword':     { atk: 7, mf_crit: 20 },
  'wooden_shield':  { def: 3, mf_anticrit: 15 },
  'steel_mace':     { atk: 12, mf_antiinv: 35 },
  'heavy_halberd':  { atk: 22, mf_crit: 50 },
  'leather_cap':    { def: 1, agility: 1, mf_inv: 15 },
  'leather_armor':  { def: 4, endurance: 1, mf_anticrit: 20 },
  'leather_boots':  { def: 1, agility: 2, mf_inv: 25 },
  'leather_gloves': { def: 1, strength: 1, mf_antiinv: 15 },
  'copper_ring':    { endurance: 1, mf_anticrit: 10 }, 
  'wolf_amulet':    { strength: 2, luck: 1, mf_crit: 15 },
  'lucky_ring':     { luck: 3, mf_crit: 30 },
  'ruby_ring':      { strength: 3, mf_antiinv: 25 }
};

function getServerCorrectLevelByXp(xp) {
  for (let lvl = SERVER_XP_TABLE.length - 1; lvl >= 1; lvl--) {
    if (xp >= SERVER_XP_TABLE[lvl]) return lvl;
  }
  return 1;
}

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

function getServerMaxHp(fighter) {
  const baseEndurance = Number(fighter.endurance || 1);
  const gearEndurance = getEquipmentBonus(fighter.equipped, 'endurance');
  const armorHp = getEquipmentBonus(fighter.equipped, 'hp') || 0;
  return ((baseEndurance + gearEndurance) * 10) + armorHp;
}

function getServerDef(fighter) {
  const baseEndurance = Number(fighter.endurance || 1);
  const gearEndurance = getEquipmentBonus(fighter.equipped, 'endurance');
  const baseDef = Math.floor((baseEndurance + gearEndurance) * 0.5); 
  const armorDef = getEquipmentBonus(fighter.equipped, 'def') || 0;
  return baseDef + armorDef;
}

function getServerMfInv(fighter) {
  const baseAgi = Number(fighter.agility || 1);
  return (baseAgi * 10) + getEquipmentBonus(fighter.equipped, 'mf_inv');
}

function getServerMfAntiInv(fighter) {
  const baseAgi = Number(fighter.agility || 1);
  return (baseAgi * 4) + getEquipmentBonus(fighter.equipped, 'mf_antiinv');
}

function getServerMfCrit(fighter) {
  const baseLuck = Number(fighter.luck || 1);
  return (baseLuck * 10) + getEquipmentBonus(fighter.equipped, 'mf_crit');
}

function getServerMfAntiCrit(fighter) {
  const baseLuck = Number(fighter.luck || 1);
  return (baseLuck * 4) + getEquipmentBonus(fighter.equipped, 'mf_anticrit');
}

const safeReadField = (dbRow, fieldName, defaultValue = 0) => {
  if (!dbRow) return defaultValue;
  const lowerName = fieldName.toLowerCase();
  return Number(dbRow[lowerName] ?? dbRow[fieldName] ?? defaultValue);
};

async function triggerLoadGameSuccess(nUserId, socket, sb) {
  try {
    const { data, error } = await sb.from('players').select('*').eq('id', nUserId);
    if (error || !data || data.length === 0) return;

    const row = data[0];
    const currentXp = safeReadField(row, 'xp', 0);
    const cloudLevel = getServerCorrectLevelByXp(currentXp);
    let pointsKey = row.statpoints !== undefined ? 'statpoints' : 'statPoints';

    const playerProfile = {
      id: row.id, name: row.name, avatar: row.avatar || "assets/avatars/hero1.png",
      level: cloudLevel, gold: safeReadField(row, 'gold', 0), xp: currentXp,
      hp: safeReadField(row, 'hp', 10), statPoints: safeReadField(row, pointsKey, 0),
      currentTownIndex: safeReadField(row, 'currenttownindex', 0),
      stats: {
        strength: safeReadField(row, 'strength', 1),
        agility: safeReadField(row, 'agility', 1),
        endurance: safeReadField(row, 'endurance', 1),
        luck: safeReadField(row, 'luck', 1)
      },
      inventory: row.inventory || { equipment: [], resources: [], consumables: [] },
      equipped: row.equipped || { rings: [null, null, null] }
    };

    socket.emit('load_game_success', { player: playerProfile });
  } catch (err) { console.error(err); }
}

module.exports = {
  ITEMS_STAT_DB, getServerMaxHp, getServerDef, getServerCorrectLevelByXp,
  getServerMfInv, getServerMfAntiInv, getServerMfCrit, getServerMfAntiCrit,
  safeReadField, triggerLoadGameSuccess,
  init: function(io, socket, sb) {
    socket.on('load_game_secure', async ({ userId, username }) => {
      try {
        const nUserId = Number(userId);
        const { data, error } = await sb.from('players').select('*').eq('id', nUserId);
        if (error) return socket.emit('load_game_failed', { message: error.message });

        if (data && data.length > 0) {
          let cloudPlayer = data[0];
          const currentXp = safeReadField(cloudPlayer, 'xp', 0);
          const correctLevel = getServerCorrectLevelByXp(currentXp);
          const dbLevel = safeReadField(cloudPlayer, 'level', 1);

          const str = safeReadField(cloudPlayer, 'strength', 1);
          const agi = safeReadField(cloudPlayer, 'agility', 1);
          const end = safeReadField(cloudPlayer, 'endurance', 1);
          const lck = safeReadField(cloudPlayer, 'luck', 1);
          
          let pointsKey = cloudPlayer.statpoints !== undefined ? 'statpoints' : 'statPoints';
          const freePoints = safeReadField(cloudPlayer, pointsKey, 0);

          const totalFighterPoints = str + agi + end + lck + freePoints;
          const maxLegalPoints = 4 + 5 + ((correctLevel - 1) * 5);

          let needsDbSync = false;
          let updatePayload = {};

          if (dbLevel !== correctLevel || totalFighterPoints > maxLegalPoints) {
            updatePayload['strength'] = 1; updatePayload['agility'] = 1; updatePayload['endurance'] = 1; updatePayload['luck'] = 1;
            updatePayload[cloudPlayer.level !== undefined ? 'level' : 'Level'] = correctLevel;
            updatePayload[pointsKey] = (5 * (correctLevel - 1)) + 5;
            updatePayload[cloudPlayer.hp !== undefined ? 'hp' : 'hp'] = getServerMaxHp({ endurance: 1, equipped: cloudPlayer.equipped || {} });
            needsDbSync = true;
          }

          if (needsDbSync) await sb.from('players').update(updatePayload).eq('id', nUserId);
          await triggerLoadGameSuccess(nUserId, socket, sb);
        } else {
          socket.emit('player_not_found', { userId, username });
        }
      } catch (err) { socket.emit('load_game_failed', { message: err.message }); }
    });

    socket.on('confirm_stat_distribution_secure', async ({ userId, distribution }) => {
      try {
        const nUserId = Number(userId);
        if (!distribution) return socket.emit('stat_distribution_error', 'Данные пусты.');
        const { data: dbPlayer } = await sb.from('players').select('*').eq('id', nUserId).maybeSingle();
        if (!dbPlayer) return socket.emit('stat_distribution_error', 'Персонаж не найден.');

        const currentXp = safeReadField(dbPlayer, 'xp', 0);
        const cloudLevel = getServerCorrectLevelByXp(currentXp);

        let totalSpentNow = 0;
        const statsKeys = ['strength', 'agility', 'endurance', 'luck'];
        for (const key of statsKeys) {
          const spent = Number(distribution[key] || 0);
          if (spent < 0) return socket.emit('stat_distribution_error', 'Отрицательное значение стата!');
          totalSpentNow += spent;
        }
        if (totalSpentNow === 0) return socket.emit('stat_distribution_error', 'Вы не выбрали статы.');

        const totalDbStatsSum = safeReadField(dbPlayer, 'strength', 1) + safeReadField(dbPlayer, 'agility', 1) + safeReadField(dbPlayer, 'endurance', 1) + safeReadField(dbPlayer, 'luck', 1);
        let finalPointsKey = dbPlayer.statpoints !== undefined ? 'statpoints' : 'statPoints';
        const currentDbFreePoints = safeReadField(dbPlayer, finalPointsKey, 0);
        const maxLegalTotalPoints = 4 + 5 + ((cloudLevel - 1) * 5);
        const projectedTotal = totalDbStatsSum + totalSpentNow + (currentDbFreePoints - totalSpentNow);

        if (projectedTotal > maxLegalTotalPoints || totalSpentNow > currentDbFreePoints) {
          return socket.emit('stat_distribution_error', 'Лимит очков превышен!');
        }

        const updatePayload = { [finalPointsKey]: currentDbFreePoints - totalSpentNow };
        statsKeys.forEach(key => {
          let spent = Number(distribution[key]) || 0;
          updatePayload[key] = safeReadField(dbPlayer, key, 1) + spent;
        });

        const addedEnd = Number(distribution.endurance) || 0;
        if (addedEnd > 0) {
          updatePayload[dbPlayer.hp !== undefined ? 'hp' : 'hp'] = safeReadField(dbPlayer, 'hp', 10) + (addedEnd * 10);
        }

        await sb.from('players').update(updatePayload).eq('id', nUserId);
        await triggerLoadGameSuccess(nUserId, socket, sb);
      } catch (err) { socket.emit('stat_distribution_error', 'Внутренняя ошибка сервера.'); }
    });
  }
};