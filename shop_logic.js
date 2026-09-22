// ============================================================================
// ===== 🛒 ИЗОЛИРОВАННЫЙ БЕЗОПАСНЫЙ СЕРВЕРНЫЙ МОДУЛЬ МАГАЗИНА (SHOP_LOGIC.JS) =====
// ============================================================================

const dbHelper = require('./db_helper');

// 🔥 СЕРВЕРНЫЙ КАТАЛОГ МАГАЗИНА (SHOP_LOGIC.JS) — ВСЕ 3 КЛАССА НА 10 УРОВНЕЙ
const SERVER_SHOP_DATABASE = {
  // === 🏹 ЛОВКАЧ: УРОВЕНЬ 1 (СЕТ ПЛУТА) ===
  'rogue_knife_1':     { price: 10,  level: 1, reqAgility: 3,  type: 'equipment', slotType: 'mainHand' },
  'rogue_offknife_1':  { price: 10,  level: 1, reqAgility: 3,  type: 'equipment', slotType: 'offHand' },  // Вторая пушка!
  'rogue_buckler_1':   { price: 8,   level: 1, reqAgility: 2,  type: 'equipment', slotType: 'offHand' },   // Щит для вариативности
  'rogue_bandana_1':   { price: 8,   level: 1, reqAgility: 2,  type: 'equipment', slotType: 'head' },
  'rogue_vest_1':      { price: 12,  level: 1, reqAgility: 3,  type: 'equipment', slotType: 'body' },
  'rogue_boots_1':     { price: 8,   level: 1, reqAgility: 2,  type: 'equipment', slotType: 'legs' },
  'rogue_wraps_1':     { price: 6,   level: 1, reqAgility: 2,  type: 'equipment', slotType: 'gloves' },
  'rogue_amulet_1':    { price: 10,  level: 1, reqAgility: 2,  type: 'equipment', slotType: 'neck' },
  'rogue_ring_1':      { price: 7,   level: 1, reqAgility: 2,  type: 'equipment', slotType: 'ring' },    // ОДНО КОЛЬЦО

  // === 🏹 ЛОВКАЧ: УРОВЕНЬ 2 (СЕТ БРОДЯГИ) ===
  'bandit_dagger_2':   { price: 25,  level: 2, reqAgility: 6,  type: 'equipment', slotType: 'mainHand' },
  'bandit_offdagger_2':{ price: 25,  level: 2, reqAgility: 6,  type: 'equipment', slotType: 'offHand' },   // Вторая пушка!
  'bandit_shield_2':   { price: 20,  level: 2, reqAgility: 5,  type: 'equipment', slotType: 'offHand' },   // Щит
  'bandit_hood_2':     { price: 18,  level: 2, reqAgility: 5,  type: 'equipment', slotType: 'head' },
  'bandit_jacket_2':   { price: 30,  level: 2, reqAgility: 7,  type: 'equipment', slotType: 'body' },
  'bandit_boots_2':    { price: 18,  level: 2, reqAgility: 5,  type: 'equipment', slotType: 'legs' },
  'bandit_gloves_2':   { price: 14,  level: 2, reqAgility: 5,  type: 'equipment', slotType: 'gloves' },
  'bandit_talisman_2': { price: 22,  level: 2, reqAgility: 5,  type: 'equipment', slotType: 'neck' },
  'bandit_ring_2':     { price: 15,  level: 2, reqAgility: 5,  type: 'equipment', slotType: 'ring' },    // ОДНО КОЛЬЦО
   // === 🏹 ЛОВКАЧ: УРОВЕНЬ 3 (СЕТ ВОРА) ===
  'thief_blade_3':     { price: 50,  level: 3, reqAgility: 11, type: 'equipment', slotType: 'mainHand' },
  'thief_offblade_3':  { price: 50,  level: 3, reqAgility: 11, type: 'equipment', slotType: 'offHand' },
  'thief_parry_3':     { price: 40,  level: 3, reqAgility: 9,  type: 'equipment', slotType: 'offHand' },
  'thief_mask_3':      { price: 35,  level: 3, reqAgility: 9,  type: 'equipment', slotType: 'head' },
  'thief_armor_3':     { price: 60,  level: 3, reqAgility: 12, type: 'equipment', slotType: 'body' },
  'thief_shoes_3':     { price: 35,  level: 3, reqAgility: 9,  type: 'equipment', slotType: 'legs' },
  'thief_bracers_3':   { price: 28,  level: 3, reqAgility: 9,  type: 'equipment', slotType: 'gloves' },
  'thief_choker_3':    { price: 45,  level: 3, reqAgility: 10, type: 'equipment', slotType: 'neck' },
  'thief_ring_3':      { price: 30,  level: 3, reqAgility: 10, type: 'equipment', slotType: 'ring' },

  // === 🏹 ЛОВКАЧ: УРОВЕНЬ 4 (СЕТ НАЕМНИКА) ===
  'mercenary_kris_4':  { price: 90,  level: 4, reqAgility: 16, type: 'equipment', slotType: 'mainHand' },
  'mercenary_offkris_4':{ price: 90, level: 4, reqAgility: 16, type: 'equipment', slotType: 'offHand' },
  'mercenary_shield_4':{ price: 70,  level: 4, reqAgility: 14, type: 'equipment', slotType: 'offHand' },
  'mercenary_cap_4':   { price: 65,  level: 4, reqAgility: 14, type: 'equipment', slotType: 'head' },
  'mercenary_coat_4':  { price: 110, level: 4, reqAgility: 18, type: 'equipment', slotType: 'body' },
  'mercenary_boots_4': { price: 65,  level: 4, reqAgility: 14, type: 'equipment', slotType: 'legs' },
  'mercenary_gloves_4':{ price: 50,  level: 4, reqAgility: 14, type: 'equipment', slotType: 'gloves' },
  'mercenary_chain_4': { price: 80,  level: 4, reqAgility: 15, type: 'equipment', slotType: 'neck' },
  'mercenary_ring_4':  { price: 55,  level: 4, reqAgility: 15, type: 'equipment', slotType: 'ring' },

  // === 🏹 ЛОВКАЧ: УРОВЕНЬ 5 (СЕТ АССАСИНА) ===
  'assassin_stiletto_5':{ price: 160, level: 5, reqAgility: 22, type: 'equipment', slotType: 'mainHand' },
  'assassin_offdagger_5':{ price: 160, level: 5, reqAgility: 22, type: 'equipment', slotType: 'offHand' },
  'assassin_aegis_5':  { price: 130, level: 5, reqAgility: 19, type: 'equipment', slotType: 'offHand' },
  'assassin_cowl_5':   { price: 120, level: 5, reqAgility: 19, type: 'equipment', slotType: 'head' },
  'assassin_shroud_5': { price: 190, level: 5, reqAgility: 25, type: 'equipment', slotType: 'body' },
  'assassin_boots_5':  { price: 120, level: 5, reqAgility: 19, type: 'equipment', slotType: 'legs' },
  'assassin_grips_5':  { price: 95,  level: 5, reqAgility: 19, type: 'equipment', slotType: 'gloves' },
  'assassin_collar_5': { price: 140, level: 5, reqAgility: 20, type: 'equipment', slotType: 'neck' },
  'assassin_band_5':   { price: 130, level: 5, reqAgility: 20, type: 'equipment', slotType: 'ring' },
  // === 🏹 ЛОВКАЧ: УРОВЕНЬ 6 (СЕТ СТАЛКЕРА) ===
  'stalker_fang_6':    { price: 240, level: 6, reqAgility: 29, type: 'equipment', slotType: 'mainHand' },
  'stalker_offfang_6': { price: 240, level: 6, reqAgility: 29, type: 'equipment', slotType: 'offHand' },
  'stalker_screen_6':  { price: 190, level: 6, reqAgility: 25, type: 'equipment', slotType: 'offHand' },
  'stalker_goggles_6': { price: 180, level: 6, reqAgility: 25, type: 'equipment', slotType: 'head' },
  'stalker_harness_6': { price: 290, level: 6, reqAgility: 32, type: 'equipment', slotType: 'body' },
  'stalker_treads_6':  { price: 180, level: 6, reqAgility: 25, type: 'equipment', slotType: 'legs' },
  'stalker_claws_6':   { price: 140, level: 6, reqAgility: 25, type: 'equipment', slotType: 'gloves' },
  'stalker_pendant_6': { price: 220, level: 6, reqAgility: 27, type: 'equipment', slotType: 'neck' },
  'stalker_ring_6':    { price: 140, level: 6, reqAgility: 27, type: 'equipment', slotType: 'ring' },

  // === 🏹 ЛОВКАЧ: УРОВЕНЬ 7 (СЕТ ТЕНИ) ===
  'shadow_wakizashi_7':{ price: 360, level: 7, reqAgility: 37, type: 'equipment', slotType: 'mainHand' },
  'shadow_offwaki_7':  { price: 360, level: 7, reqAgility: 37, type: 'equipment', slotType: 'offHand' },
  'shadow_mirror_7':   { price: 290, level: 7, reqAgility: 32, type: 'equipment', slotType: 'offHand' },
  'shadow_visage_7':   { price: 270, level: 7, reqAgility: 32, type: 'equipment', slotType: 'head' },
  'shadow_garb_7':     { price: 420, level: 7, reqAgility: 40, type: 'equipment', slotType: 'body' },
  'shadow_boots_7':    { price: 270, level: 7, reqAgility: 32, type: 'equipment', slotType: 'legs' },
  'shadow_hands_7':    { price: 210, level: 7, reqAgility: 32, type: 'equipment', slotType: 'gloves' },
  'shadow_necklace_7': { price: 330, level: 7, reqAgility: 35, type: 'equipment', slotType: 'neck' },
  'shadow_ring_7':     { price: 200, level: 7, reqAgility: 35, type: 'equipment', slotType: 'ring' },

  // === 🏹 ЛОВКАЧ: УРОВЕНЬ 8 (СЕТ ПРИЗРАКА) ===
  'phantom_edge_8':    { price: 500, level: 8, reqAgility: 46, type: 'equipment', slotType: 'mainHand' },
  'phantom_offedge_8': { price: 500, level: 8, reqAgility: 46, type: 'equipment', slotType: 'offHand' },
  'phantom_wall_8':    { price: 390, level: 8, reqAgility: 40, type: 'equipment', slotType: 'offHand' },
  'phantom_hood_8':    { price: 380, level: 8, reqAgility: 40, type: 'equipment', slotType: 'head' },
  'phantom_robes_8':   { price: 580, level: 8, reqAgility: 50, type: 'equipment', slotType: 'body' },
  'phantom_mist_8':    { price: 380, level: 8, reqAgility: 40, type: 'equipment', slotType: 'legs' },
  'phantom_touch_8':   { price: 300, level: 8, reqAgility: 40, type: 'equipment', slotType: 'gloves' },
  'phantom_chain_8':   { price: 440, level: 8, reqAgility: 43, type: 'equipment', slotType: 'neck' },
  'phantom_ring_8':    { price: 280, level: 8, reqAgility: 43, type: 'equipment', slotType: 'ring' },
  // === 🏹 ЛОВКАЧ: УРОВЕНЬ 9 (СЕТ ВЕТРА) ===
  'gale_scimitar_9':   { price: 720, level: 9, reqAgility: 56, type: 'equipment', slotType: 'mainHand' },
  'gale_offscimitar_9':{ price: 720, level: 9, reqAgility: 56, type: 'equipment', slotType: 'mainHand' }, // Слот mainHand для левой руки!
  'gale_shield_9':     { price: 550, level: 9, reqAgility: 50, type: 'equipment', slotType: 'offHand' },
  'gale_crown_9':      { price: 520, level: 9, reqAgility: 50, type: 'equipment', slotType: 'head' },
  'gale_cuirass_9':    { price: 850, level: 9, reqAgility: 62, type: 'equipment', slotType: 'body' },
  'gale_greaves_9':    { price: 520, level: 9, reqAgility: 50, type: 'equipment', slotType: 'legs' },
  'gale_gauntlets_9':  { price: 410, level: 9, reqAgility: 50, type: 'equipment', slotType: 'gloves' },
  'gale_collar_9':     { price: 620, level: 9, reqAgility: 53, type: 'equipment', slotType: 'neck' },
  'gale_ring_9':       { price: 380, level: 9, reqAgility: 53, type: 'equipment', slotType: 'ring' },

  // === 🏹 ЛОВКАЧ: УРОВЕНЬ 10 (СЕТ ВЕЛИКОГО МАСТЕРА / ПАТРИАРХА) ===
  'grandmaster_kris_10':{ price: 1000, level: 10, reqAgility: 70, type: 'equipment', slotType: 'mainHand' },
  'grandmaster_offkris_10':{ price: 1000, level: 10, reqAgility: 70, type: 'equipment', slotType: 'mainHand' }, // Слот mainHand для левой руки!
  'grandmaster_wall_10':{ price: 800,  level: 10, reqAgility: 60, type: 'equipment', slotType: 'offHand' },
  'grandmaster_mask_10':{ price: 800,  level: 10, reqAgility: 60, type: 'equipment', slotType: 'head' },
  'grandmaster_gi_10':  { price: 1200, level: 10, reqAgility: 75, type: 'equipment', slotType: 'body' },
  'grandmaster_tabi_10':{ price: 800,  level: 10, reqAgility: 60, type: 'equipment', slotType: 'legs' },
  'grandmaster_gloves_10':{ price: 650, level: 10, reqAgility: 60, type: 'equipment', slotType: 'gloves' },
  'grandmaster_amulet_10':{ price: 950, level: 10, reqAgility: 65, type: 'equipment', slotType: 'neck' },
  'grandmaster_ring_10':{ price: 900,  level: 10, reqAgility: 65, type: 'equipment', slotType: 'ring' },
  
  // === ⚡ КРИТОВИК: УРОВЕНЬ 1 (СЕТ ДИКАРЯ) ===
  'scratched_axe_1':   { price: 12,  level: 1, reqLuck: 3, type: 'equipment', slotType: 'mainHand' },
  'scratched_club_1':  { price: 12,  level: 1, reqLuck: 3, type: 'equipment', slotType: 'offHand' },   // Левая пушка
  'rusty_splitter_1':  { price: 20,  level: 1, reqLuck: 4, type: 'equipment', slotType: 'twoHanded' }, // Двуручник (2 зоны атаки!)
  'savage_band_1':     { price: 8,   level: 1, reqLuck: 2, type: 'equipment', slotType: 'head' },
  'savage_vest_1':     { price: 14,  level: 1, reqLuck: 3, type: 'equipment', slotType: 'body' },
  'savage_boots_1':    { price: 8,   level: 1, reqLuck: 2, type: 'equipment', slotType: 'legs' },
  'berserk_wraps_1':   { price: 7,   level: 1, reqLuck: 2, type: 'equipment', slotType: 'gloves' },
  'savage_pendant_1':  { price: 10,  level: 1, reqLuck: 2, type: 'equipment', slotType: 'neck' },
  'savage_ring_1':     { price: 8,   level: 1, reqLuck: 2, type: 'equipment', slotType: 'ring' },

  // === ⚡ КРИТОВИК: УРОВЕНЬ 2 (СЕТ ВАРВАРА) ===
  'barbarian_axe_2':   { price: 28,  level: 2, reqLuck: 6, type: 'equipment', slotType: 'mainHand' },
  'barbarian_blade_2': { price: 28,  level: 2, reqLuck: 6, type: 'equipment', slotType: 'offHand' },   // Левая пушка
  'scrappy_cleaver_2': { price: 45,  level: 2, reqLuck: 7, type: 'equipment', slotType: 'twoHanded' }, // Двуручник (2 зоны атаки!)
  'barbarian_helm_2':  { price: 18,  level: 2, reqLuck: 5, type: 'equipment', slotType: 'head' },
  'barbarian_jacket_2':{ price: 35,  level: 2, reqLuck: 7, type: 'equipment', slotType: 'body' },
  'barbarian_boots_2': { price: 18,  level: 2, reqLuck: 5, type: 'equipment', slotType: 'legs' },
  'berserk_gloves_2':  { price: 15,  level: 2, reqLuck: 5, type: 'equipment', slotType: 'gloves' },
  'fury_pendant_2':    { price: 24,  level: 2, reqLuck: 5, type: 'equipment', slotType: 'neck' },
  'fury_ring_2':       { price: 16,  level: 2, reqLuck: 5, type: 'equipment', slotType: 'ring' },
  // === ⚡ КРИТОВИК: УРОВЕНЬ 3 (СЕТ ИСКАТЕЛЯ) ===
  'seeker_axe_3':      { price: 55,  level: 3, reqLuck: 11, type: 'equipment', slotType: 'mainHand' },
  'seeker_fist_3':     { price: 55,  level: 3, reqLuck: 11, type: 'equipment', slotType: 'offHand' },
  'heavy_halberd':     { price: 120, level: 3, reqLuck: 13, type: 'equipment', slotType: 'twoHanded' }, // Наша легендарная алебарда!
  'seeker_hood_3':     { price: 38,  level: 3, reqLuck: 9,  type: 'equipment', slotType: 'head' },
  'seeker_hauberk_3':  { price: 65,  level: 3, reqLuck: 12, type: 'equipment', slotType: 'body' },
  'seeker_boots_3':    { price: 38,  level: 3, reqLuck: 9,  type: 'equipment', slotType: 'legs' },
  'seeker_gloves_3':   { price: 30,  level: 3, reqLuck: 9,  type: 'equipment', slotType: 'gloves' },
  'seeker_talisman_3': { price: 48,  level: 3, reqLuck: 10, type: 'equipment', slotType: 'neck' },
  'seeker_ring_3':     { price: 35,  level: 3, reqLuck: 10, type: 'equipment', slotType: 'ring' },

  // === ⚡ КРИТОВИК: УРОВЕНЬ 4 (СЕТ ГОРЦА) ===
  'highland_claymore_4':{ price: 100, level: 4, reqLuck: 16, type: 'equipment', slotType: 'mainHand' },
  'highland_dirk_4':   { price: 100, level: 4, reqLuck: 16, type: 'equipment', slotType: 'offHand' },
  'highland_broadsword_4':{ price: 180, level: 4, reqLuck: 18, type: 'equipment', slotType: 'twoHanded' },
  'highland_cap_4':    { price: 70,  level: 4, reqLuck: 14, type: 'equipment', slotType: 'head' },
  'highland_kilt_4':   { price: 120, level: 4, reqLuck: 18, type: 'equipment', slotType: 'body' },
  'highland_brogues_4':{ price: 70,  level: 4, reqLuck: 14, type: 'equipment', slotType: 'legs' },
  'highland_grips_4':  { price: 55,  level: 4, reqLuck: 14, type: 'equipment', slotType: 'gloves' },
  'highland_torque_4': { price: 85,  level: 4, reqLuck: 15, type: 'equipment', slotType: 'neck' },
  'highland_loop_4':   { price: 60,  level: 4, reqLuck: 15, type: 'equipment', slotType: 'ring' },

  // === ⚡ КРИТОВИК: УРОВЕНЬ 5 (СЕТ ГЛАДИАТОР А РАЗРУШЕНИЯ) ===
  'slasher_axe_5':     { price: 180, level: 5, reqLuck: 22, type: 'equipment', slotType: 'mainHand' },
  'slasher_spike_5':   { price: 180, level: 5, reqLuck: 22, type: 'equipment', slotType: 'offHand' },
  'ravager_maul_5':    { price: 300, level: 5, reqLuck: 25, type: 'equipment', slotType: 'twoHanded' },
  'skull_helmet_5':    { price: 130, level: 5, reqLuck: 19, type: 'equipment', slotType: 'head' },
  'ravager_plate_5':   { price: 210, level: 5, reqLuck: 25, type: 'equipment', slotType: 'body' },
  'ravager_boots_5':   { price: 130, level: 5, reqLuck: 19, type: 'equipment', slotType: 'legs' },
  'ravager_gauntlets_5':{ price: 100, level: 5, reqLuck: 19, type: 'equipment', slotType: 'gloves' },
  'ravager_choker_5':  { price: 150, level: 5, reqLuck: 20, type: 'equipment', slotType: 'neck' },
  'ravager_band_5':    { price: 140, level: 5, reqLuck: 20, type: 'equipment', slotType: 'ring' },

  // === ⚡ КРИТОВИК: УРОВЕНЬ 6 (СЕТ БЕРСЕРКА) ===
  'berserk_machete_6': { price: 260, level: 6, reqLuck: 29, type: 'equipment', slotType: 'mainHand' },
  'berserk_hook_6':    { price: 260, level: 6, reqLuck: 29, type: 'equipment', slotType: 'offHand' },
  'berserk_greataxe_6':{ price: 420, level: 6, reqLuck: 32, type: 'equipment', slotType: 'twoHanded' },
  'berserk_crown_6':   { price: 190, level: 6, reqLuck: 25, type: 'equipment', slotType: 'head' },
  'berserk_cuirass_6': { price: 310, level: 6, reqLuck: 32, type: 'equipment', slotType: 'body' },
  'berserk_greaves_6': { price: 190, level: 6, reqLuck: 25, type: 'equipment', slotType: 'legs' },
  'berserk_fists_6':   { price: 150, level: 6, reqLuck: 25, type: 'equipment', slotType: 'gloves' },
  'berserk_collar_6':  { price: 240, level: 6, reqLuck: 27, type: 'equipment', slotType: 'neck' },
  'berserk_signet_6':  { price: 210, level: 6, reqLuck: 27, type: 'equipment', slotType: 'ring' },
  // === ⚡ КРИТОВИК: УРОВЕНЬ 7 (СЕТ КРОВИ) ===
  'blood_cleaver_7':   { price: 380, level: 7, reqLuck: 38, type: 'equipment', slotType: 'mainHand' },
  'blood_hook_7':      { price: 380, level: 7, reqLuck: 38, type: 'equipment', slotType: 'offHand' },
  'bloodlust_harvester_7':{ price: 620, level: 7, reqLuck: 42, type: 'equipment', slotType: 'twoHanded' },
  'blood_mask_7':      { price: 280, level: 7, reqLuck: 34, type: 'equipment', slotType: 'head' },
  'bloodlust_plate_7': { price: 450, level: 7, reqLuck: 42, type: 'equipment', slotType: 'body' },
  'blood_boots_7':     { price: 280, level: 7, reqLuck: 34, type: 'equipment', slotType: 'legs' },
  'blood_gloves_7':    { price: 220, level: 7, reqLuck: 34, type: 'equipment', slotType: 'gloves' },
  'blood_amulet_7':    { price: 340, level: 7, reqLuck: 36, type: 'equipment', slotType: 'neck' },
  'doom_ring_7':       { price: 200, level: 7, reqLuck: 36, type: 'equipment', slotType: 'ring' },

  // === ⚡ КРИТОВИК: УРОВЕНЬ 8 (СЕТ ТЕМНОГО ГЛАДИАТОР А) ===
  'reaper_blade_8':    { price: 520, level: 8, reqLuck: 48, type: 'equipment', slotType: 'mainHand' },
  'reaper_spike_8':    { price: 520, level: 8, reqLuck: 48, type: 'equipment', slotType: 'offHand' },
  'oblivion_scythe_8': { price: 850, level: 8, reqLuck: 52, type: 'equipment', slotType: 'twoHanded' },
  'reaper_helm_8':     { price: 390, level: 8, reqLuck: 42, type: 'equipment', slotType: 'head' },
  'reaper_cuirass_8':  { price: 600, level: 8, reqLuck: 52, type: 'equipment', slotType: 'body' },
  'reaper_boots_8':    { price: 390, level: 8, reqLuck: 42, type: 'equipment', slotType: 'legs' },
  'reaper_gauntlets_8':{ price: 310, level: 8, reqLuck: 42, type: 'equipment', slotType: 'gloves' },
  'reaper_talisman_8': { price: 460, level: 8, reqLuck: 45, type: 'equipment', slotType: 'neck' },
  'reaper_signet_8':   { price: 300, level: 8, reqLuck: 45, type: 'equipment', slotType: 'ring' },

  // === ⚡ КРИТОВИК: УРОВЕНЬ 9 (СЕТ ОГНЯ) ===
  'hellfire_axe_9':    { price: 750, level: 9, reqLuck: 58, type: 'equipment', slotType: 'mainHand' },
  'hellfire_claws_9':  { price: 750, level: 9, reqLuck: 58, type: 'equipment', slotType: 'offHand' },
  'inferno_breaker_9': { price: 1100,level: 9, reqLuck: 64, type: 'equipment', slotType: 'twoHanded' },
  'hellfire_crown_9':  { price: 540, level: 9, reqLuck: 52, type: 'equipment', slotType: 'head' },
  'hellfire_plate_9':  { price: 880, level: 9, reqLuck: 64, type: 'equipment', slotType: 'body' },
  'hellfire_boots_9':  { price: 540, level: 9, reqLuck: 52, type: 'equipment', slotType: 'legs' },
  'hellfire_gloves_9': { price: 430, level: 9, reqLuck: 52, type: 'equipment', slotType: 'gloves' },
  'hellfire_pendant_9':{ price: 650, level: 9, reqLuck: 55, type: 'equipment', slotType: 'neck' },
  'hellfire_loop_9':   { price: 400, level: 9, reqLuck: 55, type: 'equipment', slotType: 'ring' },

  // === ⚡ КРИТОВИК: УРОВЕНЬ 10 (СЕТ ПАЛАЧА / ПОВЕЛИТЕЛЯ РОКА) ===
  'executioner_axe_10':{ price: 1100,level: 10,reqLuck: 72, type: 'equipment', slotType: 'mainHand' },
  'executioner_dagger_10':{ price: 1100,level: 10,reqLuck: 72, type: 'equipment', slotType: 'offHand' },
  'executioner_scythe_10':{ price: 1600,level: 10,reqLuck: 78, type: 'equipment', slotType: 'twoHanded' }, // Главная коса на 2 зоны атаки!
  'executioner_mask_10':{ price: 850, level: 10,reqLuck: 62, type: 'equipment', slotType: 'head' },
  'warlord_cuirass_10':{ price: 1300,level: 10,reqLuck: 78, type: 'equipment', slotType: 'body' },
  'executioner_tabi_10':{ price: 850, level: 10,reqLuck: 62, type: 'equipment', slotType: 'legs' },
  'executioner_gloves_10':{ price: 680, level: 10,reqLuck: 62, type: 'equipment', slotType: 'gloves' },
  'executioner_collar_10':{ price: 990, level: 10,reqLuck: 66, type: 'equipment', slotType: 'neck' },
  'executioner_ring_10':{ price: 950, level: 10,reqLuck: 66, type: 'equipment', slotType: 'ring' },
  // === 🪵 ТАНК: УРОВЕНЬ 1 (СЕТ РЕКРУТА) ===
  'wooden_club_1':     { price: 10,  level: 1, reqEndurance: 3, type: 'equipment', slotType: 'mainHand' },
  'recruit_knife_1':   { price: 10,  level: 1, reqEndurance: 3, type: 'equipment', slotType: 'offHand' },
  'wooden_shield':     { price: 15,  level: 1, reqEndurance: 2, type: 'equipment', slotType: 'offHand' }, // Открывает 3 блока!
  'recruit_cap_1':     { price: 8,   level: 1, reqEndurance: 2, type: 'equipment', slotType: 'head' },
  'recruit_vest_1':    { price: 14,  level: 1, reqEndurance: 3, type: 'equipment', slotType: 'body' },
  'recruit_boots_1':   { price: 8,   level: 1, reqEndurance: 2, type: 'equipment', slotType: 'legs' },
  'recruit_gloves_1':  { price: 7,   level: 1, reqEndurance: 2, type: 'equipment', slotType: 'gloves' },
  'recruit_talisman_1':{ price: 10,  level: 1, reqEndurance: 2, type: 'equipment', slotType: 'neck' },
  'recruit_ring_1':    { price: 8,   level: 1, reqEndurance: 2, type: 'equipment', slotType: 'ring' },

  // === 🪵 ТАНК: УРОВЕНЬ 2 (СЕТ ОПОЛЧЕНЦА) ===
  'iron_mace_2':       { price: 28,  level: 2, reqEndurance: 6, type: 'equipment', slotType: 'mainHand' },
  'militia_dagger_2':  { price: 25,  level: 2, reqEndurance: 6, type: 'equipment', slotType: 'offHand' },
  'militia_shield_2':  { price: 24,  level: 2, reqEndurance: 5, type: 'equipment', slotType: 'offHand' }, // Щит 2 уровня
  'iron_helm_2':       { price: 20,  level: 2, reqEndurance: 5, type: 'equipment', slotType: 'head' },
  'recruit_chain_2':   { price: 45,  level: 2, reqEndurance: 7, type: 'equipment', slotType: 'body' },
  'militia_boots_2':   { price: 18,  level: 2, reqEndurance: 5, type: 'equipment', slotType: 'legs' },
  'militia_gloves_2':  { price: 14,  level: 2, reqEndurance: 5, type: 'equipment', slotType: 'gloves' },
  'militia_chain_2':   { price: 24,  level: 2, reqEndurance: 5, type: 'equipment', slotType: 'neck' },
  'militia_ring_2':    { price: 16,  level: 2, reqEndurance: 5, type: 'equipment', slotType: 'ring' },

  // === 🪵 ТАНК: УРОВЕНЬ 3 (СЕТ СТРАЖНИКА) ===
  'heavy_flail_3':     { price: 60,  level: 3, reqEndurance: 11, type: 'equipment', slotType: 'mainHand' },
  'guard_dirk_3':      { price: 50,  level: 3, reqEndurance: 11, type: 'equipment', slotType: 'offHand' },
  'knight_shield_3':   { price: 75,  level: 3, reqEndurance: 9,  type: 'equipment', slotType: 'offHand' }, // Щит 3 уровня
  'guard_helm_3':      { price: 40,  level: 3, reqEndurance: 9,  type: 'equipment', slotType: 'head' },
  'guard_cuirass_3':   { price: 80,  level: 3, reqEndurance: 12, type: 'equipment', slotType: 'body' },
  'guard_boots_3':     { price: 40,  level: 3, reqEndurance: 9,  type: 'equipment', slotType: 'legs' },
  'guard_gloves_3':    { price: 32,  level: 3, reqEndurance: 9,  type: 'equipment', slotType: 'gloves' },
  'guard_gorget_3':    { price: 50,  level: 3, reqEndurance: 10, type: 'equipment', slotType: 'neck' },
  'guard_signet_3':    { price: 38,  level: 3, reqEndurance: 10, type: 'equipment', slotType: 'ring' },

  // === 🪵 ТАНК: УРОВЕНЬ 4 (СЕТ ОРДЕНА ВЕРНОСТИ) ===
  'order_mace_4':      { price: 100, level: 4, reqEndurance: 16, type: 'equipment', slotType: 'mainHand' },
  'order_blade_4':     { price: 90,  level: 4, reqEndurance: 16, type: 'equipment', slotType: 'offHand' },
  'order_shield_4':    { price: 110, level: 4, reqEndurance: 14, type: 'equipment', slotType: 'offHand' },
  'order_barbute_4':   { price: 70,  level: 4, reqEndurance: 14, type: 'equipment', slotType: 'head' },
  'order_breastplate_4':{ price: 150,level: 4, reqEndurance: 18, type: 'equipment', slotType: 'body' },
  'order_sabatons_4':  { price: 70,  level: 4, reqEndurance: 14, type: 'equipment', slotType: 'legs' },
  'order_gauntlets_4': { price: 55,  level: 4, reqEndurance: 14, type: 'equipment', slotType: 'gloves' },
  'order_collar_4':    { price: 85,  level: 4, reqEndurance: 15, type: 'equipment', slotType: 'neck' },
  'order_loop_4':      { price: 60,  level: 4, reqEndurance: 15, type: 'equipment', slotType: 'ring' },

  // === 🪵 ТАНК: УРОВЕНЬ 5 (СЕТ ХРАНИТЕЛЯ БАСТИОНА) ===
  'steel_mace_5':      { price: 180, level: 5, reqEndurance: 22, type: 'equipment', slotType: 'mainHand' },
  'guardian_spike_5':  { price: 160, level: 5, reqEndurance: 22, type: 'equipment', slotType: 'offHand' },
  'guardian_wall_5':   { price: 210, level: 5, reqEndurance: 19, type: 'equipment', slotType: 'offHand' },
  'guardian_visor_5':  { price: 130, level: 5, reqEndurance: 19, type: 'equipment', slotType: 'head' },
  'guardian_plate_5':  { price: 250, level: 5, reqEndurance: 25, type: 'equipment', slotType: 'body' },
  'heavy_boots_5':     { price: 130, level: 5, reqEndurance: 19, type: 'equipment', slotType: 'legs' },
  'guardian_crags_5':  { price: 100, level: 5, reqEndurance: 19, type: 'equipment', slotType: 'gloves' },
  'guardian_torque_5': { price: 160, level: 5, reqEndurance: 20, type: 'equipment', slotType: 'neck' },
  'guardian_seal_5':   { price: 140, level: 5, reqEndurance: 20, type: 'equipment', slotType: 'ring' },
  // === 🪵 ТАНК: УРОВЕНЬ 6 (СЕТ ЦЕНТУРИОНА) ===
  'centurion_gladius_6':{ price: 250, level: 6, reqEndurance: 29, type: 'equipment', slotType: 'mainHand' },
  'centurion_pugio_6':  { price: 220, level: 6, reqEndurance: 29, type: 'equipment', slotType: 'offHand' },
  'centurion_scutum_6': { price: 260, level: 6, reqEndurance: 25, type: 'equipment', slotType: 'offHand' },
  'centurion_galea_6':  { price: 180, level: 6, reqEndurance: 25, type: 'equipment', slotType: 'head' },
  'centurion_lorica_6': { price: 320, level: 6, reqEndurance: 32, type: 'equipment', slotType: 'body' },
  'centurion_caligae_6':{ price: 180, level: 6, reqEndurance: 25, type: 'equipment', slotType: 'legs' },
  'centurion_manica_6': { price: 140, level: 6, reqEndurance: 25, type: 'equipment', slotType: 'gloves' },
  'centurion_torc_6':   { price: 230, level: 6, reqEndurance: 27, type: 'equipment', slotType: 'neck' },
  'centurion_signet_6': { price: 190, level: 6, reqEndurance: 27, type: 'equipment', slotType: 'ring' },

  // === 🪵 ТАНК: УРОВЕНЬ 7 (СЕТ ДРЕВНЕГО СТРАЖА) ===
  'ancient_pillar_7':   { price: 370, level: 7, reqEndurance: 38, type: 'equipment', slotType: 'mainHand' },
  'ancient_spike_7':    { price: 320, level: 7, reqEndurance: 38, type: 'equipment', slotType: 'offHand' },
  'bastion_shield_7':   { price: 400, level: 7, reqEndurance: 34, type: 'equipment', slotType: 'offHand' },
  'ancient_visage_7':   { price: 270, level: 7, reqEndurance: 34, type: 'equipment', slotType: 'head' },
  'ancient_carapace_7': { price: 460, level: 7, reqEndurance: 42, type: 'equipment', slotType: 'body' },
  'ancient_greaves_7':  { price: 270, level: 7, reqEndurance: 34, type: 'equipment', slotType: 'legs' },
  'ancient_gauntlets_7':{ price: 210, level: 7, reqEndurance: 34, type: 'equipment', slotType: 'gloves' },
  'ancient_amulet_7':   { price: 330, level: 7, reqEndurance: 36, type: 'equipment', slotType: 'neck' },
  'ancient_seal_7':     { price: 240, level: 7, reqEndurance: 36, type: 'equipment', slotType: 'ring' },

  // === 🪵 ТАНК: УРОВЕНЬ 8 (СЕТ РЫЦАРЯ СТАЛИ) ===
  'gothic_warhammer_8': { price: 510, level: 8, reqEndurance: 48, type: 'equipment', slotType: 'mainHand' },
  'gothic_dagger_8':    { price: 450, level: 8, reqEndurance: 48, type: 'equipment', slotType: 'offHand' },
  'gothic_bulwark_8':   { price: 550, level: 8, reqEndurance: 42, type: 'equipment', slotType: 'offHand' },
  'gothic_armet_8':     { price: 380, level: 8, reqEndurance: 42, type: 'equipment', slotType: 'head' },
  'gothic_harness_8':   { price: 620, level: 8, reqEndurance: 52, type: 'equipment', slotType: 'body' },
  'gothic_sollerets_8': { price: 380, level: 8, reqEndurance: 42, type: 'equipment', slotType: 'legs' },
  'gothic_gauntlets_8': { price: 300, level: 8, reqEndurance: 42, type: 'equipment', slotType: 'gloves' },
  'gothic_gorget_8':    { price: 440, level: 8, reqEndurance: 45, type: 'equipment', slotType: 'neck' },
  'gothic_loop_8':      { price: 290, level: 8, reqEndurance: 45, type: 'equipment', slotType: 'ring' },

  // === 🪵 ТАНК: УРОВЕНЬ 9 (СЕТ ТИТАНА) ===
  'titan_breaker_9':    { price: 740, level: 9, reqEndurance: 58, type: 'equipment', slotType: 'mainHand' },
  'titan_dirk_9':       { price: 650, level: 9, reqEndurance: 58, type: 'equipment', slotType: 'offHand' },
  'titan_wall_9':       { price: 800, level: 9, reqEndurance: 52, type: 'equipment', slotType: 'offHand' },
  'titan_crown_9':      { price: 520, level: 9, reqEndurance: 52, type: 'equipment', slotType: 'head' },
  'titan_cuirass_9':    { price: 920, level: 9, reqEndurance: 64, type: 'equipment', slotType: 'body' },
  'titan_treads_9':     { price: 520, level: 9, reqEndurance: 52, type: 'equipment', slotType: 'legs' },
  'titan_fists_9':      { price: 410, level: 9, reqEndurance: 52, type: 'equipment', slotType: 'gloves' },
  'titan_collar_9':     { price: 620, level: 9, reqEndurance: 55, type: 'equipment', slotType: 'neck' },
  'titan_band_9':       { price: 380, level: 9, reqEndurance: 55, type: 'equipment', slotType: 'ring' },

  // === 🪵 ТАНК: УРОВЕНЬ 10 (СЕТ БЕССМЕРТНОГО) ===
  'paladin_glaive_10':  { price: 1000,level: 10,reqEndurance: 72, type: 'equipment', slotType: 'mainHand' },
  'immortal_parry_10':  { price: 900, level: 10,reqEndurance: 72, type: 'equipment', slotType: 'offHand' },
  'aegis_wall_10':      { price: 1200,level: 10,reqEndurance: 62, type: 'equipment', slotType: 'offHand' }, // Топовый щит
  'immortal_helm_10':   { price: 800, level: 10,reqEndurance: 62, type: 'equipment', slotType: 'head' },
  'immortal_cuirass_10':{ price: 1500,level: 10,reqEndurance: 78, type: 'equipment', slotType: 'body' },
  'immortal_greaves_10':{ price: 800, level: 10,reqEndurance: 62, type: 'equipment', slotType: 'legs' },
  'immortal_gauntlets_10':{ price: 650,level: 10,reqEndurance: 62, type: 'equipment', slotType: 'gloves' },
  'immortal_talisman_10':{ price: 950,level: 10,reqEndurance: 66, type: 'equipment', slotType: 'neck' },
  'immortal_seal_10':   { price: 900, level: 10,reqEndurance: 66, type: 'equipment', slotType: 'ring' }

};
module.exports = function(io, socket, sb) {
  // ⚡ ВАЖНО: Мы вешаем слушатель НАПРЯМУЮ на socket, пришедший из server.js.
  // Никаких внутренних io.on('connection') здесь быть не должно!
  if (!socket) return; 

  console.log(`🛒 [МАГАЗИН ИНИЦИАЛИЗАЦИЯ] Слушатель привязан к сокету: ${socket.id}`);

  // Принимаем защищенный пакет покупки
socket.on('buy_item_secure', async ({ userId, itemId }) => {
    try {
      const nUserId = Number(userId);
      if (!nUserId) {
        return socket.emit('shop_buy_error', { message: "❌ Ошибка: Неверный ID пользователя сокета!" });
      }

      const itemConfig = SERVER_SHOP_DATABASE[itemId];
      if (!itemConfig) {
        return socket.emit('shop_buy_error', { message: "🚨 Товар не существует в каталоге магазина!" });
      }

      console.log(`🛒 [МАГАЗИН ЗАПРОС] Игрок ID: ${nUserId} покупает: ${itemId}`);

      // Запрос к Supabase
      const { data: playerRow, error: dbError } = await sb.from('players')
        .select('*')
        .eq('id', nUserId)
        .maybeSingle();

      if (dbError) {
        console.error(`🚨 [SUPABASE ERROR]:`, dbError.message);
        return socket.emit('shop_buy_error', { message: `🚨 Ошибка базы данных Supabase: ${dbError.message}` });
      }

      if (!playerRow) {
        console.warn(`❌ Игрок ID ${nUserId} не найден в таблице players.`);
        return socket.emit('shop_buy_error', { message: "❌ Ошибка: Ваш профиль игрока не найден в базе данных!" });
      }

      // Безопасное чтение золота и уровня с подстраховкой регистра букв
      const currentGold = Number(playerRow.gold ?? playerRow.Gold ?? 0);
      const currentLevel = Number(playerRow.level ?? playerRow.Level ?? 1);

      // БРОНИРОВАННОЕ ЧТЕНИЕ СТАТОВ: проверяем и корень таблицы, и вложенный объект stats
      const pAgility = Number(playerRow.agility ?? playerRow.agi ?? playerRow.stats?.agility ?? playerRow.stats?.agi ?? 1);
      const pLuck = Number(playerRow.luck ?? playerRow.lck ?? playerRow.stats?.luck ?? playerRow.stats?.lck ?? 1);
      const pEndurance = Number(playerRow.endurance ?? playerRow.endur ?? playerRow.endure ?? playerRow.stats?.endurance ?? playerRow.stats?.endure ?? 1);

      // Проверка требований античита
      if (itemConfig.reqEndurance && pEndurance < itemConfig.reqEndurance) {
        return socket.emit('shop_buy_error', { message: `❌ Недостаточно Выносливости! Требуется: 🛡️${itemConfig.reqEndurance}, у вас: 🛡️${pEndurance}` });
      }
      if (itemConfig.reqAgility && pAgility < itemConfig.reqAgility) {
        return socket.emit('shop_buy_error', { message: `❌ Недостаточно Ловкости! Требуется: 🏹${itemConfig.reqAgility}, у вас: 🏹${pAgility}` });
      }
      if (itemConfig.reqLuck && pLuck < itemConfig.reqLuck) {
        return socket.emit('shop_buy_error', { message: `❌ Недостаточно Удачи! Требуется: 🍀${itemConfig.reqLuck}, у вас: 🍀${pLuck}` });
      }
      if (currentGold < itemConfig.price) {
        return socket.emit('shop_buy_error', { message: `❌ Недостаточно золота! Нужно: 💰${itemConfig.price}, у вас: 💰${currentGold}` });
      }
      if (currentLevel < itemConfig.level) {
        return socket.emit('shop_buy_error', { message: `❌ Слишком низкий уровень! Требуется: Lv. ${itemConfig.level}` });
      }

      // Безопасная сборка инвентаря jsonb
      let inventory = playerRow.inventory;
      if (!inventory || typeof inventory !== 'object') {
        inventory = { equipment: [], consumables: [], resources: [] };
      }
      if (!inventory.equipment || !Array.isArray(inventory.equipment)) {
        inventory.equipment = [];
      }

      // Генерируем уникальную вещь
      const newInstance = {
        uuid: `${itemId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        id: itemId
      };
      
      inventory.equipment.push(newInstance);
      const updatedGold = currentGold - itemConfig.price;

      // Атомарное сохранение в Supabase
      const { error: updateError } = await sb.from('players')
        .update({ gold: Number(updatedGold), inventory: inventory })
        .eq('id', nUserId);

      if (updateError) {
        console.error(`🚨 [ОШИБКА ЗАПИСИ]:`, updateError.message);
        return socket.emit('shop_buy_error', { message: `❌ Ошибка сохранения рюкзака в Supabase: ${updateError.message}` });
      }

      // Безопасная сборка профиля для отправки на фронтенд
      const cleanPlayerProfile = {
        id: Number(playerRow.id),
        name: playerRow.name,
        level: Number(currentLevel),
        xp: Number(playerRow.xp ?? playerRow.Xp ?? 0),
        gold: Number(updatedGold),
        hp: Number(playerRow.hp ?? playerRow.Hp ?? 10),
        statPoints: Number(playerRow.statpoints ?? playerRow.statPoints ?? playerRow.stat_points ?? 0),
        stats: {
          strength: Number(playerRow.strength ?? playerRow.stats?.strength ?? 1),
          agility: Number(pAgility),
          endurance: Number(pEndurance),
          luck: Number(pLuck)
        },
        inventory: inventory,
        equipped: playerRow.equipped || { rings: [null, null, null] }
      };

      socket.emit('shop_buy_success', { 
        message: "🎉 Предмет успешно куплен и добавлен в рюкзак!",
        player: cleanPlayerProfile 
      });

    } catch (err) {
      console.error("❌ Фатальный сбой внутри модуля магазина:", err);
      // 🔥 ОБЯЗАТЕЛЬНО ОТПРАВЛЯЕМ ОШИБКУ НА ЭКРАН, ЧТОБЫ КНОПКА НЕ ВИСЛА В ОЖИДАНИИ
      socket.emit('shop_buy_error', { message: `🚨 Внутренний сбой бэкенда: ${err.message}` });
    }
  });
};