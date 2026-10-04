const { MapObjects } = require("../../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Bank } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { Location } = require("../../../../src/main/typescript/elvarg/game/model/Location");
const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { resolveBotNodeContext } = require("../nodes/context/BotNodeContext");
const { callModeHook } = require("../hooks/ModeHookContract");
const {
  queueRouteAndFlagAppearance,
  requestMovement,
} = require("../navigation/BotNavigation");
const {
  handlePlayerAttackReaction,
} = require("../policies/PlayerAttackReactionPolicy");

const WALK_COMMAND_COOLDOWN_MS = 900;
const RETRY_SEARCH_MS = 1500;
const DEPOSIT_DELAY_MS = 350;
const RETURN_COMPLETE_DISTANCE_TILES = 1;
const BANK_SEARCH_REGION_RADIUS = 2;
const BANK_RUN_PHASE_WARN_MS = 25000;
const BANK_RUN_TOTAL_WARN_MS = 90000;
const BANK_RUN_HEARTBEAT_MS = 4000;
const BANK_RUN_STUCK_LOG_INTERVAL_MS = 5000;
const BANK_BOOTH_CACHE_TTL_MS = 8000;
const BANK_BOOTH_CACHE_MAX_KEYS = 256;
const BLOCKED_BOOTH_FAILURE_THRESHOLD = 2;
const BLOCKED_BOOTH_BLACKLIST_MS = 90000;
const HARD_BLACKLISTED_BANK_BOOTH_KEYS = new Set([
  "3147,3449,0",
  "3148,3449,0",
]);

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

class BankRunBehavior {
  constructor(botStatesByName, api, options) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.behaviorMode = options.behaviorMode;
    this.modeHandlers = options.modeHandlers ?? {};
    this.objectSearch = options.objectSearch ?? null;
    this.bankBoothSearchCacheByArea = new Map();
    this.globallyBlockedBoothsByKey = new Map();
  }

  getTraversalTarget(state) {
    return state?.bankRun?.travelTarget ?? null;
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
    if (!Array.isArray(lines) || !state?.bankRun) {
      return;
    }
    const formatPoint = helpers?.formatPoint ?? (() => "n/a");
    const msRemainingLabel = helpers?.msRemainingLabel ?? (() => "n/a");
    lines.push(
      `bankRun id=${state.bankRun.id ?? "n/a"} phase=${
        state.bankRun.phase ?? "n/a"
      } next=${msRemainingLabel(
        state.bankRun.nextActionAt,
        nowMs
      )} travel=${formatPoint(state.bankRun.travelTarget)} return=${formatPoint(
        state.bankRun.returnTo
      )}`
    );
  }

  setTraversalTarget(stateOrPayload, maybeTarget) {
    const state = stateOrPayload?.state ?? stateOrPayload;
    const target = stateOrPayload?.target ?? maybeTarget;
    if (!state?.bankRun) {
      return false;
    }
    state.bankRun.travelTarget = target;
    return true;
  }

  getModeLogContext(state) {
    return {
      phase: state?.bankRun?.phase ?? null,
      id: state?.bankRun?.id ?? null,
    };
  }

  onPostTraversalRetryScheduled({ state, readyAt }) {
    if (!state?.bankRun) {
      return false;
    }
    state.bankRun.nextActionAt = Math.min(
      Number(state.bankRun.nextActionAt ?? readyAt),
      readyAt
    );
    return true;
  }

  handleBlocked({
    player,
    state,
    event,
    nowMs,
    traversalService,
    blockedRetargetMinDelayMs,
  }) {
    const bankRun = state?.bankRun;
    const target = bankRun?.travelTarget;
    if (!target) {
      this.api.log("bank_run_blocked_no_target", {
        username: player.getUsername?.(),
        bankRunId: bankRun?.id ?? null,
        phase: bankRun?.phase ?? null,
        fromX: event?.from?.x ?? null,
        fromY: event?.from?.y ?? null,
        fromZ: event?.from?.z ?? null,
      });
      return true;
    }

    const traversalObject = traversalService.findObjectOnRoute(
      player,
      event.from,
      target
    );
    if (!traversalObject) {
      let queuedRepath = false;
      let blacklistedBooth = false;
      if (bankRun.phase === "to_bank") {
        blacklistedBooth = this.recordBlockedBooth(bankRun, target, nowMs);
        bankRun.bankTarget = null;
        bankRun.travelTarget = null;
      } else {
        queuedRepath = requestMovement(player, target.x, target.y, {
          nowMs,
          reason: "bank_run_non_traversal_repath",
          basicPather: true,
        });
      }
      this.api.log("bank_run_blocked_no_traversal_object", {
        username: player.getUsername?.(),
        bankRunId: bankRun?.id ?? null,
        phase: bankRun?.phase ?? null,
        targetX: target.x,
        targetY: target.y,
        targetZ: target.z,
        fromX: event?.from?.x ?? null,
        fromY: event?.from?.y ?? null,
        fromZ: event?.from?.z ?? null,
        queuedRepath,
        blacklistedBooth,
      });
      if (blacklistedBooth) {
        this.api?.log?.("bank_run_booth_blacklisted", {
          username: player.getUsername?.(),
          bankRunId: bankRun?.id ?? null,
          x: target.x,
          y: target.y,
          z: target.z,
          blockedUntil: nowMs + BLOCKED_BOOTH_BLACKLIST_MS,
        });
      }
      bankRun.nextActionAt = nowMs + blockedRetargetMinDelayMs;
      return true;
    }

    const currentY = player.getLocation().getY();
    const objectY = traversalObject.getLocation().getY();
    if (!traversalService.isObjectBetween(currentY, target.y, objectY)) {
      this.api.log("bank_run_blocked_traversal_not_between", {
        username: player.getUsername?.(),
        bankRunId: bankRun?.id ?? null,
        phase: bankRun?.phase ?? null,
        currentY,
        targetY: target.y,
        objectX: traversalObject.getLocation().getX(),
        objectY,
        objectZ: traversalObject.getLocation().getZ(),
      });
      if (bankRun.phase === "to_bank") {
        bankRun.bankTarget = null;
      }
      bankRun.nextActionAt = nowMs + blockedRetargetMinDelayMs;
      return true;
    }

    const requested = traversalService.requestCross(
      player,
      state,
      traversalObject,
      nowMs
    );
    this.api.log("bank_run_blocked_request_cross", {
      username: player.getUsername?.(),
      bankRunId: bankRun?.id ?? null,
      phase: bankRun?.phase ?? null,
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
      requiredMode: this.behaviorMode.BANK_RUN,
      requireNotBusy: false,
      requireNotInCombat: false,
    });
    if (!resolved) {
      return "failure";
    }

    const { player, state, nowMs } = resolved;
    const bankRun = state.bankRun;
    if (!bankRun) {
      return "failure";
    }

    this.ensureTracking(player, state, nowMs);
    this.reportStuckSignals(player, state, nowMs);

    if (nowMs < (bankRun.nextActionAt ?? 0)) {
      return "running";
    }

    if (bankRun.phase === "depositing") {
      this.depositInventory(player, state);
      this.setPhase(player, state, "returning", nowMs, "deposit_complete");
      bankRun.nextActionAt = nowMs + DEPOSIT_DELAY_MS;
      bankRun.travelTarget = bankRun.returnTo
        ? {
            x: bankRun.returnTo.x,
            y: bankRun.returnTo.y,
            z: bankRun.returnTo.z,
          }
        : null;
      return "running";
    }

    if (bankRun.phase === "returning") {
      return this.processReturnPhase(player, state, nowMs);
    }

    return this.processToBankPhase(
      player,
      state,
      nowMs,
      context?.traversalService ?? null
    );
  }

  processToBankPhase(player, state, nowMs, traversalService = null) {
    const bankRun = state.bankRun;
    this.setPhase(player, state, "to_bank", nowMs);
    this.cleanupBlockedBooths(bankRun, nowMs);
    this.cleanupGloballyBlockedBooths(nowMs);
    let bankBooth = this.resolveTargetBankBooth(
      player,
      bankRun.bankTarget,
      bankRun,
      nowMs
    );
    if (!bankBooth) {
      bankBooth = this.findNearestBankBooth(player, bankRun, nowMs);
      if (!bankBooth) {
        bankRun.bankTarget = null;
        bankRun.travelTarget = null;
        bankRun.nextActionAt = nowMs + RETRY_SEARCH_MS;
        this.api?.log?.("bank_run_no_booth_found", {
          username: player.getUsername?.(),
          bankRunId: bankRun.id ?? null,
          phase: bankRun.phase,
          x: player.getLocation().getX(),
          y: player.getLocation().getY(),
          z: player.getLocation().getZ(),
        });
        return "running";
      }

      bankRun.bankTarget = {
        objectId: bankBooth.getId(),
        x: bankBooth.getLocation().getX(),
        y: bankBooth.getLocation().getY(),
        z: bankBooth.getLocation().getZ(),
      };
      this.api?.log?.("bank_run_target_booth_selected", {
        username: player.getUsername?.(),
        bankRunId: bankRun.id ?? null,
        objectId: bankRun.bankTarget.objectId,
        x: bankRun.bankTarget.x,
        y: bankRun.bankTarget.y,
        z: bankRun.bankTarget.z,
      });
    }

    bankRun.travelTarget = {
      x: bankBooth.getLocation().getX(),
      y: bankBooth.getLocation().getY(),
      z: bankBooth.getLocation().getZ(),
    };

    if (player.getForceMovement() != null) {
      bankRun.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
      return "running";
    }
    if (player.getMovementQueue()?.size?.() > 0) {
      return "running";
    }

    player.getMovementQueue().walkToObject(bankBooth, {
      execute: () => {
        if (state.mode !== this.behaviorMode.BANK_RUN || !state.bankRun) {
          return;
        }
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
        this.api?.log?.("bank_run_booth_interaction", {
          username: player.getUsername?.(),
          bankRunId: bankRun.id ?? null,
          handled,
          objectId: bankBooth.getId(),
          x: boothLoc.getX(),
          y: boothLoc.getY(),
          z: boothLoc.getZ(),
        });
        this.setPhase(player, state, "depositing", Date.now(), "booth_reached");
        bankRun.nextActionAt = Date.now() + DEPOSIT_DELAY_MS;
        bankRun.travelTarget = null;
      },
    });

    const hasRoute = player.getMovementQueue?.().hasRoute?.() === true;
    const queuedSteps = player.getMovementQueue?.().size?.() ?? 0;
    if (!hasRoute && queuedSteps <= 0) {
      const requestedCross =
        traversalService?.maybeRequestCrossForTarget?.(
          player,
          state,
          bankRun.travelTarget,
          nowMs
        ) === true;
      this.api?.log?.("bank_run_no_route_to_booth", {
        username: player.getUsername?.(),
        bankRunId: bankRun.id ?? null,
        objectId: bankBooth.getId(),
        targetX: bankRun.travelTarget?.x ?? null,
        targetY: bankRun.travelTarget?.y ?? null,
        targetZ: bankRun.travelTarget?.z ?? null,
        requestedCross,
      });
      if (!requestedCross) {
        const blacklisted = this.recordBlockedBooth(
          bankRun,
          bankRun.travelTarget,
          nowMs
        );
        if (blacklisted) {
          this.api?.log?.("bank_run_booth_blacklisted", {
            username: player.getUsername?.(),
            bankRunId: bankRun.id ?? null,
            x: bankRun.travelTarget?.x ?? null,
            y: bankRun.travelTarget?.y ?? null,
            z: bankRun.travelTarget?.z ?? null,
            blockedUntil: nowMs + BLOCKED_BOOTH_BLACKLIST_MS,
          });
        }
        bankRun.bankTarget = null;
        bankRun.travelTarget = null;
        bankRun.nextActionAt = nowMs + RETRY_SEARCH_MS;
      } else {
        bankRun.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
      }
      return "running";
    }

    bankRun.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
    return "running";
  }

  processReturnPhase(player, state, nowMs) {
    const bankRun = state.bankRun;
    this.setPhase(player, state, "returning", nowMs);
    const returnTo = bankRun.returnTo;
    if (!returnTo) {
      this.restoreMode(player, state, nowMs);
      return "running";
    }

    bankRun.travelTarget = {
      x: returnTo.x,
      y: returnTo.y,
      z: returnTo.z,
    };

    if (this.isWithinDistance(player, returnTo, RETURN_COMPLETE_DISTANCE_TILES)) {
      this.restoreMode(player, state, nowMs);
      return "running";
    }

    if (player.getForceMovement() != null) {
      bankRun.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
      return "running";
    }
    if (player.getMovementQueue()?.size?.() > 0) {
      return "running";
    }

    queueRouteAndFlagAppearance(player, returnTo.x, returnTo.y);
    bankRun.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
    return "running";
  }

  restoreMode(player, state, nowMs) {
    const bankRun = state.bankRun;
    const returnMode = bankRun.returnMode ?? this.behaviorMode.ROAMING;
    let resumedMode = returnMode;
    const activated =
      callModeHook({
        modeHandlers: this.modeHandlers,
        mode: returnMode,
        hookName: "activateMode",
        payload: {
          player,
          state,
          nowMs,
          reason: "bank_run_complete",
        },
        fallback: false,
        api: this.api,
        errorEvent: "bot_mode_activation_error",
      }) === true;

    if (!activated) {
      const fallbackActivated =
        callModeHook({
          modeHandlers: this.modeHandlers,
          mode: this.behaviorMode.ROAMING,
          hookName: "activateMode",
          payload: {
            player,
            state,
            nowMs,
            reason: "bank_run_complete_fallback",
          },
          fallback: false,
          api: this.api,
          errorEvent: "bot_mode_activation_error",
        }) === true;
      resumedMode = fallbackActivated ? this.behaviorMode.ROAMING : returnMode;
    }

    if (activated) {
      callModeHook({
        modeHandlers: this.modeHandlers,
        mode: resumedMode,
        hookName: "onBankRunResume",
        payload: {
          player,
          state,
          nowMs,
          bankRun,
        },
        fallback: false,
        api: this.api,
        errorEvent: "bot_mode_bank_run_resume_error",
      });
    }

    this.api?.log?.("bank_run_complete", {
      username: player.getUsername?.(),
      bankRunId: bankRun.id ?? null,
      mode: resumedMode,
      totalMs: nowMs - Number(bankRun.startedAt ?? nowMs),
    });
    this.api?.log?.("bot_mode_switch", {
      username: player.getUsername?.(),
      mode: resumedMode,
      reason: "bank_run_complete",
    });
  }

  ensureTracking(player, state, nowMs) {
    const bankRun = state?.bankRun;
    if (!bankRun) {
      return;
    }
    if (!Number.isInteger(bankRun.startedAt) || bankRun.startedAt <= 0) {
      bankRun.startedAt = nowMs;
    }
    if (!Number.isInteger(bankRun.phaseStartedAt) || bankRun.phaseStartedAt <= 0) {
      bankRun.phaseStartedAt = nowMs;
    }
    if (bankRun.lastPhaseLogged !== bankRun.phase) {
      this.api?.log?.("bank_run_phase", {
        username: player.getUsername?.(),
        bankRunId: bankRun.id ?? null,
        phase: bankRun.phase,
        previousPhase: bankRun.lastPhaseLogged ?? null,
        x: player.getLocation().getX(),
        y: player.getLocation().getY(),
        z: player.getLocation().getZ(),
        bankTarget: bankRun.bankTarget ?? null,
        travelTarget: bankRun.travelTarget ?? null,
        returnTo: bankRun.returnTo ?? null,
      });
      bankRun.lastPhaseLogged = bankRun.phase;
    }
    if (
      !Number.isInteger(bankRun.lastHeartbeatAt) ||
      nowMs - bankRun.lastHeartbeatAt >= BANK_RUN_HEARTBEAT_MS
    ) {
      bankRun.lastHeartbeatAt = nowMs;
      this.api?.log?.("bank_run_heartbeat", {
        username: player.getUsername?.(),
        bankRunId: bankRun.id ?? null,
        phase: bankRun.phase,
        elapsedMs: nowMs - bankRun.startedAt,
        phaseElapsedMs: nowMs - bankRun.phaseStartedAt,
        x: player.getLocation().getX(),
        y: player.getLocation().getY(),
        z: player.getLocation().getZ(),
        queueSize: player.getMovementQueue?.()?.size?.() ?? 0,
        forceMovement: player.getForceMovement?.() != null,
        awaitingDitchTransition: state.awaitingDitchTransition != null,
      });
    }
  }

  setPhase(player, state, nextPhase, nowMs, reason = null) {
    const bankRun = state?.bankRun;
    if (!bankRun || bankRun.phase === nextPhase) {
      return;
    }
    const previous = bankRun.phase;
    bankRun.phase = nextPhase;
    bankRun.phaseStartedAt = nowMs;
    bankRun.lastPhaseLogged = null;
    this.api?.log?.("bank_run_phase_transition", {
      username: player.getUsername?.(),
      bankRunId: bankRun.id ?? null,
      previousPhase: previous,
      nextPhase,
      reason,
      x: player.getLocation().getX(),
      y: player.getLocation().getY(),
      z: player.getLocation().getZ(),
    });
  }

  reportStuckSignals(player, state, nowMs) {
    const bankRun = state?.bankRun;
    if (!bankRun) {
      return;
    }

    const totalElapsed = nowMs - Number(bankRun.startedAt ?? nowMs);
    const phaseElapsed = nowMs - Number(bankRun.phaseStartedAt ?? nowMs);
    if (totalElapsed < BANK_RUN_TOTAL_WARN_MS && phaseElapsed < BANK_RUN_PHASE_WARN_MS) {
      return;
    }

    if (
      Number.isInteger(bankRun.lastStuckWarningAt) &&
      nowMs - bankRun.lastStuckWarningAt < BANK_RUN_STUCK_LOG_INTERVAL_MS
    ) {
      return;
    }
    bankRun.lastStuckWarningAt = nowMs;
    this.api?.log?.("bank_run_stuck_warning", {
      username: player.getUsername?.(),
      bankRunId: bankRun.id ?? null,
      phase: bankRun.phase,
      totalElapsedMs: totalElapsed,
      phaseElapsedMs: phaseElapsed,
      queueSize: player.getMovementQueue?.()?.size?.() ?? 0,
      forceMovement: player.getForceMovement?.() != null,
      awaitingDitchTransition: state.awaitingDitchTransition != null,
      pendingRetry: state.roaming?.pendingRetry ?? null,
      nextActionAt: Number(bankRun.nextActionAt ?? 0),
      bankTarget: bankRun.bankTarget ?? null,
      travelTarget: bankRun.travelTarget ?? null,
      returnTo: bankRun.returnTo ?? null,
      x: player.getLocation().getX(),
      y: player.getLocation().getY(),
      z: player.getLocation().getZ(),
    });
  }

  inventorySnapshot(player) {
    const inventory = player?.getInventory?.();
    if (!inventory) {
      return {
        distinct: 0,
        occupiedSlots: 0,
        freeSlots: 0,
        items: [],
      };
    }
    const validItems = Array.isArray(inventory.getValidItems?.())
      ? inventory.getValidItems()
      : [];
    const items = validItems.map((item) => ({
      id: item.getId(),
      amount: item.getAmount(),
    }));
    const freeSlots = Number(inventory.getFreeSlots?.() ?? 0);
    const capacity = Number(inventory.capacity?.() ?? 0);
    return {
      distinct: items.length,
      occupiedSlots: Math.max(0, capacity - freeSlots),
      freeSlots,
      items,
    };
  }

  depositInventory(player, state) {
    const inventory = player?.getInventory?.();
    if (!inventory) {
      return;
    }
    const bankRun = state?.bankRun;
    const before = this.inventorySnapshot(player);
    this.api?.log?.("bank_run_deposit_begin", {
      username: player.getUsername?.(),
      bankRunId: bankRun?.id ?? null,
      phase: bankRun?.phase ?? null,
      inventory: before,
    });
    Bank.depositItems(player, inventory, true);
    player.getPacketSender()?.sendInterfaceRemoval?.();
    const after = this.inventorySnapshot(player);
    this.api?.log?.("bank_run_deposit_end", {
      username: player.getUsername?.(),
      bankRunId: bankRun?.id ?? null,
      phase: bankRun?.phase ?? null,
      inventory: after,
    });
  }

  resolveTargetBankBooth(player, target, bankRun, nowMs = Date.now()) {
    if (!player || !target) {
      return null;
    }
    if (this.isHardBlacklistedBoothTarget(target)) {
      return null;
    }
    if (this.isBoothGloballyBlocked(target, nowMs)) {
      return null;
    }
    const loc = new Location(target.x, target.y, target.z);
    if (this.isBoothBlockedForRun(bankRun, loc, nowMs)) {
      return null;
    }
    const object = MapObjects.get(target.objectId, loc, player.getPrivateArea());
    if (!object || !BANK_BOOTH_IDS.has(object.getId())) {
      return null;
    }
    return object;
  }

  findNearestBankBooth(player, bankRun, nowMs = Date.now()) {
    const loc = player?.getLocation?.();
    if (!loc) {
      return null;
    }
    const bankBooths = this.getCachedBankBooths(player);
    if (!bankBooths || bankBooths.length === 0) {
      return null;
    }
    const currentRegionX = loc.getX() >> 6;
    const currentRegionY = loc.getY() >> 6;
    const sameRegion = [];
    const otherRegions = [];

    for (const object of bankBooths) {
      if (!object || !BANK_BOOTH_IDS.has(object.getId())) {
        continue;
      }
      const objectLoc = object.getLocation();
      if (!objectLoc || objectLoc.getZ() !== loc.getZ()) {
        continue;
      }
      if (this.isHardBlacklistedBoothLoc(objectLoc)) {
        continue;
      }
      if (
        this.isBoothGloballyBlocked(
          {
            x: objectLoc.getX(),
            y: objectLoc.getY(),
            z: objectLoc.getZ(),
          },
          nowMs
        )
      ) {
        continue;
      }
      if (this.isBoothBlockedForRun(bankRun, objectLoc, nowMs)) {
        continue;
      }
      const regionX = objectLoc.getX() >> 6;
      const regionY = objectLoc.getY() >> 6;
      if (regionX === currentRegionX && regionY === currentRegionY) {
        sameRegion.push(object);
      } else {
        otherRegions.push(object);
      }
    }

    const localPick = this.findNearestObjectByDistance(loc, sameRegion);
    if (localPick) {
      return localPick;
    }
    return this.findNearestObjectByDistance(loc, otherRegions);
  }

  findNearestObjectByDistance(originLoc, objects) {
    if (!originLoc || !Array.isArray(objects) || objects.length === 0) {
      return null;
    }
    let nearest = null;
    let bestDistSq = Number.MAX_SAFE_INTEGER;
    for (const object of objects) {
      const objectLoc = object?.getLocation?.();
      if (!objectLoc) {
        continue;
      }
      const dx = objectLoc.getX() - originLoc.getX();
      const dy = objectLoc.getY() - originLoc.getY();
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        nearest = object;
      }
    }
    return nearest;
  }

  cleanupBlockedBooths(bankRun, nowMs) {
    if (!bankRun || !bankRun.blockedBoothsByKey) {
      return;
    }
    for (const [key, record] of Object.entries(bankRun.blockedBoothsByKey)) {
      if (!record) {
        delete bankRun.blockedBoothsByKey[key];
        continue;
      }
      const blockedUntil = Number(record.blockedUntil ?? 0);
      if (blockedUntil > 0 && blockedUntil <= nowMs) {
        delete bankRun.blockedBoothsByKey[key];
      }
    }
  }

  cleanupGloballyBlockedBooths(nowMs) {
    if (!this.globallyBlockedBoothsByKey || this.globallyBlockedBoothsByKey.size <= 0) {
      return;
    }
    for (const [key, blockedUntil] of this.globallyBlockedBoothsByKey.entries()) {
      if (Number(blockedUntil) <= nowMs) {
        this.globallyBlockedBoothsByKey.delete(key);
      }
    }
  }

  isBoothGloballyBlocked(target, nowMs) {
    if (!target || !this.globallyBlockedBoothsByKey) {
      return false;
    }
    const key = `${target.x},${target.y},${target.z}`;
    const blockedUntil = this.globallyBlockedBoothsByKey.get(key);
    if (!Number.isFinite(blockedUntil)) {
      return false;
    }
    if (blockedUntil <= nowMs) {
      this.globallyBlockedBoothsByKey.delete(key);
      return false;
    }
    return true;
  }

  isBoothBlockedForRun(bankRun, loc, nowMs) {
    if (!bankRun || !loc || !bankRun.blockedBoothsByKey) {
      return false;
    }
    const key = `${loc.getX()},${loc.getY()},${loc.getZ()}`;
    const record = bankRun.blockedBoothsByKey[key];
    if (!record) {
      return false;
    }
    return Number(record.blockedUntil) > nowMs;
  }

  isHardBlacklistedBoothLoc(loc) {
    if (!loc) {
      return false;
    }
    const key = `${loc.getX()},${loc.getY()},${loc.getZ()}`;
    return HARD_BLACKLISTED_BANK_BOOTH_KEYS.has(key);
  }

  isHardBlacklistedBoothTarget(target) {
    if (!target) {
      return false;
    }
    const key = `${target.x},${target.y},${target.z}`;
    return HARD_BLACKLISTED_BANK_BOOTH_KEYS.has(key);
  }

  recordBlockedBooth(bankRun, target, nowMs) {
    if (!bankRun || !target) {
      return false;
    }
    const key = `${target.x},${target.y},${target.z}`;
    if (!bankRun.blockedBoothsByKey) {
      bankRun.blockedBoothsByKey = {};
    }
    const current = bankRun.blockedBoothsByKey[key] ?? {
      failures: 0,
      blockedUntil: 0,
    };
    current.failures = Number(current.failures) + 1;
    let blacklisted = false;
    if (current.failures >= BLOCKED_BOOTH_FAILURE_THRESHOLD) {
      current.failures = 0;
      current.blockedUntil = nowMs + BLOCKED_BOOTH_BLACKLIST_MS;
      this.globallyBlockedBoothsByKey.set(key, current.blockedUntil);
      blacklisted = true;
    }
    bankRun.blockedBoothsByKey[key] = current;
    return blacklisted;
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

  isWithinDistance(player, target, maxDist) {
    if (!player || !target) {
      return false;
    }
    const loc = player.getLocation();
    if (loc.getZ() !== target.z) {
      return false;
    }
    const dx = loc.getX() - target.x;
    const dy = loc.getY() - target.y;
    return dx * dx + dy * dy <= maxDist * maxDist;
  }
}

const BANK_RUN_MODE_DESCRIPTOR = Object.freeze({
  key: "bankRun",
  modeProperty: "BANK_RUN",
  requiredHooks: [
    "getTraversalTarget",
    "setTraversalTarget",
    "handleBlocked",
    "onPostTraversalRetryScheduled",
    "getModeLogContext",
  ],
  create({
    botStatesByName,
    api,
    behaviorMode,
    modeHandlers = {},
    objectSearch,
  }) {
    return new BankRunBehavior(botStatesByName, api, {
      behaviorMode,
      modeHandlers,
      objectSearch,
    });
  },
});

module.exports = {
  BankRunBehavior,
  BANK_RUN_MODE_DESCRIPTOR,
};
