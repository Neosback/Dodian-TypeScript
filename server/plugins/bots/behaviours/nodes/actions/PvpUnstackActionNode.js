const { ActionNode } = require("../../../../../src/main/typescript/elvarg/game/bot/BehaviorTree");
const { Location } = require("../../../../../src/main/typescript/elvarg/game/model/Location");
const {GameConstants} = require("../../../../../src/main/typescript/elvarg/game/GameConstants");

const UNSTACK_CHECK_INTERVAL_MS = GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE * 2;
const UNSTACK_COOLDOWN_MS = 900;

class PvpUnstackActionNode extends ActionNode {
  constructor(botStatesByName, api, options = {}) {
    super((context) => this.tick(context));
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.behaviorMode = options.behaviorMode;
  }

  tick(context) {
    // Unstack has been removed from bot PvP behavior.
    return "success";
  }

  findOverlapTarget(player, preferredTarget) {
    const playerLoc = player.getLocation?.();
    const privateArea = player.getPrivateArea?.();
    if (!playerLoc) {
      return null;
    }

    const matchesTile = (candidate) => {
      if (!candidate || candidate === player || !candidate.isRegistered?.()) {
        return false;
      }
      if (candidate.getPrivateArea?.() !== privateArea) {
        return false;
      }
      const loc = candidate.getLocation?.();
      return !!(
        loc &&
        loc.getX() === playerLoc.getX() &&
        loc.getY() === playerLoc.getY() &&
        loc.getZ() === playerLoc.getZ()
      );
    };

    if (matchesTile(preferredTarget)) {
      return preferredTarget;
    }

    const localPlayers = player.getLocalPlayers?.() ?? [];
    for (const candidate of localPlayers) {
      if (matchesTile(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  isOccupiedByOtherPlayer(tile, player, target) {
    const tileX = tile.getX();
    const tileY = tile.getY();
    const tileZ = tile.getZ();
    const privateArea = player.getPrivateArea?.();
    const localPlayers = player.getLocalPlayers?.() ?? [];
    for (const candidate of localPlayers) {
      if (!candidate || candidate === player || candidate === target) {
        continue;
      }
      if (!candidate.isRegistered?.()) {
        continue;
      }
      if (candidate.getPrivateArea?.() !== privateArea) {
        continue;
      }
      const loc = candidate.getLocation?.();
      if (!loc) {
        continue;
      }
      if (loc.getX() === tileX && loc.getY() === tileY && loc.getZ() === tileZ) {
        return true;
      }
    }
    return false;
  }

  chooseAdjacentTile(player, target) {
    const current = player.getLocation?.();
    const privateArea = player.getPrivateArea?.() ?? null;
    const size = Number(player.getSize?.() ?? 1);
    if (!current) {
      return null;
    }

    const candidates = [
      new Location(current.getX() - 1, current.getY(), current.getZ()),
      new Location(current.getX() + 1, current.getY(), current.getZ()),
      new Location(current.getX(), current.getY() - 1, current.getZ()),
      new Location(current.getX(), current.getY() + 1, current.getZ()),
    ];

    const regionManager = this.api.getRegionManager();
    let bestTile = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const tile of candidates) {
      if (regionManager.blocked(tile, privateArea)) {
        continue;
      }
      if (!regionManager.canMovestart(current, tile, size, size, privateArea)) {
        continue;
      }
      if (this.isOccupiedByOtherPlayer(tile, player, target)) {
        continue;
      }
      const distance = tile.getDistance(target.getLocation?.());
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTile = tile;
      }
    }
    return bestTile;
  }
}

module.exports = {
  PvpUnstackActionNode,
};
