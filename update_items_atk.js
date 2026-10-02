// ============================================================================
// ===== 🔧 СКРИПТ МАССОВОГО ОБНОВЛЕНИЯ ATK В ПРЕДМЕТАХ =====
// ===== Запуск: node update_items_atk.js =====
// ===== ПРАВИЛО: atk: N → atkMin: floor(N×0.75), atkMax: ceil(N×1.25) =====
// ============================================================================

const fs = require('fs');
const path = require('path');

const ITEMS_PATH = path.join(__dirname, 'shop', 'shop_items_config.js');
const BACKUP_PATH = path.join(__dirname, 'shop', 'shop_items_config.backup.js');

// Проверяем что файл существует
if (!fs.existsSync(ITEMS_PATH)) {
  console.error(`❌ Файл не найден: ${ITEMS_PATH}`);
  process.exit(1);
}

// Читаем
const content = fs.readFileSync(ITEMS_PATH, 'utf-8');
console.log(`📂 Файл прочитан: ${content.length} символов`);

// Бэкап
fs.writeFileSync(BACKUP_PATH, content);
console.log(`💾 Бэкап сохранён: ${BACKUP_PATH}`);

// 🔥 Регулярка: ищем "atk: N" где N — число, а после — запятая или }
// Пример: "atk: 2," → "atkMin: 1, atkMax: 3,"
// Пример: "atk: 65 }" → "atkMin: 48, atkMax: 82 }"

let replacedCount = 0;

const newContent = content.replace(
  /atk:\s*(\d+)(\s*[,}])/g,
  (match, numStr, ending) => {
    const atk = parseInt(numStr, 10);

    // Правило ±25%
    const atkMin = Math.max(1, Math.floor(atk * 0.75));
    const atkMax = Math.max(atkMin, Math.ceil(atk * 1.25));

    replacedCount++;

    // Если min === max (при atk=1: min=1, max=2 — не равно) 
    // Проверка: если после округления одинаковые — оставляем фикс
    if (atkMin === atkMax) {
      return `atk: ${atk}${ending}`;
    }

    return `atkMin: ${atkMin}, atkMax: ${atkMax}${ending}`;
  }
);

// Записываем
fs.writeFileSync(ITEMS_PATH, newContent);

console.log(`✅ Обновлено ${replacedCount} предметов`);
console.log(`📁 Файл: ${ITEMS_PATH}`);
console.log(`📁 Бэкап: ${BACKUP_PATH}`);
console.log(``);
console.log(`🔍 ПРОВЕРКА — примеры из файла:`);

// Показываем первые 3 замены для проверки
const lines = newContent.split('\n');
let shown = 0;
for (const line of lines) {
  if (line.includes('atkMin:') && shown < 3) {
    console.log(`   ${line.trim().substring(0, 100)}`);
    shown++;
    if (shown >= 3) break;
  }
}

console.log(``);
console.log(`🎉 Готово!`);