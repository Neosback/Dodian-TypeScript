const { enableStaking } = require("../minigames/DuelArena.plugin");

module.exports = {
  name: "DuelStaking",
  dependsOn: ["DuelArena"],
  register() {
    enableStaking();
  },
};
