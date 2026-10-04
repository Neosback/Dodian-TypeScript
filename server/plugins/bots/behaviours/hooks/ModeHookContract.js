const KNOWN_MODE_HOOKS = Object.freeze([
  "registerEvents",
  "behaviorRequirementsMet",
  "activateMode",
  "startMode",
  "tryStartMode",
  "stopMode",
  "isModeStateValid",
  "handleBlocked",
  "getTraversalTarget",
  "setTraversalTarget",
  "onPostTraversalRetryScheduled",
  "getModeLogContext",
  "onBankRunResume",
  "onNpcAggroAttempt",
  "onNpcCombatDetected",
  "onPlayerAttackReaction",
  "collectTrackedObjectIds",
  "appendStatusLines",
]);

function validateModeHandlerContracts(
  modeHandlers,
  requiredHooksByMode,
  api,
  label = "mode_handlers"
) {
  if (!modeHandlers || typeof modeHandlers !== "object") {
    throw new Error(`${label}: modeHandlers must be an object.`);
  }
  if (!requiredHooksByMode || typeof requiredHooksByMode !== "object") {
    throw new Error(`${label}: requiredHooksByMode must be an object.`);
  }

  for (const [mode, requiredHooks] of Object.entries(requiredHooksByMode)) {
    const handler = modeHandlers[mode];
    if (!handler || typeof handler !== "object") {
      throw new Error(`${label}: missing handler for mode '${mode}'.`);
    }
    for (const hookName of requiredHooks) {
      if (typeof handler[hookName] !== "function") {
        throw new Error(
          `${label}: mode '${mode}' is missing required hook '${hookName}'.`
        );
      }
    }
  }

  for (const [mode, handler] of Object.entries(modeHandlers)) {
    if (!handler || typeof handler !== "object") {
      throw new Error(`${label}: handler for mode '${mode}' must be an object.`);
    }
    for (const hookName of Object.keys(handler)) {
      if (!KNOWN_MODE_HOOKS.includes(hookName) && typeof handler[hookName] === "function") {
        api?.log?.("bot_mode_handler_unknown_hook", {
          label,
          mode,
          hook: hookName,
        });
      }
    }
  }
}

function callModeHook({
  modeHandlers,
  mode,
  hookName,
  payload = {},
  fallback = false,
  api = null,
  errorEvent = "bot_mode_hook_error",
}) {
  const handler = modeHandlers?.[mode];
  const fn = handler?.[hookName];
  if (typeof fn !== "function") {
    return fallback;
  }
  try {
    // Preserve handler method context; mode handlers rely on `this`.
    const value = fn.call(handler, payload);
    return value === undefined ? fallback : value;
  } catch (err) {
    api?.log?.(errorEvent, {
      mode,
      hook: hookName,
      username:
        payload?.entry?.player?.getUsername?.() ??
        payload?.player?.getUsername?.() ??
        null,
      error: String(err?.message ?? err),
    });
    return fallback;
  }
}

module.exports = {
  KNOWN_MODE_HOOKS,
  validateModeHandlerContracts,
  callModeHook,
};
