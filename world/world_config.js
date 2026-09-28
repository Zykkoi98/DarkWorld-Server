// ============================================================================
// ===== 🌍 КОНФИГ МИРА: РЕГИОНЫ, РЕСУРСЫ, МОБЫ (WORLD_CONFIG.JS) =====
// ============================================================================

// 8 регионов
const WORLD_REGIONS = {
  forest:   { id: 'forest',   name: 'Лес',     icon: '🌲', blocked: false },
  meadow:   { id: 'meadow',   name: 'Луг',     icon: '🌾', blocked: false },
  mountain: { id: 'mountain', name: 'Горы',    icon: '🏔️', blocked: true },
  water:    { id: 'water',    name: 'Пруд',    icon: '🌊', blocked: true },
  swamp:    { id: 'swamp',    name: 'Болото',  icon: '🌿', blocked: false },
  river:    { id: 'river',    name: 'Река',    icon: '🏞️', blocked: true },
  desert:   { id: 'desert',   name: 'Пустыня', icon: '🏜️', blocked: false },
  ice:      { id: 'ice',      name: 'Ледник',  icon: '❄️', blocked: false }
};

// Ресурсы по регионам
const REGION_RESOURCES = {
  forest:   ['wood_pine', 'wood_oak', 'herb_fern'],
  meadow:   ['herb_chamomile', 'herb_clover', 'flower_rose'],
  mountain: ['ore_copper', 'ore_iron', 'stone_granite'],
  water:    ['fish_karas', 'fish_pike', 'fish_catfish'],
  swamp:    ['herb_moss', 'herb_lotus', 'mushroom_dark'],
  river:    ['fish_trout', 'fish_salmon'],
  desert:   ['herb_aloe', 'stone_salt', 'gem_topaz'],
  ice:      ['ice_crystal', 'gem_sapphire', 'herb_frost']
};

// Названия ресурсов
const RESOURCES_DB = {
  wood_pine:       { name: 'Сосна',           icon: '🪵' },
  wood_oak:        { name: 'Дуб',             icon: '🪵' },
  herb_fern:       { name: 'Папоротник',      icon: '🌿' },
  herb_chamomile:  { name: 'Ромашка',         icon: '🌼' },
  herb_clover:     { name: 'Клевер',          icon: '☘️' },
  flower_rose:     { name: 'Роза',            icon: '🌹' },
  ore_copper:      { name: 'Медная руда',     icon: '🟠' },
  ore_iron:        { name: 'Железная руда',   icon: '⚙️' },
  stone_granite:   { name: 'Гранит',          icon: '🪨' },
  fish_karas:      { name: 'Карась',          icon: '🐟' },
  fish_pike:       { name: 'Щука',            icon: '🐟' },
  fish_catfish:    { name: 'Сом',             icon: '🐟' },
  herb_moss:       { name: 'Мох',             icon: '🌿' },
  herb_lotus:      { name: 'Лотос',           icon: '🪷' },
  mushroom_dark:   { name: 'Тёмный гриб',     icon: '🍄' },
  fish_trout:      { name: 'Форель',          icon: '🐟' },
  fish_salmon:     { name: 'Лосось',          icon: '🐟' },
  herb_aloe:       { name: 'Алоэ',            icon: '🌵' },
  stone_salt:      { name: 'Соль',            icon: '🧂' },
  gem_topaz:       { name: 'Топаз',           icon: '💎' },
  ice_crystal:     { name: 'Кристалл льда',   icon: '❄️' },
  gem_sapphire:    { name: 'Сапфир',          icon: '💎' },
  herb_frost:      { name: 'Морозная трава',  icon: '🌿' }
};

// Мобы по регионам (ID из таблицы bots)
const REGION_MONSTERS = {
  forest:   ['world_wolf', 'world_boar', 'world_snake'],
  meadow:   ['world_rabbit', 'world_bee', 'world_fox'],
  mountain: ['world_bear', 'world_eagle'],
  water:    ['world_duck', 'world_crocodile'],
  swamp:    ['world_frog', 'world_swamp_croc'],
  river:    ['world_beaver', 'world_water_snake'],
  desert:   ['world_scorpion', 'world_cobra'],
  ice:      ['world_ice_wolf', 'world_polar_bear']
};

// Строения
const BUILDINGS_DB = {
  castle_1:      { name: 'Замок Ашенваля',     icon: '🏰' },
  castle_2:      { name: 'Замок Драгонхолда',  icon: '🏰' },
  mine_entrance: { name: 'Вход в шахту',       icon: '⛏️' },
  dock:          { name: 'Причал',             icon: '⚓' },
  portal:        { name: 'Портал',             icon: '🌀' }
};

module.exports = {
  WORLD_REGIONS,
  REGION_RESOURCES,
  RESOURCES_DB,
  REGION_MONSTERS,
  BUILDINGS_DB
};