const { MapObjects } = require("../../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Bank } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { Location } = require("../../../../src/main/typescript/elvarg/game/model/Location");
const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { resolveBotNodeContext } = require("../nodes/context/BotNodeContext");
const { queueRouteAndFlagAppearance } = require("../navigation/BotNavigation");
const {
  handlePlayerAttackReaction,
} = require("../policies/PlayerAttackReactionPolicy");
const {
  setModeFiremaking,
  setModeWoodcutting,
} = require("../state/PlayerBotState");
const Woodcutting = require("../../../skills/Woodcutting.plugin");
const Firemaking = require("../../../skills/Firemaking.plugin");

const RETRY_ACTION_MS = 600;
const START_ACTION_COOLDOWN_MS = 900;
const WALK_COMMAND_COOLDOWN_MS = 900;
const POST_WITHDRAW_DELAY_MS = 350;
const BANK_SEARCH_REGION_RADIUS = 2;
const LIGHT_TILE_SEARCH_MAX_RADIUS = 8;
const LIGHT_TILE_SEARCH_MAX_RADIUS_FROM_BANK = 15;
const LIGHT_TILE_MIN_DIST_FROM_BANK = 3;
const BANK_BOOTH_CACHE_TTL_MS = 1200;
const BANK_BOOTH_CACHE_MAX_KEYS = 256;

const BANK_BOOTH_IDS = new Set(
  Object.entries(ObjectIds)
    .filter(
      ([name, id]) =>
        typeof name === "string" &&
        name.includes("BANK_BOOTH") &&
        Number.isInteger(id)
    )
    .map(([, id]) => id)
);

function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

class FiremakingBehavior {
  constructor(botStatesByName, api, options) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.ObjectManager = api.getObjectManager();
    this.behaviorMode = options.behaviorMode;
    this.objectSearch = options.objectSearch ?? null;
    this.bankBoothSearchCacheByArea = new Map();
  }

  registerEvents({ api }) {
    api.onFiremakingBlocked((event) => {
      const nowMs = Date.now();
      this.handleFiremakingBlockedEvent(event, nowMs);
    });
  }

  getTraversalTarget(state) {
    return state?.firemaking?.travelTarget ?? null;
  }

  setTraversalTarget(stateOrPayload, maybeTarget) {
    const state = stateOrPayload?.state ?? stateOrPayload;
    const target = stateOrPayload?.target ?? maybeTarget;
    if (!state?.firemaking) {
      return false;
    }
    state.firemaking.travelTarget = target;
    return true;
  }

  behaviorRequirementsMet(playerOrPayload) {
    const player = playerOrPayload?.player ?? playerOrPayload;
    const inventory = player?.getInventory?.();
    if (!inventory) {
      return false;
    }
    return this.findBestLogId(player, inventory) != null || this.hasBankLogs(player);
  }
  onNpcAggroAttempt({ event }) {
    if (!event || event.allow !== null) {
      return false;
    }
    event.allow = false;
    return true;
  }

  onNpcCombatDetected({ player, combat, attacker, target }) {
    const attackerIsNpc = attacker?.isNpc?.() === true;
    const targetIsNpc = target?.isNpc?.() === true;
    if (!attackerIsNpc && !targetIsNpc) {
      return false;
    }
    combat?.reset?.();
    player?.setFollowing?.(null);
    player?.setMobileInteraction?.(null);
    player?.setPositionToFace?.(null);
    return true;
  }

  onPlayerAttackReaction(payload) {
    return handlePlayerAttackReaction({
      ...payload,
      behaviorMode: this.behaviorMode,
      api: this.api,
    });
  }

  collectTrackedObjectIds() {
    return [...BANK_BOOTH_IDS];
  }

  appendStatusLines({ lines, state, nowMs, helpers = {} }) {
    if (!Array.isArray(lines) || !state?.firemaking) {
      return;
    }
    const formatPoint = helpers?.formatPoint ?? (() => "n/a");
    const msRemainingLabel = helpers?.msRemainingLabel ?? (() => "n/a");
    lines.push(
      `firemaking phase=${state.firemaking.phase ?? "n/a"} lightTile=${formatPoint(
        state.firemaking.lightTile
      )} next=${msRemainingLabel(state.firemaking.nextActionAt, nowMs)}`
    );
  }

  activateMode({ player, state }) {
    if (!player || !state) {
      return false;
    }
    setModeFiremaking(player, state, this.behaviorMode);
    if (state.firemaking) {
      state.firemaking.nextActionAt = 0;
    }
    return true;
  }

  startMode({ player, state, nowMs, activeForMs, reason = "auto_switch" }) {
    if (!this.activateMode({ player, state })) {
      return false;
    }
    this.api?.log?.("bot_mode_switch", {
      username: player.getUsername?.(),
      mode: this.behaviorMode.FIREMAKING,
      reason,
      activeForMs,
    });
    if (state.firemaking && Number.isInteger(nowMs)) {
      state.firemaking.nextActionAt = nowMs;
    }
    return true;
  }

  onBankRunResume({ state, nowMs }) {
    if (!state?.firemaking) {
      return false;
    }
    state.firemaking.nextActionAt = nowMs;
    return true;
  }

  handleFiremakingBlockedEvent(event, nowMs = Date.now()) {
    const player = event?.player;
    if (!player?.isPlayerBot?.()) {
      return false;
    }
    const username = player.getUsername?.();
    if (!username) {
      return false;
    }
    const state = this.botStatesByName.get(username);
    if (!state || state.mode !== this.behaviorMode.FIREMAKING) {
      return false;
    }
    if (player.getForceMovement?.() != null) {
      return false;
    }
    if (player.getMovementQueue?.()?.size?.() > 0) {
      return false;
    }

    const firemaking = state.firemaking;
    const step = this.tryStepAfterFireBlocked(player);
    if (!step) {
      return false;
    }
    if (firemaking) {
      firemaking.phase = "burning";
      firemaking.lightTile = null;
      firemaking.travelTarget = null;
      firemaking.nextActionAt = nowMs + 500;
    }
    event.handled = true;
    this.api?.log?.("bot_firemaking_step_after_blocked", {
      username,
      direction: step.direction,
      toX: step.x,
      toY: step.y,
      toZ: step.z,
    });
    return true;
  }

  tryStepAfterFireBlocked(player) {
    const queue = player?.getMovementQueue?.();
    const loc = player?.getLocation?.();
    if (!queue || !loc) {
      return null;
    }
    const stepOrder = [
      { dx: -1, dy: 0, direction: "west" },
      { dx: 1, dy: 0, direction: "east" },
      { dx: 0, dy: -1, direction: "south" },
      { dx: 0, dy: 1, direction: "north" },
    ];
    for (const step of stepOrder) {
      if (!queue.canWalk(step.dx, step.dy)) {
        continue;
      }
      const x = loc.getX() + step.dx;
      const y = loc.getY() + step.dy;
      const z = loc.getZ();
      if (!this.isTileLightable(x, y, z)) {
        continue;
      }
      queue.walkStep(step.dx, step.dy);
      return {
        direction: step.direction,
        x,
        y,
        z,
      };
    }
    return null;
  }

  handleBlocked({
    player,
    state,
    event,
    nowMs,
    traversalService,
    blockedRetargetMinDelayMs,
  }) {
    const firemaking = state?.firemaking;
    const target = firemaking?.travelTarget;
    if (!player || !target) {
      return false;
    }

    const traversalObject = traversalService.findObjectOnRoute(
      player,
      event.from,
      target
    );
    if (!traversalObject) {
      firemaking.nextActionAt = nowMs + blockedRetargetMinDelayMs;
      this.api?.log?.("firemaking_blocked_no_traversal_object", {
        username: player.getUsername?.(),
        phase: firemaking?.phase ?? null,
        targetX: target.x,
        targetY: target.y,
        targetZ: target.z,
      });
      return true;
    }

    const currentY = player.getLocation().getY();
    const objectY = traversalObject.getLocation().getY();
    if (!traversalService.isObjectBetween(currentY, target.y, objectY)) {
      firemaking.nextActionAt = nowMs + blockedRetargetMinDelayMs;
      this.api?.log?.("firemaking_blocked_traversal_not_between", {
        username: player.getUsername?.(),
        phase: firemaking?.phase ?? null,
        currentY,
        targetY: target.y,
        objectX: traversalObject.getLocation().getX(),
        objectY,
        objectZ: traversalObject.getLocation().getZ(),
      });
      return true;
    }

    const requested = traversalService.requestCross(
      player,
      state,
      traversalObject,
      nowMs
    );
    this.api?.log?.("firemaking_blocked_request_cross", {
      username: player.getUsername?.(),
      phase: firemaking?.phase ?? null,
      requested,
      objectX: traversalObject.getLocation().getX(),
      objectY: traversalObject.getLocation().getY(),
      objectZ: traversalObject.getLocation().getZ(),
      targetX: target.x,
      targetY: target.y,
      targetZ: target.z,
    });
    return true;
  }

  tick(context) {
    const resolved = resolveBotNodeContext(context, this.botStatesByName, {
      requiredMode: this.behaviorMode.FIREMAKING,
      requireNotBusy: false,
    });
    if (!resolved) {
      return "failure";
    }

    const { player, state, nowMs } = resolved;
    const firemaking = state.firemaking;
    if (!firemaking) {
      return "failure";
    }
    this.ensureState(firemaking);

    if (nowMs < (firemaking.nextActionAt ?? 0)) {
      return "running";
    }

    const inventory = player.getInventory?.();
    if (!inventory) {
      return "failure";
    }

    const logId = this.findBestLogId(player, inventory);
    if (!logId) {
      return this.acquireLogsFromBank(player, state, nowMs);
    }

    if (firemaking.phase === "to_light_tile") {
      this.moveToLightTile(player, state, nowMs);
      return "running";
    }
    firemaking.phase = "burning";
    firemaking.travelTarget = null;

    if (player.getForceMovement?.() != null) {
      firemaking.nextActionAt = nowMs + RETRY_ACTION_MS;
      return "running";
    }
    if (player.getMovementQueue?.()?.size?.() > 0) {
      firemaking.nextActionAt = nowMs + RETRY_ACTION_MS;
      return "running";
    }

    if (Firemaking.isFiremakingActive?.(player)) {
      firemaking.nextActionAt = nowMs + START_ACTION_COOLDOWN_MS;
      return "running";
    }

    const started =
      Firemaking.startBotInventoryFiremaking?.(player, logId) === true;
    firemaking.nextActionAt =
      nowMs + (started ? START_ACTION_COOLDOWN_MS : RETRY_ACTION_MS);
    return "running";
  }

  ensureState(firemaking) {
    if (!firemaking) {
      return;
    }
    if (!firemaking.phase) {
      firemaking.phase = "burning";
    }
    if (!Number.isInteger(firemaking.nextActionAt)) {
      firemaking.nextActionAt = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(firemaking, "bankTarget")) {
      firemaking.bankTarget = null;
    }
    if (!Object.prototype.hasOwnProperty.call(firemaking, "lightTile")) {
      firemaking.lightTile = null;
    }
    if (!Object.prototype.hasOwnProperty.call(firemaking, "travelTarget")) {
      firemaking.travelTarget = null;
    }
  }

  findBestLogId(player, inventory) {
    for (let i = Woodcutting.TREE_LOG_IDS.length - 1; i >= 0; i--) {
      const logId = Woodcutting.TREE_LOG_IDS[i];
      if (
        inventory.contains(logId) &&
        Firemaking.isWoodcuttingLog?.(logId) &&
        Firemaking.canPlayerBurnLog?.(player, logId)
      ) {
        return logId;
      }
    }
    return null;
  }

  hasBankLogs(player) {
    for (let i = Woodcutting.TREE_LOG_IDS.length - 1; i >= 0; i--) {
      const logId = Woodcutting.TREE_LOG_IDS[i];
      if (!Firemaking.canPlayerBurnLog?.(player, logId)) {
        continue;
      }
      const tab = Bank.getTabForItem(player, logId);
      const bank = player.getBank?.(tab);
      if ((bank?.getAmount?.(logId) ?? 0) > 0) {
        return true;
      }
    }
    return false;
  }

  acquireLogsFromBank(player, state, nowMs) {
    const firemaking = state.firemaking;
    if (!this.hasBankLogs(player)) {
      firemaking.travelTarget = null;
      setModeWoodcutting(player, state, this.behaviorMode);
      this.api?.log?.("bot_mode_switch", {
        username: player.getUsername?.(),
        mode: this.behaviorMode.WOODCUTTING,
        reason: "firemaking_no_logs_in_bank",
      });
      return "running";
    }

    if (firemaking.phase !== "to_light_tile") {
      firemaking.phase = "to_bank";
      firemaking.lightTile = null;
      firemaking.travelTarget = null;
    }

    if (firemaking.phase === "to_light_tile") {
      this.moveToLightTile(player, state, nowMs);
      return "running";
    }

    let bankBooth = this.resolveTargetBankBooth(player, firemaking.bankTarget);
    if (!bankBooth) {
      bankBooth = this.findNearestBankBooth(player);
      if (!bankBooth) {
        firemaking.bankTarget = null;
        firemaking.travelTarget = null;
        firemaking.nextActionAt = nowMs + RETRY_ACTION_MS;
        this.api?.log?.("firemaking_no_booth_found", {
          username: player.getUsername?.(),
          x: player.getLocation().getX(),
          y: player.getLocation().getY(),
          z: player.getLocation().getZ(),
        });
        return "running";
      }

      firemaking.bankTarget = {
        objectId: bankBooth.getId(),
        x: bankBooth.getLocation().getX(),
        y: bankBooth.getLocation().getY(),
        z: bankBooth.getLocation().getZ(),
      };
    }
    firemaking.travelTarget = {
      x: bankBooth.getLocation().getX(),
      y: bankBooth.getLocation().getY(),
      z: bankBooth.getLocation().getZ(),
    };

    if (player.getForceMovement?.() != null) {
      firemaking.nextActionAt = nowMs + RETRY_ACTION_MS;
      return "running";
    }
    if (player.getMovementQueue?.()?.size?.() > 0) {
      return "running";
    }

    player.getMovementQueue().walkToObject(bankBooth, {
      execute: () => {
        if (state.mode !== this.behaviorMode.FIREMAKING || !state.firemaking) {
          return;
        }
        const fireState = state.firemaking;
        const boothLoc = bankBooth.getLocation();
        player.setPositionToFace(boothLoc);
        const handled = this.api.emitObjectInteraction({
          player,
          object: bankBooth,
          objectId: bankBooth.getId(),
          clickType: 1,
          location: {
            x: boothLoc.getX(),
            y: boothLoc.getY(),
            z: boothLoc.getZ(),
          },
          sourceLocation: {
            x: player.getLocation().getX(),
            y: player.getLocation().getY(),
            z: player.getLocation().getZ(),
          },
          handled: false,
        });

        const withdrew = this.withdrawLogsFromBank(player);
        this.api?.log?.("firemaking_bank_withdraw", {
          username: player.getUsername?.(),
          handled,
          objectId: bankBooth.getId(),
          withdrewLogId: withdrew.logId,
          withdrewAmount: withdrew.amount,
        });

        if (withdrew.amount <= 0) {
          setModeWoodcutting(player, state, this.behaviorMode);
          this.api?.log?.("bot_mode_switch", {
            username: player.getUsername?.(),
            mode: this.behaviorMode.WOODCUTTING,
            reason: "firemaking_bank_empty_after_arrival",
          });
          return;
        }

        fireState.phase = "to_light_tile";
        fireState.lightTile = this.findLightableTileNear(
          player,
          fireState.bankTarget
        );
        fireState.travelTarget = fireState.lightTile
          ? {
              x: fireState.lightTile.x,
              y: fireState.lightTile.y,
              z: fireState.lightTile.z,
            }
          : null;
        fireState.nextActionAt = Date.now() + POST_WITHDRAW_DELAY_MS;
      },
    });

    firemaking.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
    return "running";
  }

  withdrawLogsFromBank(player) {
    const inventory = player.getInventory?.();
    if (!inventory) {
      return { logId: null, amount: 0 };
    }
    const freeSlots = inventory.getFreeSlots?.() ?? 0;
    if (freeSlots <= 0) {
      return { logId: null, amount: 0 };
    }

    for (let i = Woodcutting.TREE_LOG_IDS.length - 1; i >= 0; i--) {
      const logId = Woodcutting.TREE_LOG_IDS[i];
      if (!Firemaking.isWoodcuttingLog?.(logId)) {
        continue;
      }
      if (!Firemaking.canPlayerBurnLog?.(player, logId)) {
        continue;
      }
      const tab = Bank.getTabForItem(player, logId);
      const bank = player.getBank?.(tab);
      const available = bank?.getAmount?.(logId) ?? 0;
      if (available <= 0) {
        continue;
      }
      const withdrawAmount = Math.min(available, freeSlots);
      bank.deleteNumber(logId, withdrawAmount);
      inventory.adds(logId, withdrawAmount);
      inventory.refreshItems?.();
      bank.refreshItems?.();
      return { logId, amount: withdrawAmount };
    }
    return { logId: null, amount: 0 };
  }

  moveToLightTile(player, state, nowMs) {
    const firemaking = state.firemaking;
    if (!this.findBestLogId(player, player.getInventory?.())) {
      firemaking.phase = "to_bank";
      firemaking.lightTile = null;
      firemaking.travelTarget = null;
      firemaking.nextActionAt = nowMs + RETRY_ACTION_MS;
      return;
    }

    if (
      !firemaking.lightTile ||
      !this.isTileLightable(
        firemaking.lightTile.x,
        firemaking.lightTile.y,
        firemaking.lightTile.z
      )
    ) {
      firemaking.lightTile = this.findLightableTileNear(
        player,
        firemaking.bankTarget
      );
    }

    const target = firemaking.lightTile;
    if (!target) {
      firemaking.travelTarget = null;
      firemaking.nextActionAt = nowMs + RETRY_ACTION_MS;
      return;
    }
    firemaking.travelTarget = {
      x: target.x,
      y: target.y,
      z: target.z,
    };

    if (this.isAtTarget(player, target)) {
      firemaking.phase = "burning";
      firemaking.travelTarget = null;
      firemaking.nextActionAt = nowMs;
      this.api?.log?.("firemaking_light_tile_reached", {
        username: player.getUsername?.(),
        x: target.x,
        y: target.y,
        z: target.z,
      });
      return;
    }

    if (player.getForceMovement?.() != null) {
      firemaking.nextActionAt = nowMs + RETRY_ACTION_MS;
      return;
    }
    if (player.getMovementQueue?.()?.size?.() > 0) {
      firemaking.nextActionAt = nowMs + RETRY_ACTION_MS;
      return;
    }

    queueRouteAndFlagAppearance(player, target.x, target.y);
    firemaking.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
    this.api?.log?.("firemaking_move_to_light_tile", {
      username: player.getUsername?.(),
      x: target.x,
      y: target.y,
      z: target.z,
    });
  }

  findLightableTileNear(player, bankTarget) {
    const loc = player.getLocation?.();
    if (!loc) {
      return null;
    }
    const hasBankTarget =
      bankTarget &&
      Number.isFinite(bankTarget.x) &&
      Number.isFinite(bankTarget.y);
    const baseX = hasBankTarget ? bankTarget.x : loc.getX();
    const baseY = hasBankTarget ? bankTarget.y : loc.getY();
    const z = loc.getZ();
    const bankX = bankTarget?.x ?? null;
    const bankY = bankTarget?.y ?? null;
    const minDistSq = LIGHT_TILE_MIN_DIST_FROM_BANK * LIGHT_TILE_MIN_DIST_FROM_BANK;
    const maxRadius = hasBankTarget
      ? LIGHT_TILE_SEARCH_MAX_RADIUS_FROM_BANK
      : LIGHT_TILE_SEARCH_MAX_RADIUS;

    for (let radius = 1; radius <= maxRadius; radius++) {
      for (let attempt = 0; attempt < 14; attempt++) {
        const dx = randomInRange(-radius, radius);
        const dy = randomInRange(-radius, radius);
        const x = baseX + dx;
        const y = baseY + dy;
        if (x === baseX && y === baseY) {
          continue;
        }
        if (!this.isTileLightable(x, y, z)) {
          continue;
        }
        if (bankX != null && bankY != null) {
          const bdx = x - bankX;
          const bdy = y - bankY;
          if (bdx * bdx + bdy * bdy < minDistSq) {
            continue;
          }
        }
        return { x, y, z };
      }
    }
    return null;
  }

  isTileLightable(x, y, z) {
    return !this.ObjectManager.existsLocation(new Location(x, y, z));
  }

  isAtTarget(player, target) {
    if (!player || !target) {
      return false;
    }
    const loc = player.getLocation();
    return (
      loc.getX() === target.x &&
      loc.getY() === target.y &&
      loc.getZ() === target.z
    );
  }

  resolveTargetBankBooth(player, target) {
    if (!player || !target) {
      return null;
    }
    const loc = new Location(target.x, target.y, target.z);
    const object = MapObjects.get(target.objectId, loc, player.getPrivateArea());
    if (!object || !BANK_BOOTH_IDS.has(object.getId())) {
      return null;
    }
    return object;
  }

  findNearestBankBooth(player) {
    const loc = player?.getLocation?.();
    if (!loc) {
      return null;
    }
    const bankBooths = this.getCachedBankBooths(player);
    if (!bankBooths || bankBooths.length === 0) {
      return null;
    }
    let nearest = null;
    let bestDistSq = Number.MAX_SAFE_INTEGER;

    for (const object of bankBooths) {
      if (!object || !BANK_BOOTH_IDS.has(object.getId())) {
        continue;
      }
      const objectLoc = object.getLocation();
      if (!objectLoc || objectLoc.getZ() !== loc.getZ()) {
        continue;
      }
      const dx = objectLoc.getX() - loc.getX();
      const dy = objectLoc.getY() - loc.getY();
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        nearest = object;
      }
    }

    return nearest;
  }

  getCachedBankBooths(player, nowMs = Date.now()) {
    const loc = player?.getLocation?.();
    if (!loc) {
      return [];
    }
    const privateArea = player.getPrivateArea?.() ?? null;
    const areaKey = privateArea == null ? "__global__" : String(privateArea);
    let areaCache = this.bankBoothSearchCacheByArea.get(areaKey);
    if (!areaCache) {
      areaCache = new Map();
      this.bankBoothSearchCacheByArea.set(areaKey, areaCache);
    }

    const cacheKey = `${loc.getX() >> 6}:${loc.getY() >> 6}:${loc.getZ()}`;
    const cached = areaCache.get(cacheKey);
    if (cached && cached.expiresAt > nowMs) {
      return cached.objects;
    }

    const objects =
      this.objectSearch?.findCandidatesByIds?.(
        player,
        [...BANK_BOOTH_IDS],
        {
          regionRadius: BANK_SEARCH_REGION_RADIUS,
          z: loc.getZ(),
          privateArea,
        }
      ) ?? [];

    if (areaCache.size >= BANK_BOOTH_CACHE_MAX_KEYS) {
      areaCache.clear();
    }
    areaCache.set(cacheKey, {
      expiresAt: nowMs + BANK_BOOTH_CACHE_TTL_MS,
      objects,
    });
    return objects;
  }
}

const FIREMAKING_MODE_DESCRIPTOR = Object.freeze({
  key: "firemaking",
  assignable: true,
  modeProperty: "FIREMAKING",
  autonomous: Object.freeze({
    strategy: "start",
    weight: 0.15,
    minMs: 22000,
    maxMs: 70000,
    priority: 20,
  }),
  requiredHooks: [
    "registerEvents",
    "behaviorRequirementsMet",
    "activateMode",
    "startMode",
    "onBankRunResume",
    "handleBlocked",
    "getTraversalTarget",
    "setTraversalTarget",
  ],
  create({ botStatesByName, api, behaviorMode, objectSearch }) {
    return new FiremakingBehavior(botStatesByName, api, {
      behaviorMode,
      objectSearch,
    });
  },
});

module.exports = {
  FiremakingBehavior,
  FIREMAKING_MODE_DESCRIPTOR,
};
