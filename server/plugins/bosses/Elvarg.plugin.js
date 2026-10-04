const { Boundary } = require("../../src/main/typescript/elvarg/game/model/Boundary");
const { NPC } = require("../../src/main/typescript/elvarg/game/entity/impl/npc/NPC");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { PrivateArea } = require("../../src/main/typescript/elvarg/game/model/areas/impl/PrivateArea");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");
const { CombatMethod } = require("../../src/main/typescript/elvarg/game/content/combat/method/CombatMethod");
const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { PendingHit } = require("../../src/main/typescript/elvarg/game/content/combat/hit/PendingHit");
const { Projectile } = require("../../src/main/typescript/elvarg/game/model/Projectile");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../src/main/typescript/elvarg/game/model/Graphic");
const { CombatEquipment } = require("../../src/main/typescript/elvarg/game/content/combat/CombatEquipment");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const {
  DragonfireProtectionTier,
  getDragonfireProtectionTier,
  initDragonfireProtectionCoreAccess,
} = require("../combat/DragonfireProtection");

const ATTR_PENDING_INSTANCE = "elvarg:pending_instance";
const ATTR_INSTANCE_AREA = "elvarg:instance_area";

// OSRS Elvarg spawn tile from the canonical Crandor lair data.
const ELVARG_TELEPORT_LOCATION = new Location(2852, 9637, 0);
const ELVARG_SPAWN_LOCATION = new Location(2852, 9637, 0);
const ELVARG_LAIR_BOUNDARY = new Boundary(2844, 2863, 9628, 9646, 0);
const ELVARG_IDS = new Set([
  NpcIdentifiers.ELVARG,
  NpcIdentifiers.ELVARG_2,
  NpcIdentifiers.ELVARG_3,
  8033,
]);
const ELVARG_COMBAT_PROVIDER_IDS = [...ELVARG_IDS];
const ELVARG_SPAWN_NPC_ID = NpcIdentifiers.ELVARG_3;

const ELVARG_MELEE_ANIMATION = new Animation(80);
const ELVARG_DRAGONFIRE_ANIMATION = new Animation(81);
const ELVARG_DRAGONFIRE_PROJECTILE_ID = 393;
const ELVARG_DRAGONFIRE_IMPACT_GFX = new Graphic(1);
const ELVARG_ATTACK_DISTANCE = 8;
const ELVARG_MAX_HITPOINTS = 80;
const ELVARG_MAX_MELEE_HIT = 8;
const ELVARG_MAX_DRAGONFIRE_HIT = 69;
const DRAGONFIRE_PARTIAL_RESIST_MESSAGE = "You manage to resist some of the dragon fire.";
const DRAGONFIRE_FULL_BURN_MESSAGE = "You're horribly burnt by the dragon fire!";
const DRAGONFIRE_FULL_PROTECTION_MESSAGE = "You are completely protected from the dragon fire.";

class ElvargPrivateArea extends PrivateArea {
  constructor(ownerName) {
    super([ELVARG_LAIR_BOUNDARY]);
    this.ownerName = ownerName ?? "unknown";
  }

  destroy() {
    if (this.isDestroyed?.() === true) {
      return;
    }

    const addQueue = World.getAddNPCQueue();
    const removeQueue = World.getRemoveNPCQueue();
    for (const entity of this.entities) {
      if (!entity?.isNpc?.() || !entity?.getAsNpc) {
        continue;
      }
      const npc = entity.getAsNpc();
      for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) {
        addQueue.splice(index, 1);
      }
      if (npc.isRegistered?.() && !removeQueue.includes(npc)) {
        removeQueue.push(npc);
      }
    }

    super.destroy();
  }

  postLeave(mobile, logout) {
    if (mobile?.isPlayer?.()) {
      clearInstanceAttributes(mobile.getAsPlayer(), this);
    }
    super.postLeave(mobile, logout);
  }
}

class ElvargCombatMethod extends CombatMethod {
  constructor() {
    super();
    this.useDragonfire = true;
    this.currentAttackType = CombatType.MAGIC;
  }

  start(character, target) {
    this.selectAttack(character, target);
    if (this.useDragonfire) {
      character.performAnimation(ELVARG_DRAGONFIRE_ANIMATION);
      Projectile.createProjectile(
        character,
        target,
        ELVARG_DRAGONFIRE_PROJECTILE_ID,
        40,
        55,
        31,
        43
      ).sendProjectile();
      return;
    }
    character.performAnimation(ELVARG_MELEE_ANIMATION);
  }

  attackSpeed() {
    return 4;
  }

  attackDistance() {
    return ELVARG_ATTACK_DISTANCE;
  }

  type() {
    return this.currentAttackType;
  }

