const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { encodeGameframeBootstrap } = require("../../src/main/typescript/elvarg/net/protocol/ClientProtocol");

const WELCOME_SCREEN_GROUP_ID = 378;
const PLAY_BUTTON_UID = (WELCOME_SCREEN_GROUP_ID << 16) | 72;
const FIRST_OPTION_FLAG = 1 << 1;

function inWilderness(player) {
  return Wilderness.isInLocation(player?.getLocation?.());
}

function showWelcomeScreen(player) {
  const sender = player.getPacketSender();
  sender.sendRootInterface(WELCOME_SCREEN_GROUP_ID);
  sender.sendInterfaceFlags(PLAY_BUTTON_UID, FIRST_OPTION_FLAG);
}

function showGameframe(player) {
  // 548/164/161 - the layout the "Game client layout" dropdown saved; the
  // client maps the standard mounts onto the chosen layout.
  const savedRoot = Number(player.getAttribute("clientLayoutRoot"));
  const layoutRoot = [548, 164, 161].includes(savedRoot) ? savedRoot : 161;
  for (const packet of encodeGameframeBootstrap(player.getUsername(), layoutRoot)) {
    player.getSession().sendClientPacket(packet);
  }
}

module.exports = {
  name: "WelcomeScreen",
  dependsOn: ["Wilderness"],
  register(api) {
    const pending = new WeakSet();
    const visible = new WeakSet();

    const clear = ({ player }) => {
      pending.delete(player);
      visible.delete(player);
    };

    api.onPlayerLogin(({ player }) => {
      if (player.isPlayerBot?.() === true || inWilderness(player)) {
        return;
      }
      pending.add(player);
      // The login hook runs just before the normal gameframe is sent. Queueing the
      // root swap keeps packet order correct without delaying the screen for a game tick.
      queueMicrotask(() => {
        if (!pending.delete(player) || inWilderness(player)) {
          return;
        }
        visible.add(player);
        showWelcomeScreen(player);
      });
    });

    api.onInterfaceActionButton(PLAY_BUTTON_UID, ({ player }) => {
      if (!visible.has(player)) {
        return false;
      }
      visible.delete(player);
      showGameframe(player);
      // Let post-welcome content react after the normal gameframe is restored.
      return false;
    });

    api.onPlayerDisconnect(clear);
    api.onPlayerLogout(clear);
    api.log("registered");
  },
};
