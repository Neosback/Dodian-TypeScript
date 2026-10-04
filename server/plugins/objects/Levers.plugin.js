const { TeleportHandler } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportHandler");
const { TeleportType } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportType");

function teleport({ player, destination }) {
  if (TeleportHandler.checkReqs(player, destination, Infinity)) {
    TeleportHandler.teleport(player, destination.clone(), TeleportType.NORMAL, false);
  }
}

module.exports = {
  name: "Levers",
  register(api) {
    api.onCustomEvent("lever:teleport", teleport);
  },
};
