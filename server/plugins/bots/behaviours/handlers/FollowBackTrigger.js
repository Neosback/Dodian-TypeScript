const { resetMovementState } = require("../state/PlayerBotState");
const { callModeHook } = require("../hooks/ModeHookContract");

class FollowBackTrigger {
  constructor({ botStatesByName, playerBotUsernames, modeHandlers, api, options }) {
    this.botStatesByName = botStatesByName;
    this.playerBotUsernames = playerBotUsernames;
    this.modeHandlers = modeHandlers ?? {};
    this.api = api;
    this.behaviorMode = options.behaviorMode;
    this.botStatusReporter = options.botStatusReporter ?? null;
  }

  activateMode(target, state, mode, reason, nowMs) {
    return (
      callModeHook({
        modeHandlers: this.modeHandlers,
        mode,
        hookName: "activateMode",
        payload: {
          player: target,
          state,
          nowMs,
          reason,
        },
        fallback: false,
        api: this.api,
        errorEvent: "bot_follow_recovery_activation_error",
      }) === true
    );
  }

  applyRecoveryNudge(target, state, follower, nowMs) {
    const currentMode =
      typeof state?.mode === "string" && state.mode.length > 0
        ? state.mode
        : this.behaviorMode.ROAMING;

    let activated = this.activateMode(
      target,
      state,
      currentMode,
      "follow_recovery_nudge",
      nowMs
    );
    if (!activated && currentMode !== this.behaviorMode.ROAMING) {
      activated = this.activateMode(
        target,
        state,
        this.behaviorMode.ROAMING,
        "follow_recovery_fallback",
        nowMs
      );
    }

    state.awaitingDitchTransition = null;
    state.nextDitchAttemptAt = 0;
    if (state.autonomy) {
      state.autonomy.nextDecisionAt = 0;
      state.autonomy.modeEndsAt = 0;
    }
    resetMovementState(target);

    this.api.log("bot_follow_recovery_nudge", {
      bot: target.getUsername?.() ?? null,
      follower: follower.getUsername?.() ?? null,
      modeBefore: currentMode,
      activated,
    });
  }

  handlePlayerFollow({ player, leader }, nowMs = Date.now()) {
    if (!player) {
      return;
    }

    const followed = leader;
    const followedUsername = followed?.getUsername?.();

    if (
      !followed ||
      followed === player ||
      (player.isPlayerBot?.() ?? false) ||
      !followedUsername ||
      !this.playerBotUsernames.has(followedUsername) ||
      !followed.isRegistered()
    ) {
      return;
    }

    const state = this.botStatesByName.get(followedUsername);
    if (!state) {
      return;
    }

    this.applyRecoveryNudge(followed, state, player, nowMs);
    this.botStatusReporter?.dumpToDiagnoseLog?.(
      player,
      followed,
      "follow_recovery_nudge"
    );
    player?.getPacketSender?.()?.sendMessage?.(
      "Bot pathing refreshed; diagnosis snapshot logged."
    );
  }
}

module.exports = {
  FollowBackTrigger,
};
