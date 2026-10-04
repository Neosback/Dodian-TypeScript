const { Area } = require("../../src/main/typescript/elvarg/game/model/areas/Area");
const { Boundary } = require("../../src/main/typescript/elvarg/game/model/Boundary");
const { PolygonalBoundary } = require("../../src/main/typescript/elvarg/game/model/PolygonalBoundary");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Flag } = require("../../src/main/typescript/elvarg/game/model/Flag");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { WeaponInterfaceManager } = require("../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaceManager");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { NPC } = require("../../src/main/typescript/elvarg/game/entity/impl/npc/NPC");
const { CountdownTask } = require("../../src/main/typescript/elvarg/game/task/impl/CountdownTask");
const { TimerKey } = require("../../src/main/typescript/elvarg/util/timers/TimerKey");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");
const { ObjectIdentifiers } = require("../../src/main/typescript/elvarg/util/ObjectIdentifiers");
const FoodPlugin = require("../items/Food.plugin");
const { createBotPlayer } = require("../bots/behaviours/spawn/BotPlayerFactory");
const { ATTR_SKIP_PERSISTENCE } = require("../bots/runtime/BotPersistenceConstants");

const loc = (x, y, z) => new Location(x, y, z);
const box = (...args) => new Boundary(...args);
const START_TASK_KEY = "cw.start";
const END_TASK_KEY = "cw.end";
const TRANSITION_TO_GAME_KEY = {};
const CASTLE_WARS_BOT_KEY = {};
const TAKE_SUPPLY_ANIM = new Animation(881);
const LOBBY_TELEPORT = loc(2440, 3089, 0);
const BARRICADE_ITEM_ID = ItemIdentifiers.BARRICADE;
const RAW_OBJECT_1747 = 1747;
const TEAM = { SARADOMIN: "saradomin", ZAMORAK: "zamorak" };
const TEAM_DATA = {
  [TEAM.SARADOMIN]: { id: TEAM.SARADOMIN, name: "Saradomin", capeId: ItemIdentifiers.SARADOMIN_CLOAK_3, hoodId: ItemIdentifiers.CASTLEWARS_HOOD, bannerId: ItemIdentifiers.SARADOMIN_BANNER, waitingRoom: loc(2381, 9489, 0), startRoom: loc(2426, 3076, 1), respawnBounds: box(2423, 2431, 3072, 3080, 1), standLocation: loc(2429, 3074, 3), safeStandId: ObjectIdentifiers.SARADOMIN_STANDARD_2, emptyStandId: ObjectIdentifiers.STANDARD_STAND, droppedFlagObjectId: ObjectIdentifiers.SARADOMIN_STANDARD, waitingBounds: [box(2368, 2392, 9481, 9497, 0)] },
  [TEAM.ZAMORAK]: { id: TEAM.ZAMORAK, name: "Zamorak", capeId: ItemIdentifiers.ZAMORAK_CLOAK_3, hoodId: ItemIdentifiers.CASTLEWARS_HOOD_2, bannerId: ItemIdentifiers.ZAMORAK_BANNER, waitingRoom: loc(2421, 9524, 0), startRoom: loc(2372, 3131, 1), respawnBounds: box(2368, 2376, 3127, 3135, 1), standLocation: loc(2370, 3133, 3), safeStandId: ObjectIdentifiers.ZAMORAK_STANDARD_2, emptyStandId: ObjectIdentifiers.STANDARD_STAND_2, droppedFlagObjectId: ObjectIdentifiers.ZAMORAK_STANDARD, waitingBounds: [box(2408, 2432, 9512, 9535, 0)] },
};
// OSRS interfaces (cache 237). The old 317 ids (11146/11479/...) don't exist in this cache.
const OVERLAY_HUD_UID = (161 << 16) | 8; // component.toplevel_osrs_stretch:overlay_hud
const WAITING_ROOM_INTERFACE = 131; // interface.castlewars_waitingroom
const STATUS_OVERLAY_INTERFACE = { [TEAM.SARADOMIN]: 58, [TEAM.ZAMORAK]: 59 }; // interface.castlewars_status_overlay_*
const EJECT_TEXT_UID = { [TEAM.SARADOMIN]: (58 << 16) | 26, [TEAM.ZAMORAK]: (59 << 16) | 25 };
// Scores, flag states and the timer are drawn by the cache's own scripts (887/888/2375),
// so the server only feeds the vars they read.
const TIMER_VARP = 380; // seconds until start in the waiting room, minutes remaining in game
const FLAG_VARBIT = { [TEAM.SARADOMIN]: 143, [TEAM.ZAMORAK]: 153 };
const SCORE_VARBIT = { [TEAM.SARADOMIN]: 145, [TEAM.ZAMORAK]: 155 };
const LOBBY_BOUNDS = [box(2435, 2446, 3081, 3098, 0)];
const GAME_BOUNDS = [box(2365, 2404, 9500, 9530, 0), box(2394, 2431, 9474, 9499, 0), box(2405, 2424, 9500, 9509, 0), new PolygonalBoundary([[2377, 3079], [2368, 3079], [2368, 3136], [2416, 3136], [2432, 3120], [2432, 3080], [2432, 3072], [2384, 3072]])];
const CLEANUP_ITEM_IDS = new Set([ItemIdentifiers.BANDAGES, ItemIdentifiers.BRONZE_PICKAXE, ItemIdentifiers.EXPLOSIVE_POTION, BARRICADE_ITEM_ID, ItemIdentifiers.SARADOMIN_CLOAK_3, ItemIdentifiers.ZAMORAK_CLOAK_3, ItemIdentifiers.CASTLEWARS_HOOD, ItemIdentifiers.CASTLEWARS_HOOD_2, ItemIdentifiers.SARADOMIN_BANNER, ItemIdentifiers.ZAMORAK_BANNER, ItemIdentifiers.ROCK_5, ItemIdentifiers.TINDERBOX, ItemIdentifiers.ROPE, ItemIdentifiers.TOOLKIT_2]);
const DEATH_REMOVE_ITEM_IDS = new Set([ItemIdentifiers.BANDAGES, ItemIdentifiers.BRONZE_PICKAXE, ItemIdentifiers.EXPLOSIVE_POTION, BARRICADE_ITEM_ID, ItemIdentifiers.ROCK_5, ItemIdentifiers.TINDERBOX, ItemIdentifiers.ROPE, ItemIdentifiers.TOOLKIT_2, ItemIdentifiers.SARADOMIN_BANNER, ItemIdentifiers.ZAMORAK_BANNER]);
const FOOD_ITEM_IDS = Array.isArray(FoodPlugin.FOOD_ITEM_IDS) ? FoodPlugin.FOOD_ITEM_IDS : [];
const TEAM_COLOUR_MESSAGE = "You can't remove your team's colours.";
const ENEMY_SPAWN_MESSAGE = "You are not allowed in the other team's spawn point.";
const TEAM_COLOUR_SLOTS = new Set([Equipment.CAPE_SLOT, Equipment.HEAD_SLOT]);
const LOBBY_TEAMS = { [ObjectIdentifiers.ZAMORAK_PORTAL]: TEAM.ZAMORAK, [ObjectIdentifiers.SARADOMIN_PORTAL]: TEAM.SARADOMIN, [ObjectIdentifiers.GUTHIX_PORTAL]: false };
const WAITING_EXIT_IDS = new Set([ObjectIdentifiers.PORTAL_8, ObjectIdentifiers.PORTAL_9]);
const GAME_EXIT_IDS = new Set([ObjectIdentifiers.PORTAL_10, ObjectIdentifiers.PORTAL_11]);
const STAND_TEAMS = { [ObjectIdentifiers.SARADOMIN_STANDARD_2]: TEAM.SARADOMIN, [ObjectIdentifiers.STANDARD_STAND]: TEAM.SARADOMIN, [ObjectIdentifiers.ZAMORAK_STANDARD_2]: TEAM.ZAMORAK, [ObjectIdentifiers.STANDARD_STAND_2]: TEAM.ZAMORAK };
const TRAPDOOR_ROUTES = { [ObjectIdentifiers.TRAPDOOR_16]: { blockedTeam: TEAM.ZAMORAK, to: [2429, 3075, 1] }, [ObjectIdentifiers.TRAPDOOR_17]: { blockedTeam: TEAM.SARADOMIN, to: [2370, 3132, 1] } };
const ENERGY_BARRIERS = {
  [ObjectIdentifiers.ENERGY_BARRIER]: { team: TEAM.SARADOMIN, crossings: [[[2426, 3080, 1], [2426, 3080, 1], [2426, 3081, 1]], [[2426, 3080, 1], [2426, 3081, 1], [2426, 3080, 1]], [[2423, 3076, 1], [2422, 3076, 1], [2423, 3076, 1]], [[2423, 3076, 1], [2423, 3076, 1], [2422, 3076, 1]]] },
  [ObjectIdentifiers.ENERGY_BARRIER_2]: { team: TEAM.ZAMORAK, crossings: [[[2373, 3127, 1], [2373, 3126, 1], [2373, 3127, 1]], [[2373, 3127, 1], [2373, 3127, 1], [2373, 3126, 1]], [[2376, 3131, 1], [2376, 3131, 1], [2377, 3131, 1]], [[2376, 3131, 1], [2377, 3131, 1], [2376, 3131, 1]]] },
};
const TELEPORT_ROUTES = {
  [ObjectIdentifiers.STAIRCASE_15]: [[[2428, 3081, 1], [2430, 3080, 2]], [[2425, 3074, 2], [2426, 3074, 3]], [[2419, 3078, 0], [2420, 3080, 1]]],
  [ObjectIdentifiers.STAIRCASE_13]: [[[2419, 3080, 1], [2419, 3077, 0]], [[2430, 3081, 2], [2427, 3081, 1]], [[2425, 3074, 3], [2425, 3077, 2]], [[2374, 3133, 3], [2374, 3130, 2]], [[2369, 3126, 2], [2372, 3126, 1]], [[2380, 3127, 1], [2380, 3130, 0]]],
  [ObjectIdentifiers.LADDER_46]: [[[2421, 3073, 1], [2421, 3074, 0]], [[2378, 3134, 1], [2378, 3133, 0]]],
  [RAW_OBJECT_1747]: [[[2421, 3073, 0], [2421, 3074, 1]], [[2378, 3134, 0], [2378, 3133, 1]]],
  [ObjectIdentifiers.LADDER_47]: [[[2430, 3082, 0], [2430, 9482, 0]], [[2369, 3125, 0], [2369, 9525, 0]]],
  [ObjectIdentifiers.LADDER_218]: [[[2369, 9525, 0], [2369, 3126, 0]], [[2430, 9482, 0], [2430, 3081, 0]], [[2400, 9508, 0], [2400, 3107, 0]], [[2399, 9499, 0], [2399, 3100, 0]]],
  [ObjectIdentifiers.HOLLOW_TREE_3]: [[[2430, 9482, 0], [2430, 3081, 0]], [[2369, 9525, 0], [2369, 3126, 0]]],
  [ObjectIdentifiers.STAIRCASE_16]: [[[2380, 3127, 0], [2379, 3127, 1]], [[2369, 3126, 1], [2369, 3127, 2]], [[2374, 3131, 2], [2373, 3133, 3]]],
};
const FIXED_MOVES = { [ObjectIdentifiers.LADDER_64]: [2370, 3132, 2], [ObjectIdentifiers.LADDER_63]: [2429, 3075, 2] };
const SUPPLY_TABLES = { [ObjectIdentifiers.TABLE_450]: [ItemIdentifiers.BANDAGES, "You get some bandages."], [ObjectIdentifiers.TABLE_451]: [ItemIdentifiers.BANDAGES, "You get some bandages."], [ObjectIdentifiers.TABLE_44]: [BARRICADE_ITEM_ID, "You get a barricade."], [ObjectIdentifiers.TABLE_46]: [ItemIdentifiers.EXPLOSIVE_POTION, "You get an explosive potion."], [ObjectIdentifiers.TABLE_47]: [ItemIdentifiers.BRONZE_PICKAXE, "You get a bronze pickaxe for mining."], [ObjectIdentifiers.TABLE_42]: [ItemIdentifiers.TINDERBOX, "You get a tinderbox."], [ObjectIdentifiers.TABLE_45]: [ItemIdentifiers.ROPE, "You get some rope."], [ObjectIdentifiers.TABLE_43]: [ItemIdentifiers.ROCK_5, "You get a rock."] };
const DROPPED_FLAG_TEAMS = { [ObjectIdentifiers.SARADOMIN_STANDARD]: TEAM.SARADOMIN, [ObjectIdentifiers.ZAMORAK_STANDARD]: TEAM.ZAMORAK };
const ALTAR_SPAWNS = [[411, [2431, 3076, 1], 1], [411, [2373, 3135, 1], 0]];

