const { CombatEquipment } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatEquipment");

const OBSIDIAN_MULTIPLIER = 1.20;

function applyObsidianDamage(entity, baseHit) {
  if (!entity || !entity.isPlayer()) {
    return baseHit;
  }
  if (CombatEquipment.wearingObsidian(entity.getAsPlayer())) {
    return baseHit * OBSIDIAN_MULTIPLIER;
  }
  return baseHit;
}

module.exports = function registerObsidianEffects(api) {
  api.registerMeleeHitModifier(applyObsidianDamage);
};
