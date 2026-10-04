const { queueRouteAndFlagAppearance } = require("../navigation/BotNavigation");
const { callModeHook } = require("../hooks/ModeHookContract");

const RETRY_WAIT_LOG_INTERVAL_MS = 3000;
const TRANSITION_WAIT_LOG_INTERVAL_MS = 2500;
const ROUTE_OBJECT_CACHE_TTL_MS = 1500;

class DitchTraversalService {
  constructor({
    api,
    traversalAssist,
    objectId,
    emitObjectInteraction,
    options,
  }) {
    this.api = api;
    this.traversalAssist = traversalAssist;
    this.objectId = objectId;
    this.modeHandlers = options.modeHandlers ?? {};
    this.behaviorMode = options.behaviorMode ?? null;
    this.roamingDitchCrossMaxDistanceY = Number.isFinite(
      options.roamingDitchCrossMaxDistanceY
    )
      ? Math.max(0, Math.floor(options.roamingDitchCrossMaxDistanceY))
      : 12;
    this.ditchAttemptCooldownMs = options.ditchAttemptCooldownMs;
    this.ditchPostCrossRetryDelayMs = options.ditchPostCrossRetryDelayMs;
    this.ditchTransitionTimeoutMs = options.ditchTransitionTimeoutMs;
    this.emitObjectInteraction =
      typeof emitObjectInteraction === "function"
        ? emitObjectInteraction
        : () => false;
    this.routeObjectCacheByPlayer = new WeakMap();
  }

  buildRouteCacheKey(from, to) {
    return [
      from?.x ?? "?",
      from?.y ?? "?",
      from?.z ?? "?",
      to?.x ?? "?",
      to?.y ?? "?",
      to?.z ?? "?",
    ].join(":");
  }

  getCachedRouteObject(player, from, to, nowMs) {
    if (!player || !from || !to) {
      return undefined;
    }
    const entry = this.routeObjectCacheByPlayer.get(player);
    if (!entry) {
      return undefined;
    }
    if (nowMs - Number(entry.cachedAt ?? 0) > ROUTE_OBJECT_CACHE_TTL_MS) {
      return undefined;
    }
    const key = this.buildRouteCacheKey(from, to);
    if (entry.key !== key) {
      return undefined;
    }
    return entry.object ?? null;
  }

  setCachedRouteObject(player, from, to, object, nowMs) {
    if (!player || !from || !to) {
      return object ?? null;
    }
    this.routeObjectCacheByPlayer.set(player, {
      key: this.buildRouteCacheKey(from, to),
      object: object ?? null,
      cachedAt: nowMs,
    });
    return object ?? null;
  }

  clearMovementQueue(player) {
    if (!player) {
      return;
    }
    player.getMovementQueue()?.walkToReset?.();
    player.getMovementQueue()?.reset?.();
  }

  getTraversalTarget(state) {
    if (!state) {
      return null;
    }
    const target = callModeHook({
      modeHandlers: this.modeHandlers,
      mode: state.mode,
      hookName: "getTraversalTarget",
      payload: state,
      fallback: null,
      api: this.api,
      errorEvent: "bot_mode_traversal_target_error",
    });
    if (target != null) {
      return target;
    }
    return state.roaming?.target ?? null;
  }

  setTraversalTarget(state, target) {
    if (!state) {
      return;
    }
    const handled =
      callModeHook({
        modeHandlers: this.modeHandlers,
        mode: state.mode,
        hookName: "setTraversalTarget",
        payload: { state, target },
        fallback: false,
        api: this.api,
        errorEvent: "bot_mode_set_traversal_target_error",
      }) === true;
    if (handled) {
      return;
    }
    if (!state.roaming) {
      return;
    }
    state.roaming.target = target;
  }

  getModeContext(state) {
    if (!state) {
      return { mode: null, modeContext: null };
    }
    const modeContext = callModeHook({
      modeHandlers: this.modeHandlers,
      mode: state.mode,
      hookName: "getModeLogContext",
      payload: state,
      fallback: null,
      api: this.api,
      errorEvent: "bot_mode_log_context_error",
    });
    return {
      mode: state.mode ?? null,
      modeContext:
        modeContext && typeof modeContext === "object" ? modeContext : null,
    };
  }