  hits(character, target) {
    if (!this.useDragonfire) {
      const hit = new PendingHit(character, target, this, 1);
      hit.setTotalDamage(Math.min(ELVARG_MAX_MELEE_HIT, hit.getTotalDamage()));
      return [hit];
    }

    const hit = new PendingHit(character, target, this, {
      delay: 1,
      rollAccuracy: false,
    });

    if (target?.isPlayer?.()) {
      const player = target.getAsPlayer();
      const dragonfire = resolveElvargDragonfireDamage(player);
      hit.setTotalDamage(dragonfire.damage);
      if (dragonfire.message) {
        player.getPacketSender?.().sendMessage?.(dragonfire.message);
      }
      drainPrayerPointsFromDragonfire(player);
    } else {
      hit.setTotalDamage(Misc.randomInclusive(0, ELVARG_MAX_DRAGONFIRE_HIT));
    }

    return [hit];
  }

  handleAfterHitEffects(hit) {
    if (!this.useDragonfire) {
      return;
    }
    const target = hit?.getTarget?.();
    target?.performGraphic?.(ELVARG_DRAGONFIRE_IMPACT_GFX);
  }

  finished() {}

  selectAttack(character, target) {
    const distance = character?.calculateDistance?.(target) ?? 99;
    if (distance > 1) {
      this.useDragonfire = true;
      this.currentAttackType = CombatType.MAGIC;
      return;
    }

    // Elvarg is mostly dragonfire-oriented, but can still melee in close range.
    this.useDragonfire = Misc.randomInclusive(0, 1) === 0;
    this.currentAttackType = this.useDragonfire ? CombatType.MAGIC : CombatType.MELEE;
  }
}

function resolveElvargDragonfireDamage(player) {
  if (!player) {
    return {
      damage: Misc.randomInclusive(0, ELVARG_MAX_DRAGONFIRE_HIT),
      message: DRAGONFIRE_FULL_BURN_MESSAGE,
    };
  }

  const hasShield = CombatEquipment.hasDragonProtectionGear(player);
  const hasPrayer = PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MAGIC);
  const tier = getDragonfireProtectionTier(player);
  const hasSuperAntifire = tier >= DragonfireProtectionTier.SUPER_ANTIFIRE;
  const hasAntifire = tier >= DragonfireProtectionTier.ANTIFIRE;

  let maxDamage = ELVARG_MAX_DRAGONFIRE_HIT;

  if (hasSuperAntifire) {
    maxDamage = 0;
  } else if (hasShield && hasPrayer && hasAntifire) {
    maxDamage = 4;
  } else if (hasShield && (hasPrayer || hasAntifire)) {
    maxDamage = 7;
  } else if (hasPrayer && hasAntifire) {
    maxDamage = 40;
  } else if (hasShield) {
    maxDamage = 10;
  } else if (hasPrayer || hasAntifire) {
    maxDamage = 55;
  }

  const message = maxDamage <= 0
    ? DRAGONFIRE_FULL_PROTECTION_MESSAGE
    : maxDamage >= ELVARG_MAX_DRAGONFIRE_HIT
      ? DRAGONFIRE_FULL_BURN_MESSAGE
      : DRAGONFIRE_PARTIAL_RESIST_MESSAGE;

  return {
    damage: maxDamage <= 0 ? 0 : Misc.randomInclusive(0, maxDamage),
    message,
  };
}

function drainPrayerPointsFromDragonfire(player) {
  if (!player) {
    return;
  }
  const skillManager = player.getSkillManager?.();
  if (!skillManager) {
    return;
  }

  const currentPrayer = skillManager.getCurrentLevel?.(Skill.PRAYER);
  if (!Number.isFinite(currentPrayer) || currentPrayer <= 0) {
    return;
  }

  const drainedAmount = Math.floor(currentPrayer * 0.1);
  if (drainedAmount <= 0) {
    return;
  }

  skillManager.setCurrentLevels(Skill.PRAYER, Math.max(0, currentPrayer - drainedAmount));
}

function isElvargNpc(npc) {
  if (!npc || typeof npc.getId !== "function") {
    return false;
  }
  return ELVARG_IDS.has(npc.getId());
}

function isNearElvargTeleportLocation(player) {
  const location = player?.getLocation?.();
  if (!location || location.getZ?.() !== ELVARG_TELEPORT_LOCATION.getZ()) {
    return false;
  }
  return location.getDistance(ELVARG_TELEPORT_LOCATION) <= 3;
}

function resolveInstanceArea(player) {
  const existingArea = player.getAttribute(ATTR_INSTANCE_AREA);
  if (existingArea instanceof ElvargPrivateArea && existingArea.isDestroyed?.() !== true) {
    return existingArea;
  }

  const createdArea = new ElvargPrivateArea(player.getUsername?.());
  player.setAttribute(ATTR_INSTANCE_AREA, createdArea);
  return createdArea;
}

