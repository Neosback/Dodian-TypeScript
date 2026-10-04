const {
  chooseNextTarget,
  isAtTarget,
  queueRouteAndFlagAppearance,
  randomInRange,
  retargetAfterBlocked,
} = require("../navigation/BotNavigation");
const {
  getWildernessHotspot,
  isOutsideWildernessHotspots,
} = require("../pvp/WildernessHotspotRegistry");
const {
  handlePlayerAttackReaction,
} = require("../policies/PlayerAttackReactionPolicy");
const { clearFollowState, setModeRoaming } = require("../state/PlayerBotState");
const { resolveBotNodeContext } = require("../nodes/context/BotNodeContext");

const DITCH_CONTEXT_TTL_MS = 1500;
const ROAMING_LINGER_JITTER_MS = 2200;
const ROAMING_DYNAMIC_JITTER_MS = 3200;
const ROAMING_PRE_WALK_MIN_MS = 180;
const ROAMING_PRE_WALK_MAX_MS = 1650;

function hashUsername(value) {
  const text = typeof value === "string" ? value : "";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function resolveDeterministicJitterMs(username, nowMs, spreadMs) {
  const safeSpreadMs = Math.max(1, Math.floor(spreadMs));
  const cycleSeed = Math.floor(Math.max(0, Number(nowMs) || 0) / 5000);
  return (hashUsername(`${username}:${cycleSeed}`) % safeSpreadMs);
}

class RoamingBehavior {
  constructor(botStatesByName, options) {
    this.botStatesByName = botStatesByName;
    this.api = options.api ?? null;
    this.behaviorMode = options.behaviorMode;
    this.endpointLingerMs = options.endpointLingerMs;
    this.botWalkRadius = options.botWalkRadius;
    this.roamingMinMs = options.roamingMinMs ?? 22000;
    this.roamingMaxMs = options.roamingMaxMs ?? 80000;
    this.objectSearch = options.objectSearch ?? null;
    this.wildernessDitchObjectId = Number.isFinite(options.wildernessDitchObjectId)
      ? options.wildernessDitchObjectId
      : null;
    this.roamingDitchCrossMaxDistanceY = Number.isFinite(
      options.roamingDitchCrossMaxDistanceY
    )
      ? Math.max(0, Math.floor(options.roamingDitchCrossMaxDistanceY))
      : 12;
    this.ditchProbeRadius = Number.isFinite(options.ditchProbeRadius)
      ? Math.max(1, Math.floor(options.ditchProbeRadius))
      : Math.max(12, this.botWalkRadius * 3);
  }

  getAssignedHotspot(state) {
    const hotspotId = state?.pvp?.hotspotId;
    return hotspotId ? getWildernessHotspot(hotspotId) : null;
  }

  getAssignedRoamBounds(state) {
    const roamBounds = state?.roaming?.roamBounds ?? null;
    return roamBounds &&
      Number.isFinite(roamBounds.minX) &&
      Number.isFinite(roamBounds.maxX) &&
      Number.isFinite(roamBounds.minY) &&
      Number.isFinite(roamBounds.maxY)
      ? roamBounds
      : null;
  }

  getEffectiveWalkRadius(state) {
    const hotspot = this.getAssignedHotspot(state);
    return Number.isFinite(hotspot?.roamRadius)
      ? Math.max(1, Math.floor(hotspot.roamRadius))
      : this.botWalkRadius;
  }

  getEffectiveEndpointLingerMs(player, state) {
    const hotspot = this.getAssignedHotspot(state);
    const baseLingerMs = Number.isFinite(hotspot?.lingerMs)
      ? Math.max(0, Math.floor(hotspot.lingerMs))
      : this.endpointLingerMs;
    const username = player?.getUsername?.() ?? "";
    const jitterMs = hashUsername(username) % ROAMING_LINGER_JITTER_MS;
    return baseLingerMs + jitterMs;
  }

  getDynamicRoamingDelayMs(player, nowMs, minMs, maxMs) {
    const lowerBound = Math.max(0, Math.floor(minMs));
    const upperBound = Math.max(lowerBound, Math.floor(maxMs));
    const baseDelayMs = randomInRange(lowerBound, upperBound);
    const username = player?.getUsername?.() ?? "";
    return baseDelayMs + resolveDeterministicJitterMs(username, nowMs, ROAMING_DYNAMIC_JITTER_MS);
  }

  buildHotspotTargetConstraint(state) {
    const hotspot = this.getAssignedHotspot(state);
    const area = hotspot?.area ?? this.getAssignedRoamBounds(state);
    if (!area) {
      return null;
    }
    return (target) => {
      if (!target) {
        return false;
      }
      return (
        (hotspot || isOutsideWildernessHotspots(target)) &&
        target.z === area.z &&
        target.x >= area.minX &&
        target.x <= area.maxX &&
        target.y >= area.minY &&
        target.y <= area.maxY
      );
    };
  }

  ensureDitchContext(state) {
    if (!state?.roaming) {
      return null;
    }
    if (!state.roaming.ditchContext) {
      state.roaming.ditchContext = {
        ditchY: null,
        keepSouthSide: null,
        computedAt: 0,
        sourceY: null,
        hintY: null,
      };
    }
    return state.roaming.ditchContext;
  }

  getCachedDitchContext(player, state, preferredY, nowMs) {
    const context = this.ensureDitchContext(state);
    if (!context || !player) {
      return null;
    }
    const currentY = player.getLocation?.()?.getY?.();
    if (!Number.isFinite(currentY)) {
      return null;
    }
    const hintY = Number.isFinite(preferredY) ? Math.floor(preferredY) : null;
    if (
      nowMs - Number(context.computedAt ?? 0) > DITCH_CONTEXT_TTL_MS ||
      context.sourceY !== currentY ||
      context.hintY !== hintY
    ) {
      return null;
    }
    if (!Number.isFinite(context.ditchY) || typeof context.keepSouthSide !== "boolean") {
      return null;
    }
    return context;
  }

  storeDitchContext(state, currentY, ditchY, preferredY, nowMs) {
    const context = this.ensureDitchContext(state);
    if (!context) {
      return null;
    }
    context.ditchY = ditchY;
    context.keepSouthSide = currentY <= ditchY;
    context.computedAt = nowMs;
    context.sourceY = currentY;
    context.hintY = Number.isFinite(preferredY) ? Math.floor(preferredY) : null;
    return context;
  }

  resolveNearestDitchY(player, preferredY = null) {
    if (Number.isFinite(preferredY)) {
      return preferredY;
    }
    if (
      !player ||
      !this.objectSearch?.findNearestObject ||
      !Number.isFinite(this.wildernessDitchObjectId)
    ) {
      return null;
    }
    const ditchObject = this.objectSearch.findNearestObject(
      player,
      this.wildernessDitchObjectId,
      this.ditchProbeRadius
    );
    const ditchY = ditchObject?.getLocation?.()?.getY?.();
    return Number.isFinite(ditchY) ? ditchY : null;
  }

  buildRoamingTargetConstraint(player, state, ditchYHint = null, nowMs = Date.now()) {
    const currentY = player?.getLocation?.()?.getY?.();
    if (!Number.isFinite(currentY)) {
      return null;
    }
    const cached = this.getCachedDitchContext(player, state, ditchYHint, nowMs);
    const ditchY =
      cached?.ditchY ?? this.resolveNearestDitchY(player, ditchYHint);
    if (!Number.isFinite(ditchY)) {
      return null;
    }
    if (Math.abs(currentY - ditchY) <= this.roamingDitchCrossMaxDistanceY) {
      return null;
    }
    const keepSouthSide =
      typeof cached?.keepSouthSide === "boolean"
        ? cached.keepSouthSide
        : currentY <= ditchY;
    this.storeDitchContext(state, currentY, ditchY, ditchYHint, nowMs);
    return {
      ditchY,
      acceptTarget: (target) => {
        if (!target || !Number.isFinite(target.y)) {
          return false;
        }
        return keepSouthSide ? target.y <= ditchY : target.y >= ditchY;
      },
    };
  }

  chooseRoamingTarget(player, state, ditchYHint = null, nowMs = Date.now()) {
    const constraint = this.buildRoamingTargetConstraint(
      player,
      state,
      ditchYHint,
      nowMs
    );
    const hotspotAcceptTarget = this.buildHotspotTargetConstraint(state);
    const baseAcceptTarget =
      typeof constraint?.acceptTarget === "function" ? constraint.acceptTarget : null;
    const acceptTarget =
      typeof hotspotAcceptTarget === "function" && typeof baseAcceptTarget === "function"
        ? (target) => baseAcceptTarget(target) === true && hotspotAcceptTarget(target) === true
        : hotspotAcceptTarget ?? baseAcceptTarget;
    const chooseOptions = acceptTarget ? { acceptTarget } : {};
    const roamBounds = this.getAssignedRoamBounds(state);
    if (roamBounds) {
      chooseOptions.bounds = roamBounds;
    }
    return {
      target: chooseNextTarget(
        player,
        state,
        this.getEffectiveWalkRadius(state),
        chooseOptions
      ),
      chooseOptions,
      constraintApplied: !!acceptTarget,
    };
  }

  activateMode({ player, state }) {
    if (!player || !state) {
      return false;
    }
    setModeRoaming(player, state, this.behaviorMode);
    return true;
  }

  startMode({ player, state, nowMs, activeForMs, reason = "auto_switch" }) {
    if (!this.activateMode({ player, state })) {
      return false;
    }
    if (!state.autonomy) {
      state.autonomy = {
        nextDecisionAt: 0,
        modeEndsAt: 0,
        pvpCooldownUntil: 0,
        manualMode: null,
      };
    }
    const durationMs =
      Number.isInteger(activeForMs) && activeForMs > 0
        ? activeForMs
        : randomInRange(this.roamingMinMs, this.roamingMaxMs);
    if (Number.isInteger(nowMs)) {
      state.autonomy.modeEndsAt = nowMs + durationMs;
    }
    this.api?.log?.("bot_mode_switch", {
      username: player.getUsername?.(),
      mode: this.behaviorMode.ROAMING,
      reason,
      activeForMs: durationMs,
    });
    return true;
  }

  onPlayerAttackReaction(payload) {
    return handlePlayerAttackReaction({
      ...payload,
      behaviorMode: this.behaviorMode,
      api: this.api,
    });
  }

  appendStatusLines({ lines, state, nowMs, helpers = {} }) {
    if (!Array.isArray(lines) || !state?.roaming) {
      return;
    }
    const formatPoint = helpers?.formatPoint ?? (() => "n/a");
    const msRemainingLabel = helpers?.msRemainingLabel ?? (() => "n/a");
    lines.push(
      `roaming target=${formatPoint(
        state.roaming.target
      )} nextWalk=${msRemainingLabel(state.roaming.nextWalkAt, nowMs)}`
    );
  }

  handleBlocked({
    player,
    state,
    event,
    nowMs,
    traversalService,
    blockedRetargetMinDelayMs,
    blockedRetargetMaxDelayMs,
  }) {
    if (!player || !state || !traversalService) {
      return false;
    }
    if (!state.roaming?.target) {
      const { target: fallbackTarget } = this.chooseRoamingTarget(
        player,
        state,
        event?.to?.y,
        nowMs
      );
      if (!fallbackTarget) {
        return true;
      }
      state.roaming.target = fallbackTarget;
    }

    const traversalObject = traversalService.findObjectOnRoute(
      player,
      event?.from,
      state.roaming.target,
      nowMs
    );
    if (!traversalObject) {
      const { chooseOptions } = this.chooseRoamingTarget(player, state, event?.to?.y, nowMs);
      retargetAfterBlocked(
        player,
        state,
        this.api,
        "no_ditch_on_route",
        event,
        nowMs,
        blockedRetargetMinDelayMs,
        blockedRetargetMaxDelayMs,
        this.botWalkRadius,
        chooseOptions
      );
      return true;
    }

    const currentY = player.getLocation().getY();
    const targetY = state.roaming.target.y;
    const objectY = traversalObject.getLocation().getY();
    if (!traversalService.isObjectBetween(currentY, targetY, objectY)) {
      const { chooseOptions } = this.chooseRoamingTarget(player, state, objectY, nowMs);
      retargetAfterBlocked(
        player,
        state,
        this.api,
        "ditch_not_between_current_and_target",
        event,
        nowMs,
        blockedRetargetMinDelayMs,
        blockedRetargetMaxDelayMs,
        this.botWalkRadius,
        chooseOptions
      );
      return true;
    }

    const requestedCross =
      traversalService.requestCross(player, state, traversalObject, nowMs) ===
      true;
    if (!requestedCross) {
      const { chooseOptions } = this.chooseRoamingTarget(player, state, objectY, nowMs);
      retargetAfterBlocked(
        player,
        state,
        this.api,
        "ditch_too_far_for_roaming_cross",
        event,
        nowMs,
        blockedRetargetMinDelayMs,
        blockedRetargetMaxDelayMs,
        this.botWalkRadius,
        chooseOptions
      );
    }
    return true;
  }

  tick(context) {
    const resolved = resolveBotNodeContext(context, this.botStatesByName, {
      requiredMode: this.behaviorMode.ROAMING,
    });
    if (!resolved) {
      return "failure";
    }
    const { player, state, nowMs } = resolved;
    if (!state.roaming || nowMs < (state.roaming.nextWalkAt ?? 0)) {
      return "failure";
    }

    const queue = player.getMovementQueue();
    if (!queue || queue.size() > 0) {
      return "failure";
    }

    let target = state.roaming.target;
    let chooseOptions = null;
    if (target) {
      const acceptHotspotTarget = this.buildHotspotTargetConstraint(state);
      if (acceptHotspotTarget && !acceptHotspotTarget(target)) {
        target = null;
      }
      const constraint = this.buildRoamingTargetConstraint(player, state, null, nowMs);
      if (typeof constraint?.acceptTarget === "function") {
        chooseOptions = { acceptTarget: constraint.acceptTarget };
        if (constraint.acceptTarget(target) !== true) {
          target = null;
        }
      }
    }
    clearFollowState(player, state);
    if (!target) {
      const targetSelection = this.chooseRoamingTarget(player, state, null, nowMs);
      chooseOptions = targetSelection.chooseOptions;
      target = targetSelection.target;
      if (!target) {
        return "failure";
      }
      state.roaming.target = target;
      state.roaming.nextWalkAt =
        nowMs +
        this.getDynamicRoamingDelayMs(
          player,
          nowMs,
          ROAMING_PRE_WALK_MIN_MS,
          ROAMING_PRE_WALK_MAX_MS
        );
      return "failure";
    }

    if (!isAtTarget(player, target)) {
      queueRouteAndFlagAppearance(player, target.x, target.y, { state });
      return "success";
    }

    if ((state.roaming.endpointPauseUntil ?? 0) === 0) {
      state.roaming.endpointPauseUntil =
        nowMs + this.getEffectiveEndpointLingerMs(player, state);
      return "failure";
    }
    if (nowMs < state.roaming.endpointPauseUntil) {
      return "failure";
    }

    state.roaming.endpointPauseUntil = 0;
    if (!chooseOptions) {
      chooseOptions = this.chooseRoamingTarget(player, state, null, nowMs).chooseOptions;
    }
    const nextTarget = chooseNextTarget(
      player,
      state,
      this.getEffectiveWalkRadius(state),
      chooseOptions
    );
    if (!nextTarget) {
      return "failure";
    }
    state.roaming.target = nextTarget;
    state.roaming.nextWalkAt =
      nowMs +
      this.getDynamicRoamingDelayMs(
        player,
        nowMs,
        ROAMING_PRE_WALK_MIN_MS,
        ROAMING_PRE_WALK_MAX_MS
      );
    return "failure";
  }
}

const ROAMING_MODE_DESCRIPTOR = Object.freeze({
  key: "roaming",
  assignable: true,
  modeProperty: "ROAMING",
  autonomous: Object.freeze({
    strategy: "start",
    weight: 0.4,
    minMs: 22000,
    maxMs: 80000,
    priority: 60,
  }),
  requiredHooks: ["activateMode", "startMode", "handleBlocked"],
  create({ botStatesByName, api, behaviorMode, options = {}, objectSearch }) {
    return new RoamingBehavior(botStatesByName, {
      api,
      behaviorMode,
      endpointLingerMs: options.endpointLingerMs,
      botWalkRadius: options.botWalkRadius,
      roamingMinMs: options.roamingMinMs,
      roamingMaxMs: options.roamingMaxMs,
      objectSearch,
      wildernessDitchObjectId: options.wildernessDitchObjectId,
      roamingDitchCrossMaxDistanceY: options.roamingDitchCrossMaxDistanceY,
      ditchProbeRadius: options.roamingDitchProbeRadius,
    });
  },
});

module.exports = {
  RoamingBehavior,
  ROAMING_MODE_DESCRIPTOR,
};