  findObjectOnRoute(player, from, to, nowMs = Date.now()) {
    if (!player || !from || !to || !this.traversalAssist) {
      return null;
    }
    const cached = this.getCachedRouteObject(player, from, to, nowMs);
    if (cached !== undefined) {
      return cached;
    }
    const traversalObject = this.traversalAssist.findObjectOnRoute(
      player,
      from,
      to,
      this.objectId
    );
    return this.setCachedRouteObject(player, from, to, traversalObject, nowMs);
  }

  isObjectBetween(fromY, targetY, objectY) {
    if (fromY === targetY) {
      return false;
    }
    return (
      (fromY < objectY && targetY > objectY) ||
      (fromY > objectY && targetY < objectY)
    );
  }

  isRoamingCrossProximitySatisfied(player, state, objectY) {
    const roamingMode = this.behaviorMode?.ROAMING ?? "roaming";
    if (state?.mode !== roamingMode) {
      return true;
    }
    const currentY = player?.getLocation?.()?.getY?.();
    if (!Number.isFinite(currentY) || !Number.isFinite(objectY)) {
      return false;
    }
    return Math.abs(currentY - objectY) <= this.roamingDitchCrossMaxDistanceY;
  }

  requestCross(player, state, traversalObject, nowMs = Date.now(), traversalTargetOverride = null) {
    if (!player || !state || !traversalObject) {
      return false;
    }
    const traversalTarget = traversalTargetOverride ?? this.getTraversalTarget(state);
    if (!traversalTarget) {
      return false;
    }
    const objectLoc = traversalObject.getLocation();
    const objectY = objectLoc.getY();
    if (state.pvp?.retreat && player.getLocation().getY() > objectY) {
      return false;
    }
    if (!this.isRoamingCrossProximitySatisfied(player, state, objectY)) {
      return false;
    }
    const traversalTargetSnapshot = {
      x: traversalTarget.x ?? null,
      y: traversalTarget.y ?? null,
      z: traversalTarget.z ?? null,
    };

    if (nowMs < state.nextDitchAttemptAt) {
      if (
        !Number.isInteger(state.lastDitchAttemptCooldownLogAt) ||
        nowMs - state.lastDitchAttemptCooldownLogAt >= RETRY_WAIT_LOG_INTERVAL_MS
      ) {
        state.lastDitchAttemptCooldownLogAt = nowMs;
        this.api.log("ditch_cross_cooldown_active", {
          username: player.getUsername(),
          nextAttemptAt: state.nextDitchAttemptAt,
          remainingMs: Math.max(0, state.nextDitchAttemptAt - nowMs),
          ...this.getModeContext(state),
        });
      }
      return true;
    }
    state.nextDitchAttemptAt = nowMs + this.ditchAttemptCooldownMs;

    player.getMovementQueue().walkToObject(traversalObject, {
      execute: () => {
        // A previously queued crossing may reach the ditch after retreat begins.
        if (state.pvp?.retreat && player.getLocation().getY() > objectY) return;
        const executedAt = Date.now();
        const currentTraversalTarget =
          this.getTraversalTarget(state) ?? traversalTargetSnapshot;
        const startSide = player.getLocation().getY() <= objectY ? "south" : "north";
        state.awaitingDitchTransition = {
          ditchY: objectY,
          startSide,
          sourceX: player.getLocation().getX(),
          sourceY: player.getLocation().getY(),
          sourceZ: player.getLocation().getZ(),
          targetX: currentTraversalTarget.x ?? player.getLocation().getX(),
          targetY: currentTraversalTarget.y ?? player.getLocation().getY(),
          targetZ: currentTraversalTarget.z ?? player.getLocation().getZ(),
          startedAt: executedAt,
          lastWaitLogAt: 0,
        };
        const transition = state.awaitingDitchTransition;
        this.clearMovementQueue(player);
        player.setPositionToFace(objectLoc);
        const handled = this.emitObjectInteraction({
          player,
          object: traversalObject,
          objectId: traversalObject.getId(),
          clickType: 1,
          location: {
            x: objectLoc.getX(),
            y: objectLoc.getY(),
            z: objectLoc.getZ(),
          },
          sourceLocation: {
            x: transition?.sourceX ?? player.getLocation().getX(),
            y: transition?.sourceY ?? player.getLocation().getY(),
            z: transition?.sourceZ ?? player.getLocation().getZ(),
          },
          handled: false,
        });
        this.api.log("ditch_cross_execute", {
          username: player.getUsername(),
          objectX: objectLoc.getX(),
          objectY: objectLoc.getY(),
          objectZ: objectLoc.getZ(),
          handled,
          ...this.getModeContext(state),
        });

        if (!handled) {
          state.awaitingDitchTransition = null;
          this.api.log("ditch_cross_not_handled", {
            username: player.getUsername(),
            objectX: objectLoc.getX(),
            objectY: objectLoc.getY(),
            objectZ: objectLoc.getZ(),
            ...this.getModeContext(state),
          });
        }
      },
    });

    this.api.log("ditch_cross_requested", {
      username: player.getUsername(),
      objectX: objectLoc.getX(),
      objectY,
      objectZ: objectLoc.getZ(),
      target: traversalTargetSnapshot,
      currentX: player.getLocation().getX(),
      currentY: player.getLocation().getY(),
      currentZ: player.getLocation().getZ(),
      ...this.getModeContext(state),
    });
    return true;
  }

