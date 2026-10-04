const { resolveBotNodeContext } = require("../context/BotNodeContext");
const {
  clearMovementRequest,
  dispatchMovementRequest,
  peekMovementRequest,
} = require("../../navigation/BotNavigation");

const MOVEMENT_DISPATCH_LOG_INTERVAL_MS = 4000;
const MOVEMENT_DISPATCH_WINDOW_MS = 600;
const MOVEMENT_DISPATCH_MAX_PER_WINDOW = 24;
const PRIORITY_MOVEMENT_MODES = new Set(["pvp", "follow_back", "return_home"]);
const lastMovementDispatchLogByUsername = new Map();
let movementDispatchWindowStartedAt = 0;
let movementDispatchesInWindow = 0;

function canDispatchMovementNow(state, nowMs) {
  const mode = state?.mode;
  if (mode && PRIORITY_MOVEMENT_MODES.has(mode)) {
    return true;
  }

  if (
    !Number.isFinite(movementDispatchWindowStartedAt) ||
    movementDispatchWindowStartedAt <= 0 ||
    nowMs - movementDispatchWindowStartedAt >= MOVEMENT_DISPATCH_WINDOW_MS
  ) {
    movementDispatchWindowStartedAt = nowMs;
    movementDispatchesInWindow = 0;
  }

  if (movementDispatchesInWindow >= MOVEMENT_DISPATCH_MAX_PER_WINDOW) {
    return false;
  }
  movementDispatchesInWindow += 1;
  return true;
}

class ProcessPendingMovementActionNode {
  constructor(botStatesByName, api, options = {}) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.traversalService = options.traversalService ?? null;
  }

  tick(context) {
    const resolved = resolveBotNodeContext(context, this.botStatesByName, {
      requireNotBusy: false,
      requireNoTraversalTransition: false,
      requireNotInCombat: false,
    });
    if (!resolved) {
      return "failure";
    }

    const { player, state } = resolved;
    const nowMs = Number.isFinite(resolved?.nowMs) ? resolved.nowMs : Date.now();
    const request = peekMovementRequest(player);
    if (!request) {
      return "failure";
    }
    if (state?.mode === "follow_back") {
      clearMovementRequest(player);
      return "failure";
    }

    const loc = player.getLocation?.();
    if (!loc) {
      clearMovementRequest(player);
      return "failure";
    }

    if (loc.getX() === request.x && loc.getY() === request.y) {
      clearMovementRequest(player);
      return "success";
    }

    if (player.getForceMovement?.() != null) {
      return "running";
    }
    if (
      Number.isFinite(request.nextDispatchAtMs) &&
      request.nextDispatchAtMs > nowMs
    ) {
      return "running";
    }
    if (
      this.traversalService?.maybeRequestCrossForTarget?.(
        player,
        state,
        request,
        nowMs
      ) === true
    ) {
      return "running";
    }

    const queue = player.getMovementQueue?.();
    if (!queue) {
      clearMovementRequest(player);
      return "failure";
    }
    if (queue.size?.() > 0) {
      return "running";
    }
    if (!canDispatchMovementNow(state, nowMs)) {
      return "running";
    }

    const dispatchResult = dispatchMovementRequest(player, request, state);
    const latestRequest = peekMovementRequest(player);
    // Path dispatch can emit path-blocked hooks which enqueue a replacement
    // movement request in the same tick. Only clear if nothing replaced it.
    if (
      latestRequest === request &&
      dispatchResult &&
      dispatchResult.hasRoute === true
    ) {
      clearMovementRequest(player);
    }
    if (!dispatchResult || !dispatchResult.segmentTarget) {
      return "failure";
    }

    if (this.api?.log) {
      const username = player.getUsername?.();
      const lastLogAt = username ? lastMovementDispatchLogByUsername.get(username) ?? 0 : 0;
      if (!username || nowMs - lastLogAt >= MOVEMENT_DISPATCH_LOG_INTERVAL_MS) {
        if (username) {
          lastMovementDispatchLogByUsername.set(username, nowMs);
        }
        this.api.log("bot_movement_node_dispatch", {
          username: username ?? null,
          targetX: request.x,
          targetY: request.y,
          targetZ: request.z,
          segmentX: dispatchResult.segmentTarget.x,
          segmentY: dispatchResult.segmentTarget.y,
          routeBuilt: dispatchResult.hasRoute === true,
          routeSteps: dispatchResult.steps ?? 0,
          reason: request.reason ?? null,
        });
      }
    }
    if (dispatchResult.hasRoute !== true) {
      return "running";
    }
    return "running";
  }
}

module.exports = {
  ProcessPendingMovementActionNode,
};
