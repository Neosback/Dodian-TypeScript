const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");

const PLAYER_MODERATOR_CROWN = 0;
const JAGEX_MODERATOR_CROWN = 1;

const CROWNS_BY_RIGHTS_ID = new Map([
  [PlayerRights.MODERATOR.getId(), [PLAYER_MODERATOR_CROWN]],
  [PlayerRights.ADMINISTRATOR.getId(), [JAGEX_MODERATOR_CROWN]],
  [PlayerRights.DEVELOPER.getId(), [JAGEX_MODERATOR_CROWN]],
]);

module.exports = {
  name: "StaffCrowns",
  register(api) {
    api.onPlayerLogin(({ player }) => {
      const rightsId = player.getRights?.().getId?.();
      player.setChatIcons(CROWNS_BY_RIGHTS_ID.get(rightsId) ?? []);
    });

    api.log("registered");
  },
};