  maybeRequestCrossForTarget(player, state, target, nowMs = Date.now()) {
    if (!player || !state || !target) {
      return false;
    }
    if (state.awaitingDitchTransition != null) {
      return false;
    }
    if (player.getForceMovement?.() != null) {
      return false;
    }
    const loc = player.getLocation?.();
    if (!loc) {
      return false;
    }
    const current = {
      x: loc.getX(),
      y: loc.getY(),
      z: loc.getZ(),
    };
    const traversalObject = this.findObjectOnRoute(player, current, target, nowMs);
    if (!traversalObject) {
      return false;
    }
    const objectY = traversalObject.getLocation().getY();
    if (!this.isObjectBetween(current.y, target.y, objectY)) {
      return false;
    }
    return this.requestCross(player, state, traversalObject, nowMs, target) === true;
  }

  processTransition(player, state, nowMs = Date.now()) {
    const transition = state.awaitingDitchTransition;
    if (!transition) {
      return;
    }

    if (nowMs - transition.startedAt > this.ditchTransitionTimeoutMs) {
      this.completeTransitionWithRetry(
        player,
        state,
        transition,
        "timeout",
        nowMs
      );
      return;
    }

    if (player.getForceMovement() != null) {
      if (
        !Number.isInteger(transition.lastWaitLogAt) ||
        nowMs - transition.lastWaitLogAt >= TRANSITION_WAIT_LOG_INTERVAL_MS
      ) {
        transition.lastWaitLogAt = nowMs;
        this.api.log("ditch_cross_waiting_force_movement", {
          username: player.getUsername(),
          elapsedMs: nowMs - transition.startedAt,
          ditchY: transition.ditchY,
          startSide: transition.startSide,
          currentX: player.getLocation().getX(),
          currentY: player.getLocation().getY(),
          currentZ: player.getLocation().getZ(),
          ...this.getModeContext(state),
        });
      }
      return;
    }

    const currentY = player.getLocation().getY();
    const crossed =
      transition.startSide === "south"
        ? currentY > transition.ditchY
        : currentY < transition.ditchY;

    if (!crossed) {
      if (
        !Number.isInteger(transition.lastWaitLogAt) ||
        nowMs - transition.lastWaitLogAt >= TRANSITION_WAIT_LOG_INTERVAL_MS
      ) {
        transition.lastWaitLogAt = nowMs;
        this.api.log("ditch_cross_waiting_position", {
          username: player.getUsername(),
          elapsedMs: nowMs - transition.startedAt,
          ditchY: transition.ditchY,
          startSide: transition.startSide,
          currentX: player.getLocation().getX(),
          currentY,
          currentZ: player.getLocation().getZ(),
          ...this.getModeContext(state),
        });
      }
      return;
    }

    this.completeTransitionWithRetry(
      player,
      state,
      transition,
      "completed",
      nowMs
    );
  }

