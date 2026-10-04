const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { CombatEquipment } = require("../../src/main/typescript/elvarg/game/content/combat/CombatEquipment");
const { AccuracyFormulasDpsCalc } = require("../../src/main/typescript/elvarg/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");

const ATTR_DRAGONFIRE_STATE = "combat:dragonfire:protection";
const DRAGONFIRE_WARNING_MS = 30 * 1000;

const DragonfireProtectionTier = Object.freeze({
  NONE: 0,
  ANTIFIRE: 1,
  SUPER_ANTIFIRE: 2,
});

const PARTIAL_RESIST_MESSAGE = "You manage to resist some of the dragon fire.";
const FULL_BURN_MESSAGE = "You're horribly burnt by the dragon fire!";
const FULL_PROTECTION_MESSAGE = "You are completely protected from the dragon fire.";

let PrayerHandler;

/** Called from each plugin that uses this module, before any dragonfire logic runs. */
function initDragonfireProtectionCoreAccess(api) {
  PrayerHandler = api.getPrayerHandler();
}

function normalizeState(player, options = {}) {
  if (!player) {
    return null;
  }

  const timer = player.getCombat?.().getFireImmunityTimer?.();
  let state = player.getAttribute?.(ATTR_DRAGONFIRE_STATE) ?? null;
  if (!state || typeof state !== "object") {
    state = null;
  }

  const nowMs = Date.now();
  if (state && Number.isFinite(state.endsAt) && nowMs >= state.endsAt) {
    clearDragonfireProtection(player);
    return null;
  }

  if (state) {
    return state;
  }

  if (timer && !timer.finished?.()) {
    const secondsRemaining = Number(timer.secondsRemaining?.() ?? 0);
    if (secondsRemaining > 0) {
      const fallbackState = {
        tier: DragonfireProtectionTier.ANTIFIRE,
        label: "antifire potion",
        endsAt: nowMs + secondsRemaining * 1000,
        warned: false,
      };
      player.setAttribute?.(ATTR_DRAGONFIRE_STATE, fallbackState);
      return fallbackState;
    }
  }

  return null;
}

function setDragonfireProtection(player, { tier, seconds, label }) {
  if (!player || !Number.isFinite(seconds) || seconds <= 0) {
    return false;
  }

  const normalizedTier = Number.isFinite(tier)
    ? Math.max(DragonfireProtectionTier.NONE, Math.trunc(tier))
    : DragonfireProtectionTier.NONE;

  const state = {
    tier: normalizedTier,
    label: String(label || "").trim() || "antifire potion",
    endsAt: Date.now() + Math.trunc(seconds * 1000),
    warned: false,
  };

  player.setAttribute?.(ATTR_DRAGONFIRE_STATE, state);
  player.getCombat?.().getFireImmunityTimer?.().start(seconds);
  return true;
}

function clearDragonfireProtection(player) {
  if (!player) {
    return;
  }
  player.setAttribute?.(ATTR_DRAGONFIRE_STATE, null);
  player.getCombat?.().getFireImmunityTimer?.().stop?.();
}

function processDragonfireProtection(player) {
  const state = normalizeState(player);
  if (!state) {
    return;
  }

  const remainingMs = state.endsAt - Date.now();
  if (remainingMs <= 0) {
    clearDragonfireProtection(player);
    player.getPacketSender?.().sendMessage?.(`Your ${state.label} has expired.`);
    return;
  }

  if (state.warned !== true && remainingMs <= DRAGONFIRE_WARNING_MS) {
    state.warned = true;
    player.setAttribute?.(ATTR_DRAGONFIRE_STATE, state);
    player.getPacketSender?.().sendMessage?.(`Your ${state.label} is about to expire.`);
  }
}

function getDragonfireProtectionTier(player) {
  return normalizeState(player)?.tier ?? DragonfireProtectionTier.NONE;
}

function resolveChromaticDragonfireDamage(attacker, player, options = {}) {
  const maxHit = Number.isFinite(options.maxHit) ? Math.max(0, Math.trunc(options.maxHit)) : 50;
  const closeRange = options.closeRange !== false;
  const tier = getDragonfireProtectionTier(player);
  const hasShield = CombatEquipment.hasDragonProtectionGear(player);
  const hasPrayer = PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MAGIC);

  if (
    tier >= DragonfireProtectionTier.SUPER_ANTIFIRE ||
    (tier >= DragonfireProtectionTier.ANTIFIRE && (hasShield || (closeRange && hasPrayer)))
  ) {
    return {
      damage: 0,
      accurate: true,
      message: FULL_PROTECTION_MESSAGE,
    };
  }

  if (hasShield) {
    return {
      damage: Misc.getRandom(10),
      accurate: true,
      message: PARTIAL_RESIST_MESSAGE,
    };
  }

  const accurate = AccuracyFormulasDpsCalc.rollAccuracy(attacker, player, CombatType.MAGIC);

  if (tier >= DragonfireProtectionTier.ANTIFIRE) {
    return {
      damage: Misc.getRandom(accurate ? 15 : 35),
      accurate,
      message: accurate ? PARTIAL_RESIST_MESSAGE : FULL_BURN_MESSAGE,
    };
  }

  return {
    damage: Misc.getRandom(accurate ? 30 : maxHit),
    accurate,
    message: accurate ? PARTIAL_RESIST_MESSAGE : FULL_BURN_MESSAGE,
  };
}

module.exports = {
  initDragonfireProtectionCoreAccess,
  ATTR_DRAGONFIRE_STATE,
  DragonfireProtectionTier,
  setDragonfireProtection,
  clearDragonfireProtection,
  processDragonfireProtection,
  getDragonfireProtectionTier,
  resolveChromaticDragonfireDamage,
};
