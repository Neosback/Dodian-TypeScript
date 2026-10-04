const path = require("path");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { ObjectIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const {
  resetMovementState,
  initPlayerBotStateCoreAccess,
} = require("./behaviours/state/PlayerBotState");
const {
  initBotRecruitRuntimeCoreAccess,
} = require("./runtime/BotRecruitRuntime");
const { registerBotCommands } = require("./runtime/registerBotCommands");
const { registerBotEvents } = require("./runtime/registerBotEvents");
const { createBotPluginLogging } = require("./runtime/BotPluginLogging");
const { bootPlayerBotsRuntime } = require("./runtime/BotPluginBoot");
const { setActiveBotRuntime } = require("./runtime/BotRuntimeRegistry");
const {
  registerBotStatusInteractions,
} = require("./runtime/registerBotStatusInteractions");

const BOT_BEHAVIOR_MODE = Object.freeze({
  ROAMING: "roaming",
  WOODCUTTING: "woodcutting",
  MINING: "mining",
  SMELTING: "smelting",
  FIREMAKING: "firemaking",
  BANK_RUN: "bank_run",
  PVP: "pvp",
  // Backward-compat alias for in-flight references.
  SPARRING: "pvp",
  FOLLOW_BACK: "follow_back",
  RETURN_HOME: "return_home",
});
function parseEnvInt(name, fallback, min = 0) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.floor(value));
}

const BOT_MODE_BEHAVIOR_OPTIONS = Object.freeze({
  endpointLingerMs: 500,
  botWalkRadius: 10,
  roamingMinMs: 22000,
  roamingMaxMs: 80000,
  wildernessDitchObjectId: ObjectIds.WILDERNESS_DITCH,
  roamingDitchCrossMaxDistanceY: 12,
  roamingDitchProbeRadius: 30,
});

const BOT_TREE_OPTIONS = Object.freeze({
  botEatLowHpRatio: 0.45,
  botEatHealMin: 12,
  botEatHealMax: 18,
  botEatMaxCharges: 16,
  botHomeRadius: 10,
  blockedRetargetMinDelayMs: 450,
});

