// ============================================================================
// ===== 🗺️ СКРИПТ ГЕНЕРАЦИИ ВСЕХ КАРТ (GENERATE_ALL.JS) =====
// ===== Запуск: node world/generate_all.js =====
// ============================================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { generateWorld, worldExists } = require('./world_generator');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  console.log('🌍 [СТАРТ] Генерация карт мира...');

  if (await worldExists(sb, 'ashenvale_main')) {
    console.log('⏭️ Карта ashenvale_main уже есть, пропускаем');
  } else {
    await generateWorld(sb, 'ashenvale_main', 50, 50);
  }

  if (await worldExists(sb, 'dragonhold_main')) {
    console.log('⏭️ Карта dragonhold_main уже есть, пропускаем');
  } else {
    await generateWorld(sb, 'dragonhold_main', 100, 100);
  }

  if (await worldExists(sb, 'mine_1')) {
    console.log('⏭️ Карта mine_1 уже есть, пропускаем');
  } else {
    await generateWorld(sb, 'mine_1', 20, 20);
  }

  console.log('✅ [ГОТОВО] Все карты сгенерированы!');
}

main().catch(err => {
  console.error('🚨 Ошибка генерации:', err);
  process.exit(1);
});