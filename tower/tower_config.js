// ============================================================================
// ===== 🏰 КАТАЛОГ МАГАЗИНА БЕСКОНЕЧНОЙ БАШНИ (TOWER/TOWER_CONFIG.JS) =====
// ============================================================================

const TOWER_SHOP_DATABASE = {
  'tower_elixir_big':  { price: 20, level: 1, type: 'consumable', slotType: 'potion', name: "Эликсир Инквизитора", desc: "Концентрированный хил Башни. +50 HP." },
  'tower_sword_epic':  { price: 300, level: 5, reqAgility: 14, type: 'equipment', slotType: 'mainHand', name: "Оскверненный Клинок", desc: "Оружие, впитавшее кровь Стражей Башни." },
  'tower_shield_epic': { price: 280, level: 5, reqEndurance: 14, type: 'equipment', slotType: 'offHand', name: "Эгида Покорителя Башни", desc: "Выдерживает сокрушительные критические удары." }
};

module.exports = { TOWER_SHOP_DATABASE };