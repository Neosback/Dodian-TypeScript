const { MapObjects } = require("../../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Bank } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { Location } = require("../../../../src/main/typescript/elvarg/game/model/Location");
const { Skill } = require("../../../../src/main/typescript/elvarg/game/model/Skill");
const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { resolveBotNodeContext } = require("../nodes/context/BotNodeContext");
const { setModeBankRun, setModeSmelting } = require("../state/PlayerBotState");
const {
  handlePlayerAttackReaction,
} = require("../policies/PlayerAttackReactionPolicy");
const Smithing = require("../../../skills/Smithing.plugin");

const RETRY_ACTION_MS = 750;
const WALK_COMMAND_COOLDOWN_MS = 900;
const START_ACTION_COOLDOWN_MS = 900;
const POST_WITHDRAW_DELAY_MS = 350;
const BANK_SEARCH_REGION_RADIUS = 2;
const FURNACE_SEARCH_REGION_RADIUS = 2;
const BANK_BOOTH_CACHE_TTL_MS = 1200;
const FURNACE_CACHE_TTL_MS = 1200;
const CACHE_MAX_KEYS = 256;
const ENTRY_MIN_BANK_BARS = 100;

const BANK_BOOTH_IDS = new Set(
  Object.entries(ObjectIds)
    .filter(
      ([name, id]) =>
        typeof name === "string" &&
        name.includes("BANK_BOOTH") &&
        Number.isInteger(id)
    )
    .map(([, id]) => id)
);

const FURNACE_IDS = new Set(
  Array.from(Smithing.FURNACE_OBJECT_IDS ?? []).filter(Number.isInteger)
);

const SMELTING_RECIPES = Array.isArray(Smithing.SMELTING_RECIPES)
  ? Smithing.SMELTING_RECIPES
  : [];

class SmeltingBehavior {
  constructor(botStatesByName, api, options) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.behaviorMode = options.behaviorMode;
    this.objectSearch = options.objectSearch ?? null;
    this.bankBoothSearchCacheByArea = new Map();
    this.furnaceSearchCacheByArea = new Map();
  }

  behaviorRequirementsMet(playerOrPayload) {
    const player = playerOrPayload?.player ?? playerOrPayload;
    return this.findBestBankRecipe(player, ENTRY_MIN_BANK_BARS) != null;
  }
  onNpcAggroAttempt({ event }) {
    if (!event || event.allow !== null) {
      return false;
    }
    event.allow = false;
    return true;
  }

  onNpcCombatDetected({ player, combat, attacker, target }) {
    const attackerIsNpc = attacker?.isNpc?.() === true;
    const targetIsNpc = target?.isNpc?.() === true;
    if (!attackerIsNpc && !targetIsNpc) {
      return false;
    }
    combat?.reset?.();
    player?.setFollowing?.(null);
    player?.setMobileInteraction?.(null);
    player?.setPositionToFace?.(null);
    return true;
  }

  onPlayerAttackReaction(payload) {
    return handlePlayerAttackReaction({
      ...payload,
      behaviorMode: this.behaviorMode,
      api: this.api,
    });
  }

  collectTrackedObjectIds() {
    return [...FURNACE_IDS, ...BANK_BOOTH_IDS];
  }

  appendStatusLines({ lines, state, nowMs, helpers = {} }) {
    if (!Array.isArray(lines) || !state?.smelting) {
      return;
    }
    const formatPoint = helpers?.formatPoint ?? (() => "n/a");
    const msRemainingLabel = helpers?.msRemainingLabel ?? (() => "n/a");
    lines.push(
      `smelting phase=${state.smelting.phase ?? "n/a"} recipeBar=${
        state.smelting.recipeBarId ?? "n/a"
      } furnaceTarget=${formatPoint(
        state.smelting.furnaceTarget
      )} next=${msRemainingLabel(state.smelting.nextActionAt, nowMs)}`
    );
  }

  isModeStateValid({ player, state }) {
    if (!player || !state?.smelting) {
      return false;
    }
    if (Smithing.isSmeltingActive?.(player)) {
      return true;
    }
    if (this.findBestInventoryRecipe(player) != null) {
      return true;
    }
    if (this.findBestBankRecipe(player, 1) != null) {
      return true;
    }
    return this.inventoryContainsAnyBar(player);
  }

  activateMode({ player, state }) {
    if (!player || !state) {
      return false;
    }
    setModeSmelting(player, state, this.behaviorMode);
    if (state.smelting) {
      state.smelting.nextActionAt = 0;
      state.smelting.phase = "prepare_bank";
    }
    return true;
  }

  startMode({ player, state, nowMs, activeForMs, reason = "auto_switch" }) {
    if (!this.activateMode({ player, state })) {
      return false;
    }
    this.api?.log?.("bot_mode_switch", {
      username: player.getUsername?.(),
      mode: this.behaviorMode.SMELTING,
      reason,
      activeForMs: Number.isInteger(activeForMs) ? activeForMs : null,
    });

    if (state.smelting && Number.isInteger(nowMs)) {
      state.smelting.nextActionAt = nowMs;
    }

    this.startBankRun(player, state, "smelting_mode_start");
    return true;
  }

  onBankRunResume({ state, nowMs }) {
    if (!state?.smelting) {
      return false;
    }
    state.smelting.phase = "withdraw";
    state.smelting.nextActionAt = nowMs;
    state.smelting.bankTarget = null;
    state.smelting.travelTarget = null;
    return true;
  }

  getTraversalTarget(state) {
    return state?.smelting?.travelTarget ?? null;
  }

  setTraversalTarget(stateOrPayload, maybeTarget) {
    const state = stateOrPayload?.state ?? stateOrPayload;
    const target = stateOrPayload?.target ?? maybeTarget;
    if (!state?.smelting) {
      return false;
    }
    state.smelting.travelTarget = target;
    return true;
  }

  handleBlocked({
    player,
    state,
    event,
    nowMs,
    traversalService,
    blockedRetargetMinDelayMs,
  }) {
    const smelting = state?.smelting;
    const target = smelting?.travelTarget;
    if (!player || !target) {
      return false;
    }

    const traversalObject = traversalService.findObjectOnRoute(
      player,
      event.from,
      target
    );
    if (!traversalObject) {
      smelting.nextActionAt = nowMs + blockedRetargetMinDelayMs;
      return true;
    }

    const currentY = player.getLocation().getY();
    const objectY = traversalObject.getLocation().getY();
    if (!traversalService.isObjectBetween(currentY, target.y, objectY)) {
      smelting.nextActionAt = nowMs + blockedRetargetMinDelayMs;
      return true;
    }

    traversalService.requestCross(player, state, traversalObject, nowMs);
    return true;
  }

  tick(context) {
    const resolved = resolveBotNodeContext(context, this.botStatesByName, {
      requiredMode: this.behaviorMode.SMELTING,
      requireNotBusy: false,
    });
    if (!resolved) {
      return "failure";
    }

    const { player, state, nowMs } = resolved;
    const smelting = state.smelting;
    if (!smelting) {
      return "failure";
    }
    this.ensureState(smelting);

    if (Smithing.isSmeltingActive?.(player)) {
      return "running";
    }
    if (nowMs < (smelting.nextActionAt ?? 0)) {
      return "running";
    }

    const inventoryRecipe = this.findBestInventoryRecipe(player);
    if (inventoryRecipe) {
      smelting.recipeBarId = inventoryRecipe.barId;
      return this.processSmeltingAtFurnace(player, state, nowMs, inventoryRecipe);
    }

    if (this.inventoryContainsAnyBar(player)) {
      this.startBankRun(player, state, "smelting_deposit_bars");
      return "running";
    }

    return this.acquireOresFromBank(player, state, nowMs);
  }

  ensureState(smelting) {
    if (!smelting) {
      return;
    }
    if (!smelting.phase) {
      smelting.phase = "withdraw";
    }
    if (!Number.isInteger(smelting.nextActionAt)) {
      smelting.nextActionAt = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(smelting, "recipeBarId")) {
      smelting.recipeBarId = null;
    }
    if (!Object.prototype.hasOwnProperty.call(smelting, "bankTarget")) {
      smelting.bankTarget = null;
    }
    if (!Object.prototype.hasOwnProperty.call(smelting, "furnaceTarget")) {
      smelting.furnaceTarget = null;
    }
    if (!Object.prototype.hasOwnProperty.call(smelting, "travelTarget")) {
      smelting.travelTarget = null;
    }
  }

  getSmithingLevel(player) {
    return player?.getSkillManager?.()?.getCurrentLevel(Skill.SMITHING) ?? 1;
  }

  getBankItemAmount(player, itemId) {
    if (!player || !Number.isInteger(itemId)) {
      return 0;
    }
    let total = 0;
    for (let tab = 0; tab < Bank.BANK_SEARCH_TAB_INDEX; tab++) {
      total += player.getBank(tab)?.getAmount?.(itemId) ?? 0;
    }
    return total;
  }

  maxBarsFromBankForRecipe(player, recipe) {
    if (!player || !recipe?.ingredients?.length) {
      return 0;
    }
    let bars = Number.MAX_SAFE_INTEGER;
    for (const [itemId, amount] of recipe.ingredients) {
      if (!Number.isInteger(itemId) || !Number.isInteger(amount) || amount <= 0) {
        return 0;
      }
      const bankAmount = this.getBankItemAmount(player, itemId);
      bars = Math.min(bars, Math.floor(bankAmount / amount));
    }
    return Number.isFinite(bars) ? Math.max(0, bars) : 0;
  }

  maxBarsFromInventoryForRecipe(inventory, recipe) {
    if (!inventory || !recipe?.ingredients?.length) {
      return 0;
    }
    let bars = Number.MAX_SAFE_INTEGER;
    for (const [itemId, amount] of recipe.ingredients) {
      if (!Number.isInteger(itemId) || !Number.isInteger(amount) || amount <= 0) {
        return 0;
      }
      const invAmount = inventory.getAmount(itemId);
      bars = Math.min(bars, Math.floor(invAmount / amount));
    }
    return Number.isFinite(bars) ? Math.max(0, bars) : 0;
  }

  findBestBankRecipe(player, minBars = 1) {
    if (!player || SMELTING_RECIPES.length === 0) {
      return null;
    }
    const smithingLevel = this.getSmithingLevel(player);
    let selected = null;
    let selectedBars = 0;

    for (const recipe of SMELTING_RECIPES) {
      if (!recipe || smithingLevel < recipe.level) {
        continue;
      }
      const bars = this.maxBarsFromBankForRecipe(player, recipe);
      if (bars < minBars) {
        continue;
      }
      if (
        !selected ||
        recipe.level > selected.level ||
        (recipe.level === selected.level && bars > selectedBars)
      ) {
        selected = recipe;
        selectedBars = bars;
      }
    }

    return selected;
  }

  findBestInventoryRecipe(player) {
    const inventory = player?.getInventory?.();
    if (!inventory) {
      return null;
    }
    const smithingLevel = this.getSmithingLevel(player);
    let selected = null;
    let selectedBars = 0;

    for (const recipe of SMELTING_RECIPES) {
      if (!recipe || smithingLevel < recipe.level) {
        continue;
      }
      const bars = this.maxBarsFromInventoryForRecipe(inventory, recipe);
      if (bars <= 0) {
        continue;
      }
      if (
        !selected ||
        recipe.level > selected.level ||
        (recipe.level === selected.level && bars > selectedBars)
      ) {
        selected = recipe;
        selectedBars = bars;
      }
    }

    return selected;
  }

  inventoryContainsAnyBar(player) {
    const inventory = player?.getInventory?.();
    if (!inventory) {
      return false;
    }
    for (const recipe of SMELTING_RECIPES) {
      if (inventory.getAmount(recipe.barId) > 0) {
        return true;
      }
    }
    return false;
  }

  acquireOresFromBank(player, state, nowMs) {
    const smelting = state.smelting;
    smelting.phase = "withdraw";

    let recipe = this.findBestBankRecipe(player, 1);
    if (!recipe) {
      smelting.nextActionAt = nowMs + RETRY_ACTION_MS;
      return "running";
    }
    smelting.recipeBarId = recipe.barId;

    let bankBooth = this.resolveTargetBankBooth(player, smelting.bankTarget);
    if (!bankBooth) {
      bankBooth = this.findNearestBankBooth(player);
      if (!bankBooth) {
        smelting.bankTarget = null;
        smelting.travelTarget = null;
        smelting.nextActionAt = nowMs + RETRY_ACTION_MS;
        return "running";
      }
      smelting.bankTarget = {
        objectId: bankBooth.getId(),
        x: bankBooth.getLocation().getX(),
        y: bankBooth.getLocation().getY(),
        z: bankBooth.getLocation().getZ(),
      };
    }

    smelting.travelTarget = {
      x: bankBooth.getLocation().getX(),
      y: bankBooth.getLocation().getY(),
      z: bankBooth.getLocation().getZ(),
    };

    if (player.getForceMovement?.() != null) {
      smelting.nextActionAt = nowMs + RETRY_ACTION_MS;
      return "running";
    }
    if (player.getMovementQueue?.()?.size?.() > 0) {
      return "running";
    }

    player.getMovementQueue().walkToObject(bankBooth, {
      execute: () => {
        if (state.mode !== this.behaviorMode.SMELTING || !state.smelting) {
          return;
        }
        const smeltingState = state.smelting;
        const boothLoc = bankBooth.getLocation();
        player.setPositionToFace(boothLoc);
        this.api.emitObjectInteraction({
          player,
          object: bankBooth,
          objectId: bankBooth.getId(),
          clickType: 1,
          location: {
            x: boothLoc.getX(),
            y: boothLoc.getY(),
            z: boothLoc.getZ(),
          },
          sourceLocation: {
            x: player.getLocation().getX(),
            y: player.getLocation().getY(),
            z: player.getLocation().getZ(),
          },
          handled: false,
        });

        recipe = this.findBestBankRecipe(player, 1);
        if (!recipe) {
          smeltingState.nextActionAt = Date.now() + RETRY_ACTION_MS;
          return;
        }

        const withdrew = this.withdrawOresForRecipe(player, recipe);
        this.api?.log?.("smelting_bank_withdraw", {
          username: player.getUsername?.(),
          barId: recipe.barId,
          barsWithdrawn: withdrew.bars,
        });
        if (withdrew.bars <= 0) {
          smeltingState.nextActionAt = Date.now() + RETRY_ACTION_MS;
          return;
        }

        smeltingState.recipeBarId = recipe.barId;
        smeltingState.furnaceTarget = null;
        smeltingState.travelTarget = null;
        smeltingState.phase = "to_furnace";
        smeltingState.nextActionAt = Date.now() + POST_WITHDRAW_DELAY_MS;
      },
    });

    smelting.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
    return "running";
  }

  withdrawOresForRecipe(player, recipe) {
    const inventory = player?.getInventory?.();
    if (!inventory || !recipe?.ingredients?.length) {
      return { bars: 0 };
    }
    const freeSlots = inventory.getFreeSlots?.() ?? 0;
    if (freeSlots <= 0) {
      return { bars: 0 };
    }

    const oresPerBar = recipe.ingredients.reduce(
      (sum, [, amount]) => sum + amount,
      0
    );
    if (!Number.isInteger(oresPerBar) || oresPerBar <= 0) {
      return { bars: 0 };
    }

    const bankBars = this.maxBarsFromBankForRecipe(player, recipe);
    const slotBars = Math.floor(freeSlots / oresPerBar);
    const barsToWithdraw = Math.max(0, Math.min(bankBars, slotBars));
    if (barsToWithdraw <= 0) {
      return { bars: 0 };
    }

    const touchedTabs = new Set();
    for (const [itemId, amountPerBar] of recipe.ingredients) {
      let remaining = barsToWithdraw * amountPerBar;
      for (let tab = 0; tab < Bank.BANK_SEARCH_TAB_INDEX && remaining > 0; tab++) {
        const bank = player.getBank(tab);
        const available = bank?.getAmount?.(itemId) ?? 0;
        if (available <= 0) {
          continue;
        }
        const take = Math.min(available, remaining);
        if (take <= 0) {
          continue;
        }
        bank.deleteNumber(itemId, take);
        inventory.adds(itemId, take);
        touchedTabs.add(tab);
        remaining -= take;
      }
    }

    inventory.refreshItems?.();
    for (const tab of touchedTabs) {
      player.getBank(tab)?.refreshItems?.();
    }
    return { bars: barsToWithdraw };
  }

  processSmeltingAtFurnace(player, state, nowMs, recipe) {
    const smelting = state.smelting;
    smelting.phase = "to_furnace";

    let furnace = this.resolveTargetFurnace(player, smelting.furnaceTarget);
    if (!furnace) {
      furnace = this.findNearestFurnace(player);
      if (!furnace) {
        smelting.furnaceTarget = null;
        smelting.travelTarget = null;
        smelting.nextActionAt = nowMs + RETRY_ACTION_MS;
        return "running";
      }
      smelting.furnaceTarget = {
        objectId: furnace.getId(),
        x: furnace.getLocation().getX(),
        y: furnace.getLocation().getY(),
        z: furnace.getLocation().getZ(),
      };
    }

    smelting.travelTarget = {
      x: furnace.getLocation().getX(),
      y: furnace.getLocation().getY(),
      z: furnace.getLocation().getZ(),
    };

    if (player.getForceMovement?.() != null) {
      smelting.nextActionAt = nowMs + RETRY_ACTION_MS;
      return "running";
    }
    if (player.getMovementQueue?.()?.size?.() > 0) {
      return "running";
    }

    player.getMovementQueue().walkToObject(furnace, {
      execute: () => {
        if (state.mode !== this.behaviorMode.SMELTING || !state.smelting) {
          return;
        }
        const smeltingState = state.smelting;
        const furnaceLoc = furnace.getLocation();
        player.setPositionToFace(furnaceLoc);
        this.api.emitObjectInteraction({
          player,
          object: furnace,
          objectId: furnace.getId(),
          clickType: 1,
          location: {
            x: furnaceLoc.getX(),
            y: furnaceLoc.getY(),
            z: furnaceLoc.getZ(),
          },
          sourceLocation: {
            x: player.getLocation().getX(),
            y: player.getLocation().getY(),
            z: player.getLocation().getZ(),
          },
          handled: false,
        });

        const inventory = player.getInventory?.();
        const barsFromInventory = this.maxBarsFromInventoryForRecipe(inventory, recipe);
        if (barsFromInventory <= 0) {
          smeltingState.nextActionAt = Date.now() + RETRY_ACTION_MS;
          return;
        }

        const started =
          Smithing.startBotSmelting?.(player, recipe, barsFromInventory) === true;
        this.api?.log?.("smelting_start", {
          username: player.getUsername?.(),
          barId: recipe.barId,
          amount: barsFromInventory,
          started,
        });
        smeltingState.phase = "smelting";
        smeltingState.travelTarget = null;
        smeltingState.nextActionAt =
          Date.now() + (started ? START_ACTION_COOLDOWN_MS : RETRY_ACTION_MS);
      },
    });

    smelting.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
    return "running";
  }

  startBankRun(player, state, reason) {
    if (!player || !state) {
      return false;
    }
    let bankBooth = this.findNearestBankBooth(player);
    if (!bankBooth) {
      bankBooth = this.findNearestBankBooth(player);
    }
    const returnTo = bankBooth
      ? {
          x: bankBooth.getLocation().getX(),
          y: bankBooth.getLocation().getY(),
          z: bankBooth.getLocation().getZ(),
        }
      : {
          x: player.getLocation().getX(),
          y: player.getLocation().getY(),
          z: player.getLocation().getZ(),
        };
    const switched = setModeBankRun(player, state, this.behaviorMode, {
      returnMode: this.behaviorMode.SMELTING,
      returnTo,
    });
    if (switched) {
      this.api?.log?.("bot_mode_switch", {
        username: player.getUsername?.(),
        mode: this.behaviorMode.BANK_RUN,
        reason,
      });
    }
    return switched;
  }

  resolveTargetBankBooth(player, target) {
    if (!player || !target) {
      return null;
    }
    const loc = new Location(target.x, target.y, target.z);
    const object = MapObjects.get(target.objectId, loc, player.getPrivateArea());
    if (!object || !BANK_BOOTH_IDS.has(object.getId())) {
      return null;
    }
    return object;
  }

  resolveTargetFurnace(player, target) {
    if (!player || !target) {
      return null;
    }
    const loc = new Location(target.x, target.y, target.z);
    const object = MapObjects.get(target.objectId, loc, player.getPrivateArea());
    if (!object || !FURNACE_IDS.has(object.getId())) {
      return null;
    }
    return object;
  }

  findNearestBankBooth(player) {
    const loc = player?.getLocation?.();
    if (!loc) {
      return null;
    }
    const booths = this.getCachedByIds(
      this.bankBoothSearchCacheByArea,
      player,
      [...BANK_BOOTH_IDS],
      BANK_SEARCH_REGION_RADIUS,
      BANK_BOOTH_CACHE_TTL_MS
    );
    return this.findNearestObjectByDistance(loc, booths);
  }

  findNearestFurnace(player) {
    const loc = player?.getLocation?.();
    if (!loc) {
      return null;
    }
    const furnaces = this.getCachedByIds(
      this.furnaceSearchCacheByArea,
      player,
      [...FURNACE_IDS],
      FURNACE_SEARCH_REGION_RADIUS,
      FURNACE_CACHE_TTL_MS
    );
    return this.findNearestObjectByDistance(loc, furnaces);
  }

  getCachedByIds(
    areaCacheMap,
    player,
    objectIds,
    regionRadius,
    cacheTtlMs,
    nowMs = Date.now()
  ) {
    const loc = player?.getLocation?.();
    if (!loc || !Array.isArray(objectIds) || objectIds.length === 0) {
      return [];
    }
    const privateArea = player.getPrivateArea?.() ?? null;
    const areaKey = privateArea == null ? "__global__" : String(privateArea);
    let areaCache = areaCacheMap.get(areaKey);
    if (!areaCache) {
      areaCache = new Map();
      areaCacheMap.set(areaKey, areaCache);
    }

    const cacheKey = `${loc.getX() >> 6}:${loc.getY() >> 6}:${loc.getZ()}`;
    const cached = areaCache.get(cacheKey);
    if (cached && cached.expiresAt > nowMs) {
      return cached.objects;
    }

    const objects =
      this.objectSearch?.findCandidatesByIds?.(player, objectIds, {
        regionRadius,
        z: loc.getZ(),
        privateArea,
      }) ?? [];

    if (areaCache.size >= CACHE_MAX_KEYS) {
      areaCache.clear();
    }
    areaCache.set(cacheKey, {
      expiresAt: nowMs + cacheTtlMs,
      objects,
    });
    return objects;
  }

  findNearestObjectByDistance(baseLoc, objects) {
    if (!baseLoc || !Array.isArray(objects) || objects.length === 0) {
      return null;
    }
    let nearest = null;
    let bestDistSq = Number.MAX_SAFE_INTEGER;

    for (const object of objects) {
      const objectLoc = object?.getLocation?.();
      if (!objectLoc || objectLoc.getZ() !== baseLoc.getZ()) {
        continue;
      }
      const dx = objectLoc.getX() - baseLoc.getX();
      const dy = objectLoc.getY() - baseLoc.getY();
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        nearest = object;
      }
    }

    return nearest;
  }
}

const SMELTING_MODE_DESCRIPTOR = Object.freeze({
  key: "smelting",
  assignable: true,
  modeProperty: "SMELTING",
  autonomous: Object.freeze({
    strategy: "start",
    weight: 0.15,
    minMs: 30000,
    maxMs: 105000,
    priority: 50,
  }),
  requiredHooks: [
    "behaviorRequirementsMet",
    "isModeStateValid",
    "activateMode",
    "startMode",
    "onBankRunResume",
    "handleBlocked",
    "getTraversalTarget",
    "setTraversalTarget",
  ],
  create({ botStatesByName, api, behaviorMode, objectSearch }) {
    return new SmeltingBehavior(botStatesByName, api, {
      behaviorMode,
      objectSearch,
    });
  },
});

module.exports = {
  SmeltingBehavior,
  SMELTING_MODE_DESCRIPTOR,
};
