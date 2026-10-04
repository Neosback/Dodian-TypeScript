const { callModeHook } = require("../hooks/ModeHookContract");

class NpcAggroPolicyHandler {
  constructor({ botStatesByName, modeHandlers, api, options = {} }) {
    this.botStatesByName = botStatesByName;
    this.modeHandlers = modeHandlers ?? {};
    this.api = api ?? null;
    this.npcAggroBlockedModes = new Set(options.npcAggroBlockedModes ?? []);
    this.modesWithNpcAggroAttemptHook = new Set();
    this.modesWithNpcCombatDetectedHook = new Set();
    for (const [mode, handler] of Object.entries(this.modeHandlers)) {
      if (typeof handler?.onNpcAggroAttempt === "function") {
        this.modesWithNpcAggroAttemptHook.add(mode);
      }
      if (typeof handler?.onNpcCombatDetected === "function") {
        this.modesWithNpcCombatDetectedHook.add(mode);
      }
    }
  }

  resolveBotState(player) {
    if (!player?.isPlayerBot?.()) {
      return null;
    }
    const username = player.getUsername?.();
    if (!username) {
      return null;
    }
    const state = this.botStatesByName.get(username);
    if (!state || typeof state.mode !== "string" || state.mode.length === 0) {
      return null;
    }
    return { username, state };
  }

  handleCanAttack(event) {
    if (!event || event.allow !== null) {
      return false;
    }
    const attacker = event?.attacker;
    const target = event?.target;
    if (attacker?.isNpc?.() !== true || target?.isPlayer?.() !== true) {
      return false;
    }

    const player = target.getAsPlayer?.() ?? target;
    if (player?.isPlayerBot?.() !== true) {
      return false;
    }
    const resolved = this.resolveBotState(player);
    if (!resolved) {
      return false;
    }
    if (this.npcAggroBlockedModes.has(resolved.state.mode)) {
      event.allow = false;
      return true;
    }
    if (!this.modesWithNpcAggroAttemptHook.has(resolved.state.mode)) {
      return false;
    }
    const npc = attacker.getAsNpc?.() ?? attacker;

    return callModeHook({
      modeHandlers: this.modeHandlers,
      mode: resolved.state.mode,
      hookName: "onNpcAggroAttempt",
      payload: { event, player, state: resolved.state, attacker: npc },
      fallback: false,
      api: this.api,
      errorEvent: "bot_mode_npc_aggro_attempt_error",
    });
  }

  handlePlayerProcess({ player, nowMs = Date.now() }) {
    const resolved = this.resolveBotState(player);
    if (!resolved) {
      return false;
    }
    if (!this.modesWithNpcCombatDetectedHook.has(resolved.state.mode)) {
      return false;
    }
    const combat = player.getCombat?.();
    if (!combat) {
      return false;
    }
    const attacker = combat.getAttacker?.();
    const target = combat.getTarget?.();
    const attackerIsNpc = attacker?.isNpc?.() === true;
    const targetIsNpc = target?.isNpc?.() === true;
    if (!attackerIsNpc && !targetIsNpc) {
      return false;
    }

    return callModeHook({
      modeHandlers: this.modeHandlers,
      mode: resolved.state.mode,
      hookName: "onNpcCombatDetected",
      payload: {
        player,
        state: resolved.state,
        nowMs,
        combat,
        attacker,
        target,
      },
      fallback: false,
      api: this.api,
      errorEvent: "bot_mode_npc_combat_detected_error",
    });
  }
}

module.exports = {
  NpcAggroPolicyHandler,
};
