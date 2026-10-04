"use strict";

const { VoiceChatSignalServer } = require("../../src/main/typescript/elvarg/plugins/voice/VoiceChatSignalServer");

module.exports = {
  name: "VoiceChat",
  register(api) {
    api.onServerStartup(() => {
      VoiceChatSignalServer.stop();
      VoiceChatSignalServer.start();
    });

    api.onServerShutdown(() => {
      VoiceChatSignalServer.stop();
    });

    const disconnectPlayer = ({ player, username }) => {
      const resolvedUsername =
        player?.getUsername?.() ?? (typeof username === "string" ? username : null);
      VoiceChatSignalServer.disconnectUsername(resolvedUsername);
    };

    api.onPlayerLogout(disconnectPlayer);
    api.onPlayerDisconnect(disconnectPlayer);
  },
};
