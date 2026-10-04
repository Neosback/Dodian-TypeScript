const { GameConstants } = require("../../../../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../../../../src/main/typescript/elvarg/util/Misc");
const { clearMovementRequest } = require("../../navigation/BotNavigation");
const { setModeReturnHome } = require("../../state/PlayerBotState");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
} = require("../../../runtime/BotRecruitConstants");
const { resolveBotNodeContext } = require("../context/BotNodeContext");

class FollowBackActionNode {
  constructor(botStatesByName, api, options) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.World = api.getWorld();
    this.RegionManager = api.getRegionManager();
    this.behaviorMode = options.behaviorMode;
  }

  tick(context) {
    const resolved = resolveBotNodeContext(context, this.botStatesByName, {
      requiredMode: this.behaviorMode.FOLLOW_BACK,
    });
    if (!resolved) {
      return "failure";
    }
    const { player, state, nowMs } = resolved;
    if (nowMs >= (state.followUntilMs ?? 0)) {
      setModeReturnHome(player, state, this.behaviorMode);
      this.api.log("follow_back_expired", { username: player.getUsername() });
      return "success";
    }

    const targetUsername = state.followTargetUsername;
    if (!targetUsername) {
      setModeReturnHome(player, state, this.behaviorMode);
      return "success";
    }

    const followTarget = this.World.getPlayerByName(targetUsername);
    if (!followTarget || !followTarget.isRegistered()) {
      setModeReturnHome(player, state, this.behaviorMode);
      this.api.log("follow_back_target_lost", {
        username: player.getUsername(),
        target: targetUsername,
      });
      return "success";
    }
    if (followTarget.getPrivateArea() != player.getPrivateArea()) {
      setModeReturnHome(player, state, this.behaviorMode);
      this.api.log("follow_back_target_private_area_mismatch", {
        username: player.getUsername(),
        target: targetUsername,
      });
      return "success";
    }

    if (player.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME) === targetUsername) {
      this.teleportNearFollowTargetIfNeeded(player, followTarget);
    }

    player.setFollowing(followTarget);
    player.setMobileInteraction(followTarget);
    player.setPositionToFace(followTarget.getLocation());
    clearMovementRequest(player);
    return "running";
  }

  teleportNearFollowTargetIfNeeded(player, followTarget) {
    const playerLoc = player.getLocation?.();
    const targetLoc = followTarget.getLocation?.();
    if (!playerLoc || !targetLoc) {
      return;
    }
    if (
      followTarget.isTeleportingReturn?.() !== true &&
      targetLoc.isWithinDistance?.(
        playerLoc,
        GameConstants.PET_FOLLOW_AUTO_TELEPORT_DISTANCE
      ) === true
    ) {
      return;
    }

    const tiles = [];
    for (const tile of followTarget.outterTiles?.() ?? []) {
      if (this.RegionManager.blocked?.(tile, followTarget.getPrivateArea?.())) {
        continue;
      }
      tiles.push(tile);
    }
    const destination =
      tiles.length > 0 ? tiles[Misc.getRandom(tiles.length - 1)] : targetLoc;
    player.moveTo?.(destination);
  }
}

module.exports = {
  FollowBackActionNode,
};