function clearInstanceAttributes(player, sourceArea) {
  if (!player) {
    return;
  }
  const assignedArea = player.getAttribute(ATTR_INSTANCE_AREA);
  if (
    sourceArea == null ||
    assignedArea === sourceArea ||
    assignedArea?.isDestroyed?.() === true
  ) {
    player.setAttribute(ATTR_INSTANCE_AREA, null);
  }
  player.setAttribute(ATTR_PENDING_INSTANCE, false);
}

function movePlayerIntoArea(player, area) {
  const currentArea = player.getArea?.();
  if (currentArea && currentArea !== area) {
    currentArea.leave(player, false);
    currentArea.postLeave(player, false);
  }
  if (player.getArea?.() !== area) {
    area.enter(player);
  }
}

function ensureElvargSpawn(area) {
  if (!area || area.isDestroyed?.() === true) {
    return;
  }

  const hasElvarg = (area.entities ?? []).some((entity) => {
    if (!entity?.isNpc?.() || !entity?.getAsNpc) {
      return false;
    }
    return isElvargNpc(entity.getAsNpc());
  });
  if (hasElvarg) {
    return;
  }

  const npc = NPC.create(
    ELVARG_SPAWN_NPC_ID,
    ELVARG_SPAWN_LOCATION.clone()
  );
  npc.setHitpoints?.(ELVARG_MAX_HITPOINTS);
  npc.getMovementCoordinator?.().setRadius?.(5);
  area.add(npc);
  World.getAddNPCQueue().push(npc);
}

function getElvargInArea(area) {
  if (!area || area.isDestroyed?.() === true) {
    return null;
  }
  for (const entity of area.entities ?? []) {
    if (!entity?.isNpc?.() || !entity?.getAsNpc) {
      continue;
    }
    const npc = entity.getAsNpc();
    if (npc.getHitpoints?.() > ELVARG_MAX_HITPOINTS) {
      npc.setHitpoints?.(ELVARG_MAX_HITPOINTS);
    }
    if (isElvargNpc(npc) && npc.getHitpoints?.() > 0) {
      return npc;
    }
  }
  return null;
}

function forceElvargAggression(area, player) {
  if (!player || !area || area.isDestroyed?.() === true) {
    return;
  }
  const npc = getElvargInArea(area);
  if (!npc) {
    return;
  }
  if (npc.getCombat?.().getTarget?.() === player) {
    return;
  }
  npc.getCombat?.().attack?.(player);
}

function exitInstanceToHome(player, area) {
  if (!player) {
    return;
  }

  clearInstanceAttributes(player, area);
  player.getCombat?.().reset?.();

  if (area && player.getArea?.() === area) {
    area.leave(player, false);
    area.postLeave(player, false);
  }

  player.moveTo(GameConstants.DEFAULT_LOCATION.clone());
}

function cleanupOnLogoutOrDisconnect(player) {
  if (!player) {
    return;
  }
  const area = player.getAttribute(ATTR_INSTANCE_AREA);
  if (!(area instanceof ElvargPrivateArea)) {
    clearInstanceAttributes(player, null);
    return;
  }
  exitInstanceToHome(player, area);
}

let World;
let PrayerHandler;

module.exports = {
  name: "Elvarg",
  register(api) {
    World = api.getWorld();
    PrayerHandler = api.getPrayerHandler();
    initDragonfireProtectionCoreAccess(api);
    api.onPlayerProcess(({ player }) => {
      if (!player) {
        return;
      }

      const instanceArea = player.getAttribute(ATTR_INSTANCE_AREA);
      if (instanceArea instanceof ElvargPrivateArea && instanceArea.isDestroyed?.() === true) {
        clearInstanceAttributes(player, instanceArea);
      }

      if (
        player.getAttribute(ATTR_PENDING_INSTANCE) === true &&
        isNearElvargTeleportLocation(player)
      ) {
        const area = resolveInstanceArea(player);
        movePlayerIntoArea(player, area);
        ensureElvargSpawn(area);
        forceElvargAggression(area, player);
        player.setAttribute(ATTR_PENDING_INSTANCE, false);
      }

      const currentArea = player.getArea?.();
      if (!(currentArea instanceof ElvargPrivateArea)) {
        return;
      }
      forceElvargAggression(currentArea, player);
    });

    api.onNpcDeath(({ npc }) => {
      if (!isElvargNpc(npc)) {
        return;
      }

      const area = npc.getArea?.();
      if (!(area instanceof ElvargPrivateArea)) {
        return;
      }

      npc.__skipDefaultRespawn = true;

      const players = [...(area.getPlayers?.() ?? [])];
      for (const player of players) {
        exitInstanceToHome(player, area);
      }
    });

    api.onPlayerLogout(({ player }) => {
      cleanupOnLogoutOrDisconnect(player);
    });

    api.onPlayerDisconnect(({ player }) => {
      cleanupOnLogoutOrDisconnect(player);
    });

    api.registerNpcCombatMethodProvider(
      ELVARG_COMBAT_PROVIDER_IDS,
      ElvargCombatMethod,
      { singleton: false }
    );
  },
};