  processPendingRetry(player, state, nowMs = Date.now()) {
    const retry = state.roaming?.pendingRetry;
    if (!retry) {
      return;
    }
    if (nowMs < retry.readyAt) {
      return;
    }
    const queueSize = player.getMovementQueue?.()?.size?.() ?? 0;
    const forceMovement = player.getForceMovement() != null;
    if (forceMovement || queueSize > 0) {
      if (!Number.isInteger(retry.waitingSince)) {
        retry.waitingSince = nowMs;
      }
      if (
        !Number.isInteger(retry.lastWaitLogAt) ||
        nowMs - retry.lastWaitLogAt >= RETRY_WAIT_LOG_INTERVAL_MS
      ) {
        retry.lastWaitLogAt = nowMs;
        this.api.log("ditch_post_delay_retry_waiting", {
          username: player.getUsername(),
          retryX: retry.x,
          retryY: retry.y,
          retryZ: retry.z,
          queueSize,
          forceMovement,
          waitedMs: nowMs - retry.waitingSince,
          ...this.getModeContext(state),
        });
      }
      return;
    }

    state.roaming.pendingRetry = null;
    this.setTraversalTarget(state, { x: retry.x, y: retry.y, z: retry.z });
    this.clearMovementQueue(player);
    queueRouteAndFlagAppearance(player, retry.x, retry.y, { state });
    this.api.log("ditch_post_delay_retry_walk", {
      username: player.getUsername(),
      retryX: retry.x,
      retryY: retry.y,
      retryZ: retry.z,
      ...this.getModeContext(state),
    });
  }

  completeTransitionWithRetry(
    player,
    state,
    transition,
    reason,
    nowMs = Date.now()
  ) {
    state.awaitingDitchTransition = null;
    if (!state.roaming) {
      return;
    }
    this.setTraversalTarget(state, {
      x: transition.targetX,
      y: transition.targetY,
      z: transition.targetZ,
    });

    const readyAt = nowMs + this.ditchPostCrossRetryDelayMs;
    state.roaming.pendingRetry = {
      x: transition.targetX,
      y: transition.targetY,
      z: transition.targetZ,
      readyAt,
      waitingSince: null,
      lastWaitLogAt: 0,
    };
    state.roaming.nextWalkAt = readyAt;
    state.nextDitchAttemptAt = readyAt;

    callModeHook({
      modeHandlers: this.modeHandlers,
      mode: state.mode,
      hookName: "onPostTraversalRetryScheduled",
      payload: {
        player,
        state,
        readyAt,
        transition,
        reason,
        nowMs,
      },
      fallback: false,
      api: this.api,
      errorEvent: "bot_mode_post_traversal_retry_error",
    });

    this.clearMovementQueue(player);

    const eventName =
      reason === "timeout"
        ? "ditch_cross_timeout_delay_retry_walk"
        : "ditch_cross_completed_delay_retry_walk";

    this.api.log(eventName, {
      username: player.getUsername(),
      reason,
      elapsedMs: nowMs - Number(transition.startedAt ?? nowMs),
      sourceX: transition.sourceX,
      sourceY: transition.sourceY,
      sourceZ: transition.sourceZ,
      retryX: transition.targetX,
      retryY: transition.targetY,
      retryZ: transition.targetZ,
      retryInMs: this.ditchPostCrossRetryDelayMs,
      currentX: player.getLocation().getX(),
      currentY: player.getLocation().getY(),
      currentZ: player.getLocation().getZ(),
      ...this.getModeContext(state),
    });
  }
}

module.exports = {
  DitchTraversalService,
};
