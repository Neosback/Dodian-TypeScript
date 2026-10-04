const { MODE_DESCRIPTORS } = require("../modes");

function resolveModeFromDescriptor(descriptor, behaviorMode) {
  if (!descriptor || typeof descriptor !== "object") {
    return null;
  }
  const modeProperty = descriptor.modeProperty;
  if (typeof modeProperty !== "string" || modeProperty.length === 0) {
    return null;
  }
  const mode = behaviorMode?.[modeProperty];
  return typeof mode === "string" && mode.length > 0 ? mode : null;
}

function createModeHandlers({
  botStatesByName,
  api,
  behaviorMode,
  modeHandlers = {},
  objectSearch = null,
  options = {},
}) {
  const requiredHooksByMode = {};

  for (const descriptor of MODE_DESCRIPTORS) {
    if (!descriptor || typeof descriptor.create !== "function") {
      throw new Error("createModeHandlers encountered an invalid mode descriptor.");
    }
    const modeValue = behaviorMode?.[descriptor.modeProperty];
    if (typeof modeValue !== "string" || modeValue.length === 0) {
      throw new Error(
        `createModeHandlers missing behaviorMode.${descriptor.modeProperty} for mode descriptor '${descriptor.key}'.`
      );
    }

    const behavior = descriptor.create({
      botStatesByName,
      api,
      behaviorMode,
      modeHandlers,
      objectSearch,
      options,
    });

    modeHandlers[modeValue] = behavior;
    requiredHooksByMode[modeValue] = Array.isArray(descriptor.requiredHooks)
      ? [...descriptor.requiredHooks]
      : [];
  }

  return {
    modeHandlers,
    requiredHooksByMode,
  };
}

function buildModeRegistries(behaviorMode) {
  const assignable = {};
  const autonomous = [];
  const modeStopParamsByMode = {};
  for (const descriptor of MODE_DESCRIPTORS) {
    const mode = resolveModeFromDescriptor(descriptor, behaviorMode);
    if (!mode) {
      continue;
    }

    if (descriptor.assignable === true) {
      const key = String(descriptor.key ?? "").toLowerCase();
      if (key.length > 0) {
        assignable[key] = mode;
      }
    }

    const autonomousConfig = descriptor?.autonomous;
    if (autonomousConfig && typeof autonomousConfig === "object") {
      autonomous.push({
        mode,
        strategy:
          typeof autonomousConfig.strategy === "string" &&
          autonomousConfig.strategy.length > 0
            ? autonomousConfig.strategy
            : "start",
        weight: Number(autonomousConfig.weight ?? 0),
        minMs: Number(autonomousConfig.minMs ?? 0),
        maxMs: Number(autonomousConfig.maxMs ?? 0),
        params:
          autonomousConfig.params && typeof autonomousConfig.params === "object"
            ? { ...autonomousConfig.params }
            : undefined,
        reason:
          typeof autonomousConfig.reason === "string" &&
          autonomousConfig.reason.length > 0
            ? autonomousConfig.reason
            : undefined,
        _priority: Number.isFinite(autonomousConfig.priority)
          ? autonomousConfig.priority
          : 0,
        _key: String(descriptor?.key ?? ""),
      });
    }

    const modeStopParams = descriptor?.modeStopParams;
    if (modeStopParams && typeof modeStopParams === "object") {
      modeStopParamsByMode[mode] = { ...modeStopParams };
    }
  }

  autonomous.sort((a, b) => {
    if (a._priority !== b._priority) {
      return a._priority - b._priority;
    }
    return a._key.localeCompare(b._key);
  });

  return Object.freeze({
    assignableBehaviors: Object.freeze(assignable),
    autonomousModes: Object.freeze(
      autonomous.map((definition) => {
        const { _priority, _key, ...clean } = definition;
        return Object.freeze(clean);
      })
    ),
    modeStopParamsByMode: Object.freeze(modeStopParamsByMode),
  });
}

module.exports = {
  createModeHandlers,
  MODE_DESCRIPTORS,
  buildModeRegistries,
};
