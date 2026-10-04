const { callModeHook } = require("../hooks/ModeHookContract");
const { peekMovementRequest } = require("../navigation/BotNavigation");

const DEFAULT_DUPLICATE_EVENT_WINDOW_MS = 650;
const DEFAULT_MIN_HANDLE_INTERVAL_MS = 200;
const DEFAULT_MEANINGFUL_RECHECK_MS = 1500;
const DEFAULT_MAX_REPEAT_BEFORE_BACKOFF = 4;
const DEFAULT_BACKOFF_BASE_MS = 400;
const DEFAULT_BACKOFF_MAX_MS = 8000;
const MODE_COOLDOWN_STATE_KEY_BY_MODE = Object.freeze({
  bank_run: "bankRun",
  woodcutting: "woodcutting",
  mining: "mining",
  smelting: "smelting",
  firemaking: "firemaking",
  pvp: "pvp",
});

function toTileSignature(point) {
  if (!point) {
    return "n/a";
  }
  return `${point.x ?? "?"},${point.y ?? "?"},${point.z ?? "?"}`;
}

function toTargetSignature(target) {
  if (!target) {
    return "target:n/a";
  }
  const idPart =
    Number.isInteger(target.objectId) || Number.isInteger(target.id)
      ? `:${target.objectId ?? target.id}`
      : "";
  return `target:${target.x ?? "?"},${target.y ?? "?"},${target.z ?? "?"}${idPart}`;
}