const BOT_CONFIG = Object.freeze({
  behaviorMode: BOT_BEHAVIOR_MODE,
  botCount: 0,
  wildernessRoamerBotCount: 845,
  wildernessActiveRegionBotsPerRegion: 24,
  // Active-region snapshots are currently radius=1 (3x3 around each player region).
  // Inset by 1 to target only the true active core for regional wilderness bots.
  wildernessActiveRegionInset: 1,
  botWalkRadius: 10,
  objectIndexCachePath: path.join(
    process.cwd(),
    "plugins",
    "bots",
    "data",
    "object-index.json"
  ),
  // Run the scheduler every game tick; near-player throttling is handled by
  // LOD/budget logic so PvP bots do not move in visible waves.
  botDecisionTicks: 1,
  botBaseCooldownMs: 1200,
  botJitterMs: 300,
  ditchAttemptCooldownMs: 1200,
  roamingDitchCrossMaxDistanceY: 12,
  ditchTransitionTimeoutMs: 15000,
  ditchPostCrossRetryDelayMs: 0,
  blockedRetargetMinDelayMs: 450,
  blockedRetargetMaxDelayMs: 900,
  // Path-blocked mitigation:
  // - dedupe repeated identical block events
  // - only re-run heavy recovery on meaningful state changes
  // - cap repeated retries with exponential backoff
  pathBlockedDuplicateEventWindowMs: 1200,
  // Minimum time between path-blocked recovery attempts per bot.
  pathBlockedHandleMinIntervalMs: 750,
  pathBlockedMeaningfulRecheckMs: 3500,
  pathBlockedMaxRepeatBeforeBackoff: 2,
  pathBlockedBackoffBaseMs: 600,
  pathBlockedBackoffMaxMs: 8000,
  pathBlockedIgnoredModes: [BOT_BEHAVIOR_MODE.PVP],
  npcAggroBlockedModes: [
    BOT_BEHAVIOR_MODE.WOODCUTTING,
    BOT_BEHAVIOR_MODE.MINING,
    BOT_BEHAVIOR_MODE.SMELTING,
    BOT_BEHAVIOR_MODE.FIREMAKING,
    BOT_BEHAVIOR_MODE.BANK_RUN,
  ],
  taskProfiler: Object.freeze({
    // Hot-path profiler is useful for diagnostics but expensive at scale.
    // Keep disabled by default and enable explicitly when needed.
    enabled: (process.env.BOT_TASK_PROFILER_ENABLED ?? "0") === "1",
    intervalMs: parseEnvInt("BOT_TASK_PROFILER_INTERVAL_MS", 10000, 1000),
    sampleStride: parseEnvInt("BOT_TASK_PROFILER_SAMPLE_STRIDE", 4, 1),
  }),
  executionBudget: Object.freeze({
    enabled: (process.env.BOT_EXECUTION_BUDGET_ENABLED ?? "1") === "1",
    maxMs: parseEnvInt("BOT_EXECUTION_BUDGET_MS", 30, 5),
    minEntriesPerCycle: parseEnvInt("BOT_EXECUTION_MIN_ENTRIES_PER_CYCLE", 24, 1),
    logCooldownMs: parseEnvInt("BOT_EXECUTION_BUDGET_LOG_COOLDOWN_MS", 5000, 1000),
  }),
  timingDesyncMs: parseEnvInt("BOT_TIMING_DESYNC_MS", 900, 0),
  botSpawnRadius: 14,
  botSpawnMinDistance: 2,
  botSpawnMaxAttempts: 80,
  followBackDurationMs: 3 * 60 * 1000,
  playerAttackFleeChance: 0.5,
  followBlockedRetryMs: 200,
  autoModeDecisionMinMs: 7000,
  autoModeDecisionMaxMs: 22000,
  // Throttle heavy BT work for calm/idle bots:
  // 1 = every bot every cycle, 2 = every second cycle, 3 = every third, etc.
  // Combat/traversal/transient bots still run every cycle.
  modeValidationIntervalMs: 2500,
  idleEntryStride: 4,
  // Bot LOD simulation:
  // Near real players, bots tick every cycle for responsiveness.
  // Further away, bot behavior-tree work is downsampled.
  lodConfig: Object.freeze({
    enabled: true,
    refreshIntervalMs: 1400,
    nearDistanceTiles: 12,
    mediumDistanceTiles: 48,
    chunkSizeTiles: 32,
    nearStride: 1,
    mediumStride: 3,
    farStride: 12,
  }),
  wildernessDitchObjectId: ObjectIds.WILDERNESS_DITCH,
  logging: Object.freeze({
    logPath: path.join(process.cwd(), "logs", "player-bots.log"),
    runtimeEventLoggingEnabled:
      (process.env.BOT_RUNTIME_EVENT_LOGGING ?? "0") === "1",
    // Mirroring high-frequency bot runtime logs into the core server logger is
    // expensive because server.log uses synchronous disk writes.
    mirrorToServerLogger: (process.env.BOT_MIRROR_CORE_LOGGING ?? "0") === "1",
    mirrorErrorsToServerLogger:
      (process.env.BOT_MIRROR_ERRORS_TO_CORE_LOGGING ?? "1") === "1",
    fileLogWritesEnabled:
      (process.env.BOT_FILE_LOG_WRITES_ENABLED ??
        (GameConstants.SERVER_LOG_WRITES_ENABLED ? "1" : "0")) === "1",
    telemetryEnabled:
      (process.env.BOT_RUNTIME_TELEMETRY_ENABLED ?? "1") === "1",
    telemetryLogPath: path.join(process.cwd(), "logs", "bot-runtime-telemetry.log"),
    telemetryIntervalMs: parseEnvInt(
      "BOT_RUNTIME_TELEMETRY_INTERVAL_MS",
      10000,
      1000
    ),
    recentLogLimit: 24,
  }),
  status: Object.freeze({
    interactionSlot: 1,
    optionLabel: "Status",
    recentLogLines: 8,
    diagnoseLogPath: path.join(process.cwd(), "logs", "diagnose-stuck-bot.log"),
  }),
  modeBehaviorOptions: BOT_MODE_BEHAVIOR_OPTIONS,
  treeOptions: BOT_TREE_OPTIONS,
  pvp: Object.freeze({
    pjOpportunityWindowMs: 6000,
    pjObserveDistanceTiles: 18,
    pjUseChanceByProfile: Object.freeze({
      novice: 0.42,
      standard: 0.66,
      veteran: 0.88,
      elite: 1,
    }),
    pjMaxResponders: 3,
    profileWeights: Object.freeze([
      Object.freeze({ value: "novice", weight: 18 }),
      Object.freeze({ value: "standard", weight: 48 }),
      Object.freeze({ value: "veteran", weight: 24 }),
      Object.freeze({ value: "elite", weight: 10 }),
    ]),
    loadoutWeights: Object.freeze([
      Object.freeze({ value: "edge_main_melee", weight: 28 }),
      Object.freeze({ value: "edge_ranged_melee", weight: 20 }),
      Object.freeze({ value: "low_level_pure", weight: 14 }),
      Object.freeze({ value: "rune_pure_members", weight: 9 }),
      Object.freeze({ value: "void_pure", weight: 8 }),
      Object.freeze({ value: "edge_void_melee", weight: 10 }),
      Object.freeze({ value: "mid_tank", weight: 8 }),
      Object.freeze({ value: "deep_wild_hybrid", weight: 15 }),
      Object.freeze({ value: "low_level_nh", weight: 7 }),
      Object.freeze({ value: "deep_wild_staff_spec", weight: 7 }),
      Object.freeze({ value: "anti_pk_hybrid", weight: 12 }),
      Object.freeze({ value: "budget_pk", weight: 17 }),
      Object.freeze({ value: "initiate_pure", weight: 10 }),
      Object.freeze({ value: "f2p_strength_pure", weight: 8 }),
      Object.freeze({ value: "f2p_rune_pure", weight: 10 }),
      Object.freeze({ value: "f2p_range_ko", weight: 7 }),
      Object.freeze({ value: "f2p_bind_pure", weight: 3 }),
      Object.freeze({ value: "f2p_addy_pure", weight: 7 }),
      Object.freeze({ value: "f2p_mage_pure", weight: 3 }),
      Object.freeze({ value: "f2p_bind_ko", weight: 4 }),
      Object.freeze({ value: "rusher", weight: 8 }),
    ]),
    hotspotWeights: Object.freeze([
      Object.freeze({ value: "edge_ditch", weight: 34 }),
      Object.freeze({ value: "varrock_ditch", weight: 16 }),
      Object.freeze({ value: "revs_entrance", weight: 12 }),
      Object.freeze({ value: "green_drags_gate", weight: 10 }),
    ]),
  }),
});

