const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");

module.exports = {
  name: "SpawnMode",
  register(api) {
    api.setCommandRights("items", PlayerRights.NONE);
  },
};