function clampMs(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

class PathBlockedHandler {
  constructor({ botStatesByName, traversalService, api, modeHandlers = {}, options = {} }) {
    this.botStatesByName = botStatesByName;
    this.traversalService = traversalService;
    this.api = api;
    this.modeHandlers = modeHandlers;
    this.blockedRetargetMinDelayMs = options.blockedRetargetMinDelayMs;
    this.blockedRetargetMaxDelayMs = options.blockedRetargetMaxDelayMs;
    this.duplicateEventWindowMs = clampMs(
      options.duplicateEventWindowMs,
      DEFAULT_DUPLICATE_EVENT_WINDOW_MS
    );
    this.meaningfulRecheckMs = clampMs(
      options.meaningfulRecheckMs,
      DEFAULT_MEANINGFUL_RECHECK_MS
    );
    this.maxRepeatBeforeBackoff = Math.max(
      1,
      clampMs(
        options.maxRepeatBeforeBackoff,
        DEFAULT_MAX_REPEAT_BEFORE_BACKOFF
      )
    );
    this.minHandleIntervalMs = Math.max(
      1,
      clampMs(options.minHandleIntervalMs, DEFAULT_MIN_HANDLE_INTERVAL_MS)
    );
    this.backoffBaseMs = Math.max(
      1,
      clampMs(options.backoffBaseMs, DEFAULT_BACKOFF_BASE_MS)
    );
    this.backoffMaxMs = Math.max(
      this.backoffBaseMs,
      clampMs(options.backoffMaxMs, DEFAULT_BACKOFF_MAX_MS)
    );
    this.ignoredModes = new Set(
      Array.isArray(options.ignoredModes) ? options.ignoredModes : []
    );
  }

  ensureTracker(state) {
    if (!state.pathBlockedTracker) {
      state.pathBlockedTracker = {
        lastSignature: null,
        lastBaseSignature: null,
        lastMode: null,
        lastTargetSignature: null,
        repeatCount: 0,
        lastReceivedAt: 0,
        lastHandledAt: 0,
        lastMeaningfulAt: 0,
        backoffUntil: 0,
      };
    }
    return state.pathBlockedTracker;
  }

  resolveTraversalTarget(mode, state) {
    if (!mode || !state) {
      return null;
    }
    const handler = this.modeHandlers?.[mode];
    if (!handler || typeof handler.getTraversalTarget !== "function") {
      return null;
    }
    try {
      return handler.getTraversalTarget(state) ?? null;
    } catch (err) {
      this.api?.log?.("path_blocked_target_resolve_error", {
        mode,
        error: String(err?.message ?? err),
      });
      return null;
    }
  }

  buildPathBlockedSignature(mode, event, target) {
    return [
      `mode:${mode ?? "n/a"}`,
      `from:${toTileSignature(event?.from)}`,
      `to:${toTileSignature(event?.to)}`,
      toTargetSignature(target),
      `basic:${event?.basicPather === true ? 1 : 0}`,
      `size:${event?.requestedSize ?? "?"}`,
      `dir:${event?.direction ?? "?"}`,
      `mask:${event?.blockingMask ?? "?"}`,
    ].join("|");
  }

  buildBasePathBlockedSignature(mode, event) {
    return [
      `mode:${mode ?? "n/a"}`,
      `from:${toTileSignature(event?.from)}`,
      `to:${toTileSignature(event?.to)}`,
      `basic:${event?.basicPather === true ? 1 : 0}`,
      `size:${event?.requestedSize ?? "?"}`,
      `dir:${event?.direction ?? "?"}`,
      `mask:${event?.blockingMask ?? "?"}`,
    ].join("|");
  }

  buildRequestBlockedSignature(mode, request) {
    return [
      `mode:${mode ?? "n/a"}`,
      `req:${request?.x ?? "?"},${request?.y ?? "?"},${request?.z ?? "?"}`,
      `basic:${request?.basicPather === true ? 1 : 0}`,
      `reason:${request?.reason ?? "n/a"}`,
    ].join("|");
  }

  matchesLatestDispatchedSegment(event, movementRequest) {
    if (!event || !movementRequest) {
      return true;
    }
    const to = event.to;
    if (!to) {
      return true;
    }
    const lastX = Number(movementRequest.lastSegmentX);
    const lastY = Number(movementRequest.lastSegmentY);
    if (!Number.isFinite(lastX) || !Number.isFinite(lastY)) {
      return true;
    }
    if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) {
      return true;
    }
    if (to.x !== lastX || to.y !== lastY) {
      return false;
    }
    const lastZ = Number(movementRequest.lastSegmentZ);
    if (!Number.isFinite(lastZ) || !Number.isFinite(to.z)) {
      return true;
    }
    return to.z === lastZ;
  }

  applyBackoffIfNeeded(tracker, state, nowMs, context = {}) {
    if (!tracker || tracker.repeatCount < this.maxRepeatBeforeBackoff) {
      return;
    }
    const overflow = tracker.repeatCount - this.maxRepeatBeforeBackoff;
    const backoffMs = Math.min(
      this.backoffMaxMs,
      this.backoffBaseMs * 2 ** Math.min(overflow, 6)
    );
    const previousBackoffUntil = Number(tracker.backoffUntil ?? 0);
    const nextBackoffUntil = Math.max(previousBackoffUntil, nowMs + backoffMs);
    tracker.backoffUntil = nextBackoffUntil;
    if (state?.roaming) {
      state.roaming.nextWalkAt = Math.max(
        Number(state.roaming.nextWalkAt ?? 0),
        tracker.backoffUntil
      );
    }
    if (nextBackoffUntil > previousBackoffUntil) {
      this.api?.log?.("path_blocked_backoff_applied", {
        username: context.username ?? null,
        mode: context.mode ?? null,
        repeatCount: tracker.repeatCount,
        backoffMs,
        backoffUntil: nextBackoffUntil,
        target: context.targetSignature ?? null,
      });
    }
  }

  getModeCooldownUntil(state, mode) {
    if (!state || !mode) {
      return 0;
    }
    const stateKey = MODE_COOLDOWN_STATE_KEY_BY_MODE[mode];
    if (!stateKey) {
      return 0;
    }
    const modeState = state[stateKey];
    const cooldown = Number(modeState?.nextActionAt ?? 0);
    return Number.isFinite(cooldown) ? cooldown : 0;
  }

  handle(event, nowMs = Date.now()) {
    if (!event || !event.username) {
      return;
    }
    const state = this.botStatesByName.get(event.username);
    if (!state || state.awaitingDitchTransition) {
      return;
    }
    const mode = state.mode;
    if (this.ignoredModes.has(mode)) {
      return;
    }
    // Most behavior modes already set `nextActionAt` after a failed pathing
    // attempt. Honor that cooldown to avoid re-running blocked recovery logic
    // on every duplicate blocked event.
    if (nowMs < this.getModeCooldownUntil(state, mode)) {
      return;
    }
    const tracker = this.ensureTracker(state);
    if (
      Number.isInteger(tracker.lastReceivedAt) &&
      nowMs - tracker.lastReceivedAt < this.minHandleIntervalMs
    ) {
      return;
    }
    tracker.lastReceivedAt = nowMs;
    if (nowMs < (state.roaming?.nextWalkAt ?? 0)) {
      return;
    }
    const player = event.entity;
    if (!player || !player.isRegistered()) {
      return;
    }
    if (player.getForceMovement() != null) {
      return;
    }
    if (player.getMovementQueue()?.size?.() > 0) {
      return;
    }
    const movementRequest = peekMovementRequest(player);
    if (!movementRequest) {
      return;
    }
    // Ignore delayed/stale blocked events emitted for an older segment once a
    // newer movement request/segment has already been dispatched for this bot.
    if (!this.matchesLatestDispatchedSegment(event, movementRequest)) {
      return;
    }

    const baseSignature = this.buildRequestBlockedSignature(
      mode,
      movementRequest
    );
    const baseSignatureChanged = baseSignature !== tracker.lastBaseSignature;
    if (baseSignatureChanged) {
      tracker.lastBaseSignature = baseSignature;
      tracker.repeatCount = 0;
      tracker.backoffUntil = 0;
    } else {
      tracker.repeatCount += 1;
    }

    if (!baseSignatureChanged && nowMs < tracker.backoffUntil) {
      return;
    }

    // Fast duplicate gate before expensive mode target resolution.
    if (
      !baseSignatureChanged &&
      nowMs - Number(tracker.lastHandledAt ?? 0) < this.duplicateEventWindowMs
    ) {
      this.applyBackoffIfNeeded(tracker, state, nowMs, {
        username: player.getUsername?.() ?? event?.username ?? null,
        mode,
        targetSignature: tracker.lastTargetSignature ?? null,
      });
      return;
    }

    const modeChanged = tracker.lastMode !== mode;
    const meaningfulByTime =
      nowMs - Number(tracker.lastMeaningfulAt ?? 0) >= this.meaningfulRecheckMs;
    // Avoid target-resolution / mode-hook fanout on repeated same-route blocks
    // unless mode changed or the periodic meaningful recheck is due.
    if (!baseSignatureChanged && !modeChanged && !meaningfulByTime) {
      tracker.lastHandledAt = nowMs;
      this.applyBackoffIfNeeded(tracker, state, nowMs, {
        username: player.getUsername?.() ?? event?.username ?? null,
        mode,
        targetSignature: tracker.lastTargetSignature ?? null,
      });
      return;
    }

    const target = this.resolveTraversalTarget(mode, state);
    const targetSignature = toTargetSignature(target);
    const signature = this.buildPathBlockedSignature(mode, event, target);
    const signatureChanged = signature !== tracker.lastSignature;

    if (signatureChanged) {
      tracker.lastSignature = signature;
    }

    const targetChanged = tracker.lastTargetSignature !== targetSignature;
    const meaningfulChange =
      signatureChanged ||
      modeChanged ||
      targetChanged ||
      meaningfulByTime;

    // Skip expensive mode-specific blocked recovery until state meaningfully changes.
    if (!meaningfulChange) {
      tracker.lastHandledAt = nowMs;
      this.applyBackoffIfNeeded(tracker, state, nowMs, {
        username: player.getUsername?.() ?? event?.username ?? null,
        mode,
        targetSignature,
      });
      return;
    }

    const handled = this.handleModeBlocked(mode, player, state, event, nowMs) === true;
    tracker.lastHandledAt = nowMs;
    tracker.lastMode = mode;
    tracker.lastTargetSignature = targetSignature;
    if (handled) {
      tracker.lastMeaningfulAt = nowMs;
    }
    this.applyBackoffIfNeeded(tracker, state, nowMs, {
      username: player.getUsername?.() ?? event?.username ?? null,
      mode,
      targetSignature,
    });
  }

  handleModeBlocked(mode, player, state, event, nowMs) {
    return (
      callModeHook({
        modeHandlers: this.modeHandlers,
        mode,
        hookName: "handleBlocked",
        payload: {
          player,
          state,
          event,
          nowMs,
          traversalService: this.traversalService,
          blockedRetargetMinDelayMs: this.blockedRetargetMinDelayMs,
          blockedRetargetMaxDelayMs: this.blockedRetargetMaxDelayMs,
        },
        fallback: false,
        api: this.api,
        errorEvent: "bot_mode_blocked_handler_error",
      }) === true
    );
  }
}

module.exports = {
  PathBlockedHandler,
};