function createCastleWars(api) {
  const teamByPlayer = new WeakMap();
  const sentVars = new WeakMap();

  function setVar(player, id, value, varbit) {
    let cache = sentVars.get(player);
    if (!cache) {
      sentVars.set(player, (cache = new Map()));
    }
    const key = `${varbit ? "b" : "p"}${id}`;
    if (cache.get(key) === value) {
      return;
    }
    cache.set(key, value);
    const sender = player.getPacketSender();
    if (varbit) {
      sender.sendVarbit(id, value);
    } else {
      sender.sendConfig(id, value);
    }
  }

  function closeOverlay(player) {
    sentVars.delete(player);
    player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
  }
  const flagStatus = {
    [TEAM.SARADOMIN]: 0,
    [TEAM.ZAMORAK]: 0,
  };
  const score = {
    [TEAM.SARADOMIN]: 0,
    [TEAM.ZAMORAK]: 0,
  };
  const droppedFlagObjects = {
    [TEAM.SARADOMIN]: null,
    [TEAM.ZAMORAK]: null,
  };
  const barricades = new Set();

  let phase = "idle";
  let startTask = null;
  let endTask = null;
  let botSerial = 0;

  function secondsToTicks(seconds) {
    return Math.max(1, Math.ceil(Misc.getTicks(seconds)));
  }

  function formatTicks(ticks) {
    const totalSeconds = Math.max(0, Math.floor((ticks | 0) * 0.6));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  function getLocationTile(target) {
    const location = target?.getLocation?.() ?? target;
    if (!location) {
      return null;
    }
    return {
      x: location.getX?.() ?? location.x,
      y: location.getY?.() ?? location.y,
      z: location.getZ?.() ?? location.z,
    };
  }

  function isAt(target, x, y, z) {
    const tile = getLocationTile(target);
    return tile != null && tile.x === x && tile.y === y && tile.z === z;
  }

  function getTeamId(player) {
    return teamByPlayer.get(player) ?? null;
  }

  function setTeamId(player, teamId) {
    if (!player) {
      return;
    }
    if (teamId == null) {
      teamByPlayer.delete(player);
      return;
    }
    teamByPlayer.set(player, teamId);
  }

  function getTeamData(teamId) {
    return teamId ? TEAM_DATA[teamId] ?? null : null;
  }

  function getCarriedFlagTeam(player) {
    const carriedId = player?.getEquipment?.()?.getSlot?.(Equipment.WEAPON_SLOT) ?? -1;
    if (carriedId === ItemIdentifiers.SARADOMIN_BANNER) {
      return TEAM.SARADOMIN;
    }
    if (carriedId === ItemIdentifiers.ZAMORAK_BANNER) {
      return TEAM.ZAMORAK;
    }
    return null;
  }

  function getTeamMembersInGame(teamId) {
    return gameArea.getPlayers().filter((player) => getTeamId(player) === teamId);
  }

  function moveTo(player, to) {
    player.moveTo(new Location(to[0], to[1], to[2]));
  }

  function refreshPlayerAppearance(player, weaponChanged = false) {
    if (weaponChanged) {
      WeaponInterfaceManager.assign(player);
      player.setSpecialActivated(false);
      player.getPacketSender().sendSpecialAttackState(false);
    }
    BonusManager.update(player);
    player.getEquipment().refreshItems();
    player.getInventory().refreshItems();
    player.getUpdateFlag().flag(Flag.APPEARANCE);
  }

  function equipTeamColours(player, team) {
    player.getEquipment().setItem(Equipment.CAPE_SLOT, new Item(team.capeId, 1));
    player.getEquipment().setItem(Equipment.HEAD_SLOT, new Item(team.hoodId, 1));
    refreshPlayerAppearance(player);
  }

  function clearWeaponSlot(player) {
    if (player.getEquipment().getSlot(Equipment.WEAPON_SLOT) === -1) {
      return;
    }
    player.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(-1, 0));
    refreshPlayerAppearance(player, true);
  }

  function clearCastleWarsItems(player, ids = CLEANUP_ITEM_IDS) {
    let weaponChanged = false;

    for (const slot of [Equipment.HEAD_SLOT, Equipment.CAPE_SLOT, Equipment.WEAPON_SLOT]) {
      const itemId = player.getEquipment().getSlot(slot);
      if (!ids.has(itemId)) {
        continue;
      }
      if (slot === Equipment.WEAPON_SLOT) {
        weaponChanged = true;
      }
      player.getEquipment().setItem(slot, new Item(-1, 0));
    }

    for (const itemId of ids) {
      const amount = player.getInventory().getAmount(itemId);
      if (amount > 0) {
        player.getInventory().delete(itemId, amount);
      }
    }

    refreshPlayerAppearance(player, weaponChanged);
  }

  function sendGameHintRemoval(location = null) {
    for (const player of gameArea.getPlayers()) {
      player.getPacketSender().sendEntityHintRemoval(true);
      if (location) {
        player.getPacketSender().sendPositionalHint(location, -1);
      }
    }
  }

  function showCarrierHint(carrier, flagTeam) {
    sendGameHintRemoval();
    for (const player of gameArea.getPlayers()) {
      if (getTeamId(player) !== flagTeam) {
        continue;
      }
      player.getPacketSender().sendEntityHint(carrier);
    }
    carrier.getUpdateFlag().flag(Flag.APPEARANCE);
  }

  function showDroppedFlagHint(location) {
    sendGameHintRemoval();
    for (const player of gameArea.getPlayers()) {
      player.getPacketSender().sendPositionalHint(location, 2);
    }
  }

  function removeDroppedFlagObject(flagTeam) {
    const dropped = droppedFlagObjects[flagTeam];
    if (!dropped) {
      return;
    }
    ObjectManager.deregister(dropped, true);
    sendGameHintRemoval(dropped.getLocation());
    droppedFlagObjects[flagTeam] = null;
  }

  function updateFlagStand(flagTeam, objectId) {
    const team = getTeamData(flagTeam);
    ObjectManager.register(
      new GameObject(objectId, team.standLocation, 10, 2, null),
      true
    );
  }

  function restoreFlagToBase(flagTeam) {
    removeDroppedFlagObject(flagTeam);
    flagStatus[flagTeam] = 0;
    updateFlagStand(flagTeam, getTeamData(flagTeam).safeStandId);
    sendGameHintRemoval();
  }

  function queueCounts() {
    return {
      [TEAM.SARADOMIN]: saradominWaitingArea.getPlayers().length,
      [TEAM.ZAMORAK]: zamorakWaitingArea.getPlayers().length,
    };
  }

  function cancelStartCountdown() {
    if (startTask?.isRunning?.()) {
      startTask.stop();
    }
    TaskManager.cancelTasks(START_TASK_KEY);
    startTask = null;
    if (phase === "starting") {
      phase = "idle";
    }
  }

  function cancelEndCountdown() {
    if (endTask?.isRunning?.()) {
      endTask.stop();
    }
    TaskManager.cancelTasks(END_TASK_KEY);
    endTask = null;
  }

  function releaseBarricade(npc) {
    if (!barricades.delete(npc)) {
      return;
    }
    const location = npc.getLocation();
    RegionManager.removeClipping(
      location.getX(),
      location.getY(),
      location.getZ(),
      RegionManager.BLOCKED_TILE,
      npc.getPrivateArea()
    );
  }

  function clearBarricades() {
    const addQueue = World.getAddNPCQueue();
    const removeQueue = World.getRemoveNPCQueue();
    for (const npc of [...barricades]) {
      releaseBarricade(npc);
      const pendingIndex = addQueue.indexOf(npc);
      if (pendingIndex !== -1) {
        addQueue.splice(pendingIndex, 1);
      } else if (npc.isRegistered?.() && !removeQueue.includes(npc)) {
        removeQueue.push(npc);
      }
    }
  }

  function resetMatchState() {
    clearBarricades();
    score[TEAM.SARADOMIN] = 0;
    score[TEAM.ZAMORAK] = 0;
    restoreFlagToBase(TEAM.SARADOMIN);
    restoreFlagToBase(TEAM.ZAMORAK);
  }

  function beginStartCountdown() {
    if (phase !== "idle") {
      return;
    }
    const counts = queueCounts();
    if (counts[TEAM.SARADOMIN] <= 0 || counts[TEAM.ZAMORAK] <= 0) {
      return;
    }
    phase = "starting";
    startTask = new CountdownTask(START_TASK_KEY, secondsToTicks(10), startGame);
    TaskManager.submit(startTask);
  }

  function rewardPlayer(player) {
    const teamId = getTeamId(player);
    if (!teamId) {
      return;
    }

    const winningTeam =
      score[TEAM.SARADOMIN] === score[TEAM.ZAMORAK]
        ? null
        : score[TEAM.SARADOMIN] > score[TEAM.ZAMORAK]
          ? TEAM.SARADOMIN
          : TEAM.ZAMORAK;

    if (winningTeam == null) {
      player.getInventory().adds(ItemIdentifiers.CASTLE_WARS_TICKET, 1);
      player.sendMessage("Tie game! You earn 1 Castle Wars ticket.");
      return;
    }

    if (winningTeam === teamId) {
      player.getInventory().adds(ItemIdentifiers.CASTLE_WARS_TICKET, 2);
      player.sendMessage("You won the game. You received 2 Castle Wars tickets!");
      return;
    }

    player.sendMessage("You lost the game. You received no tickets.");
  }

  function returnToLobby(player, message = null) {
    if (message) {
      player.sendMessage(message);
    }
    if (player.getAttribute(CASTLE_WARS_BOT_KEY) === true) {
      player.getForcedLogoutTimer().start(0);
      player.requestLogout();
      return;
    }
    player.smartMove(LOBBY_TELEPORT, 4);
  }

  function endGame() {
    if (phase === "ending" || phase === "idle") {
      return;
    }

    phase = "ending";
    cancelStartCountdown();
    cancelEndCountdown();

    for (const player of [...gameArea.getPlayers()]) {
      rewardPlayer(player);
      clearCastleWarsItems(player);
      setTeamId(player, null);
      closeOverlay(player);
      player.getPacketSender().sendInteractionOption("null", 2, true);
      returnToLobby(player);
    }

    resetMatchState();
    phase = "idle";
  }

  function startGame() {
    startTask = null;
    const counts = queueCounts();
    if (counts[TEAM.SARADOMIN] <= 0 || counts[TEAM.ZAMORAK] <= 0) {
      phase = "idle";
      return;
    }

    phase = "active";
    resetMatchState();

    for (const [teamId, area] of [
      [TEAM.SARADOMIN, saradominWaitingArea],
      [TEAM.ZAMORAK, zamorakWaitingArea],
    ]) {
      const team = getTeamData(teamId);
      for (const player of [...area.getPlayers()]) {
        player.resetCastlewarsIdleTime();
        player.setAttribute(TRANSITION_TO_GAME_KEY, true);
        closeOverlay(player);
        player.smartMove(team.startRoom, 3);
      }
    }

    endTask = new CountdownTask(END_TASK_KEY, secondsToTicks(1200), endGame);
    TaskManager.submit(endTask);
  }

  function restorePlayerFromInvalidLogin(player) {
    if (
      AreaManager.inside(player.getLocation(), gameArea) ||
      AreaManager.inside(player.getLocation(), saradominWaitingArea) ||
      AreaManager.inside(player.getLocation(), zamorakWaitingArea)
    ) {
      setTeamId(player, null);
      returnToLobby(player);
    }
  }

  function moveToWaitingRoom(player, teamId) {
    setTeamId(player, teamId);
    player.sendMessage(`You have been added to the ${getTeamData(teamId).name} team.`);
    player.smartMove(getTeamData(teamId).waitingRoom, 8);
  }

  function spawnCastleWarsBot(teamId) {
    const username = `CWBot${++botSerial}`;
    const bot = createBotPlayer(username, LOBBY_TELEPORT, {
      api,
      loadPersistence: false,
      saveRandomizedAppearance: false,
    });
    if (!bot) {
      return;
    }
    bot.setPlayerBot(true);
    bot.setAttribute(ATTR_SKIP_PERSISTENCE, true);
    bot.setAttribute(CASTLE_WARS_BOT_KEY, true);
    api.emitPlayerLogin({ player: bot, username });
    moveToWaitingRoom(bot, teamId);
  }

  function seedCastleWarsBots(teamId) {
    const opposingTeam = teamId === TEAM.SARADOMIN ? TEAM.ZAMORAK : TEAM.SARADOMIN;
    spawnCastleWarsBot(teamId);
    spawnCastleWarsBot(opposingTeam);
    spawnCastleWarsBot(opposingTeam);
  }

  function joinWaitingRoom(player, requestedTeam) {
    if (!player) {
      return;
    }
    if (phase === "active" || phase === "ending") {
      player.sendMessage("There's already a Castle Wars game running. Please wait.");
      return;
    }

    const headId = player.getEquipment().getSlot(Equipment.HEAD_SLOT);
    const capeId = player.getEquipment().getSlot(Equipment.CAPE_SLOT);
    if (headId > 0 || capeId > 0) {
      player.sendMessage("You can't wear hats, capes, or helms in Castle Wars.");
      return;
    }

    if (FOOD_ITEM_IDS.length > 0 && player.getEquipment().containsAny(FOOD_ITEM_IDS)) {
      player.sendMessage("You may not bring your own consumables inside Castle Wars.");
      return;
    }

    const counts = queueCounts();
    let teamId = requestedTeam;
    if (requestedTeam !== TEAM.SARADOMIN && requestedTeam !== TEAM.ZAMORAK) {
      teamId =
        counts[TEAM.ZAMORAK] > counts[TEAM.SARADOMIN]
          ? TEAM.SARADOMIN
          : TEAM.ZAMORAK;
    }

    if (
      teamId === TEAM.SARADOMIN &&
      counts[TEAM.SARADOMIN] > counts[TEAM.ZAMORAK]
    ) {
      player.sendMessage("The Saradomin team is full, try Zamorak.");
      return;
    }

    if (
      teamId === TEAM.ZAMORAK &&
      counts[TEAM.ZAMORAK] > counts[TEAM.SARADOMIN]
    ) {
      player.sendMessage("The Zamorak team is full, try Saradomin.");
      return;
    }

    moveToWaitingRoom(player, teamId);
    if (player.isPlayerBot() !== true) {
      seedCastleWarsBots(teamId);
    }
  }

  function requireFreeWeapon(player, message) {
    if (player.getEquipment().getSlot(Equipment.WEAPON_SLOT) <= 0) {
      return true;
    }
    player.sendMessage(message);
    return false;
  }

  function carryFlag(player, flagTeam) {
    flagStatus[flagTeam] = 1;
    player
      .getEquipment()
      .setItem(Equipment.WEAPON_SLOT, new Item(getTeamData(flagTeam).bannerId, 1));
    refreshPlayerAppearance(player, true);
    showCarrierHint(player, flagTeam);
  }

  function captureFlag(player, flagTeam) {
    if (
      flagStatus[flagTeam] !== 0 ||
      !requireFreeWeapon(
        player,
        "Please remove your weapon before attempting to capture the flag."
      )
    ) {
      return;
    }

    updateFlagStand(flagTeam, getTeamData(flagTeam).emptyStandId);
    carryFlag(player, flagTeam);
  }

  function returnCarriedFlag(player) {
    const teamId = getTeamId(player);
    const carriedFlagTeam = getCarriedFlagTeam(player);
    if (!teamId || !carriedFlagTeam) {
      return;
    }

    if (carriedFlagTeam === teamId) {
      restoreFlagToBase(carriedFlagTeam);
      clearWeaponSlot(player);
      player.sendMessage(`Returned the ${getTeamData(carriedFlagTeam).name.toLowerCase()} flag!`);
      return;
    }

    if (flagStatus[teamId] !== 0) {
      player.sendMessage("You need your own flag safely returned before you can score.");
      return;
    }

    restoreFlagToBase(carriedFlagTeam);
    clearWeaponSlot(player);
    score[teamId] += 1;
    player.sendMessage(`The team of ${getTeamData(teamId).name} scores 1 point!`);
  }

  function pickupDroppedFlag(player, flagTeam, object) {
    if (
      flagStatus[flagTeam] !== 2 ||
      !requireFreeWeapon(
        player,
        "Please remove your weapon before attempting to pick up the flag."
      )
    ) {
      return;
    }

    removeDroppedFlagObject(flagTeam);
    carryFlag(player, flagTeam);

    if (object?.getLocation?.()) {
      sendGameHintRemoval(object.getLocation());
    }
  }

  function isSteppingStone(tile) {
    return (
      (tile.x >= 2418 && tile.x <= 2420 && tile.y >= 3122 && tile.y <= 3125) ||
      (tile.x >= 2377 && tile.x <= 2378 && tile.y >= 3084 && tile.y <= 3088)
    );
  }

  function dropCarriedFlag(player) {
    const carriedFlagTeam = getCarriedFlagTeam(player);
    if (!carriedFlagTeam) {
      return;
    }

    clearWeaponSlot(player);

    const tile = getLocationTile(player);
    if (tile && isSteppingStone(tile)) {
      restoreFlagToBase(carriedFlagTeam);
      return;
    }

    flagStatus[carriedFlagTeam] = 2;
    const dropped = new GameObject(
      getTeamData(carriedFlagTeam).droppedFlagObjectId,
      player.getLocation().clone(),
      10,
      0,
      player.getPrivateArea()
    );
    droppedFlagObjects[carriedFlagTeam] = dropped;
    ObjectManager.register(dropped, true);
    showDroppedFlagHint(dropped.getLocation());
  }

  function handleStandClick(player, flagTeam) {
    const teamId = getTeamId(player);
    if (!teamId) {
      return true;
    }
    if (teamId === flagTeam) {
      returnCarriedFlag(player);
      return true;
    }
    captureFlag(player, flagTeam);
    return true;
  }

  function teleportFromObject(object, player, from, to) {
    if (!isAt(object, from[0], from[1], from[2])) {
      return false;
    }
    moveTo(player, to);
    return true;
  }

  function handleEnergyBarrier(player, object, allowedTeam, crossings) {
    if (getTeamId(player) !== allowedTeam) {
      player.sendMessage(ENEMY_SPAWN_MESSAGE);
      return true;
    }

    player.resetCastlewarsIdleTime();
    const tile = getLocationTile(player);
    const objectCrossings = crossings.filter(([at]) => isAt(object, at[0], at[1], at[2]));
    if (!tile || objectCrossings.length === 0) {
      return true;
    }
    const crossing = objectCrossings.find(([, from]) => isAt(tile, from[0], from[1], from[2]));
    if (crossing) {
      moveTo(player, crossing[2]);
      return true;
    }

    return true;
  }

  function handleObjectRoute(event) {
    const barrier = ENERGY_BARRIERS[event.objectId];
    if (!barrier) {
      return;
    }
    const tile = event.sourceLocation;
    const crossing = barrier.crossings
      .filter(([at]) => isAt(event.object, at[0], at[1], at[2]))
      .sort((a, b) => {
        const distance = ([, from]) => Math.abs(from[0] - tile.x) + Math.abs(from[1] - tile.y);
        return distance(a) - distance(b);
      })[0];
    if (crossing) {
      const [, from] = crossing;
      event.destination = { x: from[0], y: from[1], z: from[2] };
    }
  }

  function handleSteppingStone(player, object) {
    const tile = getLocationTile(player);
    if (!tile || !isAt(object, object.getLocation().getX(), object.getLocation().getY(), tile.z)) {
      return true;
    }

    const objectX = object.getLocation().getX();
    const objectY = object.getLocation().getY();
    if (objectX === tile.x && objectY === tile.y) {
      player.sendMessage("You are standing on the rock you clicked.");
      return true;
    }
    if (objectX > tile.x && objectY === tile.y) {
      player.getMovementQueue().walkStep(1, 0);
      return true;
    }
    if (objectX < tile.x && objectY === tile.y) {
      player.getMovementQueue().walkStep(-1, 0);
      return true;
    }
    if (objectY > tile.y && objectX === tile.x) {
      player.getMovementQueue().walkStep(0, 1);
      return true;
    }
    if (objectY < tile.y && objectX === tile.x) {
      player.getMovementQueue().walkStep(0, -1);
      return true;
    }
    player.sendMessage("Can't reach that.");
    return true;
  }

  function takeSupply(player, itemId, message, amount) {
    if (player.getTimers().has(TimerKey.CASTLEWARS_TAKE_ITEM)) {
      return true;
    }
    player.performAnimation(TAKE_SUPPLY_ANIM);
    player.getInventory().adds(itemId, amount);
    player.sendMessage(message);
    player.getTimers().extendOrRegister(TimerKey.CASTLEWARS_TAKE_ITEM, 2);
    return true;
  }

  function setupBarricade(event) {
    const { player, itemId, slot } = event;
    if (itemId !== BARRICADE_ITEM_ID) {
      return false;
    }

    const location = player.getLocation();
    if (!GAME_BOUNDS.some((boundary) => boundary.inside(location))) {
      player.sendMessage("You can only set up barricades during a Castle Wars game.");
      return true;
    }

    if (
      RegionManager.blocked(location, player.getPrivateArea()) ||
      ObjectManager.existsLocation(location) ||
      World.isNpcOccupyingTile(location, null, 1, player.getPrivateArea())
    ) {
      player.sendMessage("You can't set up a barricade here.");
      return true;
    }

    const barricade = new NPC(NpcIdentifiers.BARRICADE, location.clone());
    barricade.__skipDefaultRespawn = true;
    barricades.add(barricade);
    RegionManager.addClipping(
      location.getX(),
      location.getY(),
      location.getZ(),
      RegionManager.BLOCKED_TILE,
      player.getPrivateArea()
    );
    World.getAddNPCQueue().push(barricade);
    player.getInventory().deleteAtSlot(slot, 1);
    return true;
  }

  function runRoutes(object, player, routes) {
    return routes.some(([from, to]) => teleportFromObject(object, player, from, to));
  }

  function handleSharedGameObjectClick(player, object, clickType) {
    const id = object.getId();
    const barrier = ENERGY_BARRIERS[id];
    if (barrier) {
      return handleEnergyBarrier(player, object, barrier.team, barrier.crossings);
    }

    const routes = TELEPORT_ROUTES[id];
    if (routes) {
      return runRoutes(object, player, routes);
    }

    const supply = SUPPLY_TABLES[id];
    if (supply) {
      return takeSupply(player, supply[0], supply[1], clickType === 2 ? 5 : 1);
    }

    const droppedFlagTeam = DROPPED_FLAG_TEAMS[id];
    if (droppedFlagTeam) {
      pickupDroppedFlag(player, droppedFlagTeam, object);
      return true;
    }

    const fixedMove = FIXED_MOVES[id];
    if (fixedMove) {
      moveTo(player, fixedMove);
      return true;
    }

    switch (id) {
      case ObjectIdentifiers.STEPPING_STONE:
        return handleSteppingStone(player, object);
      case ObjectIdentifiers.STAIRCASE_17:
        if (!isAt(object, 2417, 3074, 0)) {
          return false;
        }
        moveTo(
          player,
          player.getLocation().getX() === 2416 ? [2417, 3077, 0] : [2416, 3074, 0]
        );
        return true;
      case ObjectIdentifiers.STAIRCASE_18:
        if (!isAt(object, 2382, 3131, 0)) {
          return false;
        }
        moveTo(
          player,
          player.getLocation().getX() >= 2383 && player.getLocation().getX() <= 2385
            ? [2382, 3130, 0]
            : [2383, 3133, 0]
        );
        return true;
      case ObjectIdentifiers.GATE_26:
        moveTo(player, isAt(object, 2399, 3099, 0) ? [2399, 9500, 0] : [2400, 9507, 0]);
        return true;
      default:
        return false;
    }
  }

  function openLobbyBank(player) {
    player.getBank(player.getCurrentBankTab()).open();
  }

  function protectTeamColours(player, slot) {
    if (!TEAM_COLOUR_SLOTS.has(slot)) {
      return true;
    }
    player.sendMessage(TEAM_COLOUR_MESSAGE);
    return false;
  }

  function handleLobbyObjectClick(player, object, clickType) {
    const id = object.getId();
    if (id === ObjectIdentifiers.BANK_CHEST_2) {
      if (clickType === 1) {
        openLobbyBank(player);
      } else {
        player.sendMessage("The Grand Exchange is not available here.");
      }
      return true;
    }

    if (Object.prototype.hasOwnProperty.call(LOBBY_TEAMS, id)) {
      joinWaitingRoom(player, LOBBY_TEAMS[id] || null);
      return true;
    }

    return false;
  }

  function handleWaitingObjectClick(player, object) {
    if (!WAITING_EXIT_IDS.has(object.getId())) {
      return false;
    }
    returnToLobby(player);
    return true;
  }

  function handleGameObjectClick(player, object, clickType) {
    const id = object.getId();
    if (GAME_EXIT_IDS.has(id)) {
      returnToLobby(player, "The Castle Wars game has ended for you.");
      return true;
    }

    const standTeam = STAND_TEAMS[id];
    if (standTeam) {
      return handleStandClick(player, standTeam);
    }

    const trapdoor = TRAPDOOR_ROUTES[id];
    if (trapdoor) {
      if (getTeamId(player) === trapdoor.blockedTeam) {
        player.sendMessage(ENEMY_SPAWN_MESSAGE);
        return true;
      }
      moveTo(player, trapdoor.to);
      return true;
    }

    return handleSharedGameObjectClick(player, object, clickType);
  }

  class CastleWarsLobbyArea extends Area {
    constructor() {
      super(LOBBY_BOUNDS);
    }

    getName() {
      return "Castle Wars Lobby";
    }
  }

  class CastleWarsWaitingArea extends Area {
    constructor(teamId) {
      super(getTeamData(teamId).waitingBounds);
      this.teamId = teamId;
    }

    getName() {
      return `${getTeamData(this.teamId).name} waiting room`;
    }

    postEnter(character) {
      const player = character.getAsPlayer?.();
      if (!player) {
        return;
      }

      if (getTeamId(player) !== this.teamId) {
        setTeamId(player, this.teamId);
      }

      equipTeamColours(player, getTeamData(this.teamId));
      player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, WAITING_ROOM_INTERFACE, 1);
      beginStartCountdown();
      const secondsLeft = startTask?.isRunning?.()
        ? Math.ceil((startTask.getRemainingTicks() | 0) * 0.6)
        : 0;
      player.sendMessage(
        secondsLeft > 0
          ? `Next game begins in ${secondsLeft} seconds.`
          : "Waiting for players to join the other team."
      );
    }

    postLeave(character, logout) {
      const player = character.getAsPlayer?.();
      if (!player) {
        return;
      }

      if (logout) {
        if (player.getAttribute(CASTLE_WARS_BOT_KEY) === true) {
          return;
        }
        returnToLobby(player);
      }

      if (player.getAttribute(TRANSITION_TO_GAME_KEY) === true) {
        return;
      }

      clearCastleWarsItems(player);
      player.resetAttributes();
      setTeamId(player, null);
      closeOverlay(player);

      const counts = queueCounts();
      if (
        phase === "starting" &&
        (counts[TEAM.SARADOMIN] <= 0 || counts[TEAM.ZAMORAK] <= 0)
      ) {
        cancelStartCountdown();
      }
    }

    process(character) {
      const player = character.getAsPlayer?.();
      if (!player) {
        return;
      }

      setVar(
        player,
        TIMER_VARP,
        startTask?.isRunning?.()
          ? Math.ceil((startTask.getRemainingTicks() | 0) * 0.6)
          : 0
      );
    }

  }

  class CastleWarsGameArea extends Area {
    constructor() {
      super(GAME_BOUNDS);
    }

    getName() {
      return "Castle Wars";
    }

    postEnter(character) {
      const player = character.getAsPlayer?.();
      if (!player) {
        return;
      }

      if (phase !== "active" || !getTeamId(player)) {
        returnToLobby(player);
        return;
      }

      player.setAttribute(TRANSITION_TO_GAME_KEY, false);
      player
        .getPacketSender()
        .sendSubInterface(
          OVERLAY_HUD_UID,
          STATUS_OVERLAY_INTERFACE[getTeamId(player)],
          1
        );
      player.getPacketSender().sendInteractionOption("Attack", 2, true);
    }

    postLeave(character, logout) {
      const player = character.getAsPlayer?.();
      if (!player) {
        return;
      }

      player.getPacketSender().sendInteractionOption("null", 2, true);
      closeOverlay(player);
      player.getPacketSender().sendEntityHintRemoval(true);
      clearCastleWarsItems(player);

      if (logout) {
        returnToLobby(player);
      }

      setTeamId(player, null);

      if (phase !== "active") {
        return;
      }

      if (
        gameArea.getPlayers().length < 2 ||
        getTeamMembersInGame(TEAM.SARADOMIN).length === 0 ||
        getTeamMembersInGame(TEAM.ZAMORAK).length === 0
      ) {
        endGame();
      }
    }

    process(character) {
      const player = character.getAsPlayer?.();
      if (!player) {
        return;
      }

      const teamId = getTeamId(player);
      if (!teamId) {
        return;
      }

      const team = getTeamData(teamId);
      const inSpawn = team.respawnBounds.inside(player.getLocation());

      setVar(player, SCORE_VARBIT[TEAM.SARADOMIN], score[TEAM.SARADOMIN], true);
      setVar(player, SCORE_VARBIT[TEAM.ZAMORAK], score[TEAM.ZAMORAK], true);
      setVar(player, FLAG_VARBIT[TEAM.SARADOMIN], flagStatus[TEAM.SARADOMIN], true);
      setVar(player, FLAG_VARBIT[TEAM.ZAMORAK], flagStatus[TEAM.ZAMORAK], true);
      setVar(
        player,
        TIMER_VARP,
        Math.ceil(((endTask?.getRemainingTicks?.() ?? 0) * 0.6) / 60)
      );
      player
        .getPacketSender()
        .sendString(
          inSpawn
            ? `You have ${formatTicks(player.castlewarsIdleTime | 0)} to leave the respawn room.`
            : "",
          EJECT_TEXT_UID[teamId]
        );

      if (inSpawn && player?.isPlayerBot?.() !== true) {
        if (player.castlewarsIdleTime > 0) {
          player.castlewarsIdleTime--;
        }
        if (player.castlewarsIdleTime <= 0) {
          player.sendMessage("You idled too long in the respawn room.");
          returnToLobby(player);
        }
      }
    }

  }

  const lobbyArea = new CastleWarsLobbyArea();
  const saradominWaitingArea = new CastleWarsWaitingArea(TEAM.SARADOMIN);
  const zamorakWaitingArea = new CastleWarsWaitingArea(TEAM.ZAMORAK);
  const gameArea = new CastleWarsGameArea();
  const castleWarsAreas = new Set([gameArea, saradominWaitingArea, zamorakWaitingArea]);

  function handleTeamColourChange(event) {
    if (!castleWarsAreas.has(event.player?.getArea?.())) {
      return;
    }
    event.allow = protectTeamColours(event.player, event.slot);
  }

  function handleCanAttack(event) {
    const attacker = event.attacker?.getAsPlayer?.();
    const target = event.target?.getAsPlayer?.();
    if (attacker?.getArea?.() !== gameArea || target?.getArea?.() !== gameArea) {
      return;
    }
    if (getTeamId(attacker) === getTeamId(target)) {
      attacker.sendMessage("You can't attack your own team in Castle Wars.");
      event.allow = false;
      return;
    }
    event.allow = true;
  }

  function handleCanTeleport(event) {
    if (event.player?.getArea?.() !== gameArea) {
      return;
    }
    event.player.sendMessage("You can't leave just like that!");
    event.allow = false;
  }

  function handlePlayerDeath(event) {
    const { player, killer } = event;
    const teamId = player?.getArea?.() === gameArea ? getTeamId(player) : null;
    if (!teamId) {
      return;
    }
    dropCarriedFlag(player);
    player.resetCastlewarsIdleTime();
    player.smartMoves(getTeamData(teamId).respawnBounds);
    player.castlewarsDeaths = (player.castlewarsDeaths | 0) + 1;
    if (killer?.isPlayer?.() === true) {
      killer.castlewarsKills = (killer.castlewarsKills | 0) + 1;
    }
    event.handled = true;
  }

  function handleObjectInteraction(event) {
    const { player, object, clickType } = event;
    const location = object.getLocation();
    const handled = LOBBY_BOUNDS.some((boundary) => boundary.inside(location))
      ? handleLobbyObjectClick(player, object, clickType)
      : [...TEAM_DATA[TEAM.SARADOMIN].waitingBounds, ...TEAM_DATA[TEAM.ZAMORAK].waitingBounds]
          .some((boundary) => boundary.inside(location))
        ? handleWaitingObjectClick(player, object)
        : GAME_BOUNDS.some((boundary) => boundary.inside(location))
          ? handleGameObjectClick(player, object, clickType)
          : false;
    if (handled) {
      event.handled = true;
    }
  }

  function handleDeathItemDrop(event) {
    const player = event?.player;
    const itemId = event?.item?.getId?.();
    if (!player || !itemId || !castleWarsAreas.has(player.getArea()) || !DEATH_REMOVE_ITEM_IDS.has(itemId)) {
      return;
    }

    if (
      itemId === ItemIdentifiers.SARADOMIN_BANNER ||
      itemId === ItemIdentifiers.ZAMORAK_BANNER
    ) {
      dropCarriedFlag(player);
    }

    event.handled = true;
  }

  function handleNpcDeath({ npc }) {
    if (!barricades.has(npc)) {
      return;
    }
    npc.__skipDefaultRespawn = true;
    releaseBarricade(npc);
  }

  function handleItemOnPlayer(event) {
    const { player, target, itemId } = event;
    if (
      itemId !== ItemIdentifiers.BANDAGES ||
      player?.getArea?.() !== gameArea ||
      target?.getArea?.() !== gameArea
    ) {
      return;
    }

    if (getTeamId(player) !== getTeamId(target)) {
      player.sendMessage("You don't want to be healing your enemies!");
      event.handled = true;
      return;
    }

    target.heal(12);
    player.getInventory().delete(ItemIdentifiers.BANDAGES, 1);
    player.getInventory().refreshItems();
    event.handled = true;
  }

  function registerAreas() {
    AreaManager.areas.push(lobbyArea, saradominWaitingArea, zamorakWaitingArea, gameArea);
  }

  function spawnAltars() {
    for (const [id, at, face] of ALTAR_SPAWNS) {
      ObjectManager.register(
        new GameObject(id, new Location(at[0], at[1], at[2]), 10, face, null),
        true
      );
    }
    resetMatchState();
  }

  registerAreas();

  api.onServerStartup(spawnAltars);
  api.onPlayerLogin(({ player }) => {
    restorePlayerFromInvalidLogin(player);
  });
  api.onPlayerDeathItemDrop(handleDeathItemDrop);
  api.onNpcDeath(handleNpcDeath);
  api.onItemAction((event) => {
    if (event.clickType === 2 && setupBarricade(event)) {
      event.handled = true;
    }
  });
  api.onItemOnPlayer(handleItemOnPlayer);
  api.onObjectRoute(handleObjectRoute);
  api.onObjectInteraction(handleObjectInteraction);
  api.onCanEquip(handleTeamColourChange);
  api.onCanUnequip(handleTeamColourChange);
  api.onCanAttack(handleCanAttack);
  api.onCanTeleport(handleCanTeleport);
  api.onPlayerDeath(handlePlayerDeath);
}

let AreaManager;
let BonusManager;
let ObjectManager;
let RegionManager;
let TaskManager;
let World;

module.exports = {
  name: "CastleWars",
  dependsOn: ["Food"],
  register(api) {
    AreaManager = api.getAreaManager();
    BonusManager = api.getBonusManager();
    ObjectManager = api.getObjectManager();
    RegionManager = api.getRegionManager();
    TaskManager = api.getTaskManager();
    World = api.getWorld();
    createCastleWars(api);
  },
};