function registerDuelBotAcceptance(api) {
  const accept = (event) => {
    if (event?.player?.isPlayerBot?.() === true) event.accept = true;
  };
  for (const eventName of ["duelarena:request", "duelarena:rules-changed", "duelarena:accept", "duelarena:accept-clicked"]) {
    api.onCustomEvent(eventName, accept);
  }
  api.onCustomEvent("duelarena:validate-winnings", (event) => {
    if (event?.player?.isPlayerBot?.() === true) event.handled = true;
  });
  api.onCustomEvent("duelarena:settle-winnings", (event) => {
    if (event?.player?.isPlayerBot?.() === true) event.handled = true;
  });
}

module.exports = {
  name: "PlayerBots",
  register(api) {
    registerDuelBotAcceptance(api);
    initPlayerBotStateCoreAccess(api);
    initBotRecruitRuntimeCoreAccess(api);
    const { botApi, recentBotLogsByUsername } = createBotPluginLogging({
      api,
      logPath: BOT_CONFIG.logging.logPath,
      runtimeEventLoggingEnabled: BOT_CONFIG.logging.runtimeEventLoggingEnabled,
      mirrorToServerLogger: BOT_CONFIG.logging.mirrorToServerLogger,
      mirrorErrorsToServerLogger: BOT_CONFIG.logging.mirrorErrorsToServerLogger,
      fileLogWritesEnabled: BOT_CONFIG.logging.fileLogWritesEnabled,
      telemetryEnabled: BOT_CONFIG.logging.telemetryEnabled,
      telemetryLogPath: BOT_CONFIG.logging.telemetryLogPath,
      telemetryIntervalMs: BOT_CONFIG.logging.telemetryIntervalMs,
      recentLogLimit: BOT_CONFIG.logging.recentLogLimit,
    });

    const boot = bootPlayerBotsRuntime({
      api,
      botApi,
      recentBotLogsByUsername,
      config: BOT_CONFIG,
    });
    setActiveBotRuntime(boot.runtime, BOT_CONFIG.behaviorMode);

    registerBotStatusInteractions({
      api,
      botStatusReporter: boot.botStatusReporter,
      statusOptionLabel: BOT_CONFIG.status.optionLabel,
      statusInteractionSlot: BOT_CONFIG.status.interactionSlot,
      runtime: boot.runtime,
      behaviorMode: BOT_CONFIG.behaviorMode,
    });

    registerBotCommands({
      api,
      botApi,
      runtime: boot.runtime,
      behaviorMode: BOT_CONFIG.behaviorMode,
      assignableBehaviors: boot.modeRegistries.assignableBehaviors,
      modeHandlers: boot.modeHandlers,
      resetMovementState,
      taskManager: api.getTaskManager(),
      flashHintArrowTaskFactory: boot.flashHintArrowTaskFactory,
    });

    registerBotEvents({
      api,
      botApi,
      runtime: boot.runtime,
      behaviorMode: BOT_CONFIG.behaviorMode,
      playerPersistence: GameConstants.PLAYER_PERSISTENCE,
      followBackTrigger: boot.followBackTrigger,
      combatReactionTrigger: boot.combatReactionTrigger,
      pathBlockedHandler: boot.pathBlockedHandler,
      npcAggroPolicyHandler: boot.npcAggroPolicyHandler,
      avengeOpponentPolicy: boot.avengeOpponentPolicy,
      pvpJumpOnKillPolicy: boot.pvpJumpOnKillPolicy,
    });

    api.onSpellRuneBypass((event) => {
      const player = event?.player;
      if (player?.isPlayerBot?.() === true) {
        event.bypass = true;
      }
    });

    botApi.log("registered", {
      spawned: boot.runtime.getSpawnedCount(),
      totalConfigured: BOT_CONFIG.botCount,
      wildernessRegionalPool: BOT_CONFIG.wildernessRoamerBotCount,
      wildernessActiveRegionBotsPerRegion: BOT_CONFIG.wildernessActiveRegionBotsPerRegion,
      wildernessRoamerBotCount: BOT_CONFIG.wildernessRoamerBotCount,
      walkRadius: BOT_CONFIG.botWalkRadius,
      decisionTicks: BOT_CONFIG.botDecisionTicks,
      baseCooldownMs: BOT_CONFIG.botBaseCooldownMs,
      jitterMs: BOT_CONFIG.botJitterMs,
      ditchObjectId: BOT_CONFIG.wildernessDitchObjectId,
      roamingDitchCrossMaxDistanceY: BOT_CONFIG.roamingDitchCrossMaxDistanceY,
      roamRadius: BOT_CONFIG.botWalkRadius,
      followBackDurationMs: BOT_CONFIG.followBackDurationMs,
      autoMode: {
        decisionMinMs: BOT_CONFIG.autoModeDecisionMinMs,
        decisionMaxMs: BOT_CONFIG.autoModeDecisionMaxMs,
        modes: boot.modeRegistries.autonomousModes.map((definition) => ({
          mode: definition.mode,
          strategy: definition.strategy,
          weight: definition.weight,
          minMs: definition.minMs,
          maxMs: definition.maxMs,
          hasParams: definition.params != null,
        })),
      },
      homeRadius: BOT_CONFIG.treeOptions.botHomeRadius,
    });
  },
  registerDuelBotAcceptance,
};
