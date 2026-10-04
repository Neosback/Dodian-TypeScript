const {
  setModeFollowBack,
  setModeReturnHome,
} = require("../state/PlayerBotState");

class FollowBackModeHandler {
  constructor(options = {}) {
    this.World = options.api.getWorld();
    this.behaviorMode = options.behaviorMode;
    this.followBlockedRetryMs = options.followBlockedRetryMs ?? 200;
  }

  resolveTarget(state) {
    const username = state?.followTargetUsername;
    return username ? this.World.getPlayerByName(username) : null;
  }

  isModeStateValid({ player, state }) {
    const followTarget = this.resolveTarget(state);
    if (!player || !state || !followTarget) {
      return false;
    }
    if (!followTarget.isRegistered?.()) {
      return false;
    }
    return followTarget.getPrivateArea?.() === player.getPrivateArea?.();
  }

  activateMode({ player, state, nowMs = Date.now() }) {
    const followTarget = this.resolveTarget(state);
    if (!followTarget) {
      return false;
    }
    const currentUntil = Number(state?.followUntilMs ?? 0);
    const durationMs =
      currentUntil > nowMs ? currentUntil - nowMs : 30000;
    return setModeFollowBack(
      player,
      state,
      followTarget,
      nowMs,
      durationMs,
      this.behaviorMode
    );
  }

  handleBlocked({ player, state, event, nowMs, traversalService }) {
    if (!player || !state || !traversalService) {
      return false;
    }

    const followTarget = this.resolveTarget(state);
    if (!followTarget || !followTarget.isRegistered()) {
      setModeReturnHome(player, state, this.behaviorMode);
      return true;
    }

    const target = {
      x: followTarget.getLocation().getX(),
      y: followTarget.getLocation().getY(),
      z: followTarget.getLocation().getZ(),
    };

    const traversalObject = traversalService.findObjectOnRoute(
      player,
      event?.from,
      target
    );
    if (!traversalObject) {
      state.nextFollowRepathAt = Math.max(
        Number(state.nextFollowRepathAt ?? 0),
        nowMs + this.followBlockedRetryMs
      );
      return true;
    }

    const currentY = player.getLocation().getY();
    const targetY = target.y;
    const objectY = traversalObject.getLocation().getY();
    if (!traversalService.isObjectBetween(currentY, targetY, objectY)) {
      state.nextFollowRepathAt = Math.max(
        Number(state.nextFollowRepathAt ?? 0),
        nowMs + this.followBlockedRetryMs
      );
      return true;
    }

    traversalService.requestCross(player, state, traversalObject, nowMs);
    return true;
  }
}

module.exports = {
  FollowBackModeHandler,
};
