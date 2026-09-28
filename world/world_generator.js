// ============================================================================
// ===== 🗺️ ГЕНЕРАТОР КАРТЫ МИРА (WORLD_GENERATOR.JS) =====
// ============================================================================

const { WORLD_REGIONS, REGION_RESOURCES, REGION_MONSTERS } = require('./world_config');

// ----------------------------------------------------------------------------
// ГЛАВНАЯ ФУНКЦИЯ: Генерирует карту заданного размера
// ----------------------------------------------------------------------------
async function generateWorld(sb, mapId, width, height) {
  console.log(`🗺️ [ГЕНЕРАЦИЯ] Карта ${mapId} (${width}x${height})...`);
  
  const tiles = [];
  const resources = [];
  const monsters = [];

  const centerX = width / 2;
  const centerY = height / 2;
  const maxDistance = Math.sqrt(centerX ** 2 + centerY ** 2);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const region = pickRegion(x, y, width, height);
      const blocked = WORLD_REGIONS[region].blocked;
      
      tiles.push({
        map_id: mapId, x, y,
        region,
        building: null,
        portal_to: null,
        is_blocked: blocked
      });

      // Прогресс от центра (0..1)
      const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
      const progress = distance / maxDistance;
      const maxLevel = 10;
      const monsterLevel = Math.max(1, Math.floor(1 + progress * (maxLevel - 1)));

      // Ресурсы (25% шанс)
      if (!blocked && Math.random() < 0.25) {
        const possible = REGION_RESOURCES[region];
        if (possible && possible.length > 0) {
          const resourceId = possible[Math.floor(Math.random() * possible.length)];
          resources.push({
            map_id: mapId, x, y, resource_id: resourceId, respawn_at: null
          });
        }
      }

      // Мобы (12% шанс)
      if (!blocked && Math.random() < 0.12) {
        const possible = REGION_MONSTERS[region];
        if (possible && possible.length > 0) {
          const monsterId = possible[Math.floor(Math.random() * possible.length)];
          monsters.push({
            map_id: mapId, x, y, monster_id: monsterId,
            level: monsterLevel, respawn_at: null
          });
        }
      }
    }
  }

  console.log(`💾 [ГЕНЕРАЦИЯ] Сохраняем ${tiles.length} клеток...`);
  await insertInBatches(sb, 'world_tiles', tiles);
  
  if (resources.length > 0) {
    console.log(`💾 [ГЕНЕРАЦИЯ] Сохраняем ${resources.length} ресурсов...`);
    await insertInBatches(sb, 'world_resources', resources);
  }
  
  if (monsters.length > 0) {
    console.log(`💾 [ГЕНЕРАЦИЯ] Сохраняем ${monsters.length} мобов...`);
    await insertInBatches(sb, 'world_monsters', monsters);
  }

  console.log(`✅ [ГЕНЕРАЦИЯ] Карта ${mapId} готова!`);
}

// ----------------------------------------------------------------------------
// ВЫБОР РЕГИОНА ПО КООРДИНАТАМ
// ----------------------------------------------------------------------------
function pickRegion(x, y, width, height) {
  const nx = x / width;
  const ny = y / height;

  if (ny < 0.15) return 'ice';
  if (ny > 0.85) return 'desert';

  if (nx < 0.4 && ny < 0.5) return 'forest';
  if (nx < 0.4 && ny >= 0.5) return 'meadow';
  if (nx >= 0.6 && ny < 0.5) return 'mountain';
  if (nx >= 0.6 && ny >= 0.5) return 'water';

  if (nx >= 0.4 && nx < 0.6) {
    if (ny < 0.5) return 'swamp';
    return 'river';
  }

  return 'meadow';
}

// ----------------------------------------------------------------------------
// ПАЧКОВАЯ ВСТАВКА
// ----------------------------------------------------------------------------
async function insertInBatches(sb, table, rows, batchSize = 500) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await sb.from(table).insert(batch);
    if (error) {
      console.error(`🚨 Ошибка вставки в ${table} (батч ${i}):`, error.message);
    }
  }
}

async function worldExists(sb, mapId) {
  const { data } = await sb.from('world_tiles').select('map_id').eq('map_id', mapId).limit(1);
  return data && data.length > 0;
}

module.exports = { generateWorld, worldExists };