const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");

let pluginApi;

function climbUp({ player, location }) {
  if (location.x !== 3097 || location.y !== 9867 || location.z !== 0) return false;
  pluginApi.emitCustomEvent("ladders:climbUp", {
    player,
    destination: new Location(3096, 3468),
  });
}

function openTrapdoor({ player, location }) {
  if (location.x !== 3097 || location.y !== 3468 || location.z !== 0) return false;
  pluginApi.emitCustomEvent("ladders:climbDown", {
    player,
    destination: new Location(3096, 9867),
  });
}

function pullLever({ player, location }) {
  if (location.x !== 3090 || location.y !== 3475 || location.z !== 0) return false;
  const start = player.getLocation().clone();
  pluginApi.sendMultiChatboxPrompt(
    player,
    "Warning: deep Wilderness! Players can attack you.",
    "Yes, teleport me into deep Wilderness.",
    () => {
      if (player.getLocation().equals(start)) {
        pluginApi.emitCustomEvent("lever:teleport", {
          player,
          destination: new Location(3153, 3923),
        });
      }
    },
    "No, stay here.",
    () => {},
  );
}

module.exports = {
  name: "Edgeville",
  register(api) {
    pluginApi = api;
    api.onObjectInteraction("Ladder", { "Climb-up": climbUp });
    api.onObjectInteraction("Trapdoor", { Open: openTrapdoor });
    api.onObjectInteraction("Lever", { Pull: pullLever });
  },
};
