# PvP Bot Realism and Wilderness Hotspot Plan

## Goal
Build realistic OSRS-style PvP bots with:
- varying difficulty
- archetype-based gear and inventory randomness
- believable wilderness hotspot population
- clean integration with the existing bot behavior tree/runtime
- minimal server overhead and no avoidable hot-path regressions

This plan combines both workstreams into one implementation track so hotspot orchestration and PvP realism are built on the same bot architecture rather than as separate systems.

## Non-goals
- perfect human imitation
- a full combat engine rewrite
- expensive per-bot full-world scans
- one-off ad hoc PvP logic bolted directly into `PvpBehavior`
- random gear/stat variance without controlled archetypes and telemetry
- replacing server authority with client-side or peer-to-peer combat logic

## Design constraints
Above all, implementation must stay clean and cheap:
- keep behavior inside the current behavior tree / mode / node architecture
- push expensive decisions onto coarse timers, not every tick
- do not add per-bot O(world players) scans to steady-state processing
- prefer precomputed profiles, hotspot definitions, and lookup tables over dynamic heavy heuristics
- keep combat/movement execution in the existing engine; bots should choose actions, not reimplement combat rules
- every new runtime system must have explicit performance gates and sampled diagnostics

## Existing integration points
These are the primary files the implementation should extend rather than bypass:
- [PlayerBots.plugin.js](/Users/toby/elvarg-web/elvarg-web-server/plugins/bots/PlayerBots.plugin.js)
- [BotPluginBoot.js](/Users/toby/elvarg-web/elvarg-web-server/plugins/bots/runtime/BotPluginBoot.js)
- [PlayerBotBehaviorTreeFactory.js](/Users/toby/elvarg-web/elvarg-web-server/plugins/bots/behaviours/branches/PlayerBotBehaviorTreeFactory.js)
- [PvpBehavior.js](/Users/toby/elvarg-web/elvarg-web-server/plugins/bots/behaviours/modes/PvpBehavior.js)
- [BotBehaviorTask.js](/Users/toby/elvarg-web/elvarg-web-server/plugins/bots/behaviours/task/BotBehaviorTask.js)
- [PlayerBotState.js](/Users/toby/elvarg-web/elvarg-web-server/plugins/bots/behaviours/state/PlayerBotState.js)

Current shape:
- one main bot behavior tree with movement/eat/mode handling
- one `PVP` mode with internal phase handling
- a central task scheduler with LOD/throttling support already present
- existing bot state bags for mode-specific data

That is the right foundation. The next work should refine it, not replace it.

## OSRS PKing realism targets
Realism should come from constraints, timing, and archetypes, not fake randomness.

### Core behavior targets
Bots should differ in:
- target selection discipline
- reaction delay
- prayer switching quality
- eat/combination eat timing
- special attack timing
- chase vs escape thresholds
- willingness to risk smite/deep wilderness commitment
- freeze/teleblock discipline if the content is supported

### Wilderness hotspot targets
Bots should feel anchored to real activity zones rather than globally wandering.
Initial hotspot candidates:
- Edgeville ditch / low-level edge fights
- Chaos Altar
- Mage Bank area
- Revenant approach routes / entrances if supported by your world
- selected boss/altar/lever travel routes only if there is enough content support to make encounters believable

### OSRS behavioral principles to mirror
These are the realism rules worth following because they affect how PKing actually feels:
- weaker PKers are slower and less disciplined, not omniscient but inaccurate
- stronger PKers are faster at prayer/spec/eating decisions, but still bounded by cooldown windows
- hotspot populations should bias toward different combat styles and risk profiles
- deep wilderness bots should chase longer and escape later than edge-style bots
- anti-PK style bots should prefer disengage/re-engage over constant tunnel vision

## External references used for the plan
Primary references for mechanics and wilderness behavior assumptions:
- OSRS Wiki: Poison - https://oldschool.runescape.wiki/w/Poison
- OSRS Wiki: Wilderness - https://oldschool.runescape.wiki/w/Wilderness
- OSRS Wiki: Tele Block - https://oldschool.runescape.wiki/w/Tele_Block
- OSRS Wiki: Bind - https://oldschool.runescape.wiki/w/Bind
- OSRS Wiki: Snare - https://oldschool.runescape.wiki/w/Snare
- OSRS Wiki: Entangle - https://oldschool.runescape.wiki/w/Entangle
- OSRS Wiki: Protect from Magic - https://oldschool.runescape.wiki/w/Protect_from_Magic
- OSRS Wiki: Protect from Missiles - https://oldschool.runescape.wiki/w/Protect_from_Missiles
- OSRS Wiki: Protect from Melee - https://oldschool.runescape.wiki/w/Protect_from_Melee
- OSRS Wiki: Smite - https://oldschool.runescape.wiki/w/Smite
- OSRS Wiki: Dragon dagger(p++) - https://oldschool.runescape.wiki/w/Dragon_dagger(p%2B%2B)
- OSRS Wiki: Chaos Temple (for hotspot relevance) - https://oldschool.runescape.wiki/w/Chaos_Temple
- OSRS Wiki: Mage Arena Bank - https://oldschool.runescape.wiki/w/Mage_Arena_Bank
- OSRS Wiki: Revenant Caves - https://oldschool.runescape.wiki/w/Revenant_Caves

These sources should guide mechanics and hotspot selection, but implementation still needs to respect the content that actually exists in this codebase.

## Target architecture
The correct direction is not “put more code into `PvpBehavior.tick()`.”
It is:
- keep one PvP mode
- factor decision-making into reusable nodes/policies
- keep profile data and hotspot data outside the hot path
- let the scheduler control when expensive PvP decisions are allowed

### New architectural pieces
1. `PvPProfileRegistry`
- static registry of difficulty profiles
- defines reaction windows, discipline weights, prayer confidence, switch chance, risk tolerance, spec rules, escape thresholds
- profiles should be immutable data, not dynamic objects rebuilt per bot

2. `PvPLoadoutRegistry`
- static registry of archetype-based loadouts
- examples: edge main, low-risk rune, deep wild hybrid, anti-pk, rusher
- supports controlled randomness within strict archetype bounds

3. `WildernessHotspotRegistry`
- static hotspot definitions with:
  - area/bounds
  - allowed archetypes
  - target population range
  - style weights
  - combat-depth/risk metadata
  - activation rules

4. `PvPEncounterState`
- small state bag inside `PlayerBotState.pvp`
- stores current engagement facts and cooldowns, not heavyweight analysis

5. new BT nodes/policies
- lightweight nodes for specific PvP decisions instead of one large mode blob

## Required state additions
Extend `createPvpBehaviorState()` in [PlayerBotState.js](/Users/toby/elvarg-web/elvarg-web-server/plugins/bots/behaviours/state/PlayerBotState.js) with cheap scalar state only.

Recommended fields:
- `profileId`
- `loadoutId`
- `hotspotId`
- `engagementStyle`
- `preferredCombatStyle`
- `nextTargetReviewAt`
- `nextPrayerReviewAt`
- `nextSpecReviewAt`
- `nextEscapeReviewAt`
- `lastFreezeAt`
- `lastTeleblockAt`
- `lastDamageTakenAt`
- `lastDamageDealtAt`
- `lastFoodAt`
- `lastBrewAt`
- `lastComboEatAt`
- `escapeThreshold`
- `riskTolerance`
- `confidenceTier`
- `currentTargetScore`
- `targetLockUntil`

Do not add arrays/maps to per-bot hot state unless clearly necessary.

## Behavior tree and node plan
The implementation should stay tree-driven.

### Keep the current top-level shape
Retain the current `SelectorNode` structure in [PlayerBotBehaviorTreeFactory.js](/Users/toby/elvarg-web/elvarg-web-server/plugins/bots/behaviours/branches/PlayerBotBehaviorTreeFactory.js):
- pending movement processing
- food/survival actions
- mode handling

### Add PvP-specific sub-behavior nodes
Introduce PvP nodes behind the existing mode handler rather than at the root tree.

Recommended node set:
1. `PvpValidateEngagementNode`
- clears dead/invalid targets
- respects wilderness constraints and target locality
- cheap, should run often

2. `PvpAcquireTargetNode`
- coarse-timer gated
- uses nearby/hotspot-local candidate pools only
- scores candidates with cheap weighted heuristics

3. `PvpDefensiveActionNode`
- food, combo eat, prayer response, retreat trigger
- should prioritize survival before aggression

4. `PvpSpecDecisionNode`
- decides if/when to spec based on profile, weapon, opponent HP, confidence
- heavily cooldown gated

5. `PvpPrayerDecisionNode`
- cheap prayer decision review on a fixed interval
- no per-tick overthinking

6. `PvpChaseOrDisengageNode`
- decides whether to continue pressure, step back, reset, or flee
- driven by profile and hotspot risk metadata

7. `PvpHotspotRoamNode`
- used when idle/seeking inside assigned wilderness hotspot
- replaces generic aimless roaming for PvP-assigned bots

### Important rule
Nodes should decide and schedule action. They should not duplicate combat or pathfinding internals already handled by the engine.

## Difficulty system
Difficulty should primarily change behavior quality, not stats cheats.

### Proposed tiers
1. `novice`
- slow reaction windows
- weak prayer usage
- poor chase discipline
- frequent panic eating
- low switch/spec usage

2. `standard`
- reasonable timing
- basic protect prayer response
- occasional spec opportunities
- moderate pursuit discipline

3. `veteran`
- consistent prayer review
- better eat/spec timing
- stronger target selection
- more controlled disengage behavior

4. `elite`
- fastest allowed reaction envelope
- disciplined prayer/spec logic
- strong target persistence
- smarter escape/anti-smite decisions

### How difficulty should be expressed
Profiles should define ranges like:
- `targetReviewMs`
- `prayerReviewMs`
- `specReviewMs`
- `eatAtHpPct`
- `comboEatChance`
- `panicEatThreshold`
- `switchChance`
- `retreatHpPct`
- `teleRiskThreshold`
- `smiteUseChance`
- `freezeFollowUpChance`

That is cleaner and cheaper than branching on difficulty throughout PvP code.

## Loadout and item randomness plan
Randomness should be archetype-constrained.

### Archetypes
Initial archetypes:
- `edge_main_melee`
- `edge_ranged_melee`
- `deep_wild_hybrid`
- `anti_pk_hybrid`
- `budget_pk`
- `rusher`

### Randomness rules
Allow controlled variance in:
- food count
- potion count
- rune quantity
- ammo quantity
- one of several valid weapons within the archetype
- one of several valid helm/body/legs/cape/ring variants within the archetype

Do not randomize in ways that make bots incoherent, for example:
- contradictory combat styles
- items unsupported by the bot’s action profile
- inventories that cannot sustain the intended behavior

### Implementation note
Loadouts should be resolved once on spawn/reset, not rebuilt during combat.

## Wilderness hotspot orchestration plan
This is the second major workstream and should live in the same system.

### Hotspot model
Each hotspot should define:
- `id`
- `area`
- `enabled`
- `minBots`
- `targetBots`
- `maxBots`
- `allowedProfiles`
- `allowedArchetypes`
- `styleWeights`
- `activityWeights` (`seek`, `fight`, `bait`, `anti-pk`, `escape`)
- `dangerTier`
- `homeResetArea`

### Runtime behavior
- assign PvP bots to hotspots on coarse intervals only
- do not scan all hotspots for all bots every tick
- maintain hotspot occupancy counters centrally
- use local/hotspot-scoped candidate selection for target acquisition
- allow hotspot reassignment on slow timers, death, or prolonged inactivity

### Suggested initial hotspots
Implement only zones that the current world content can support cleanly.
Candidate rollout order:
1. Edgeville ditch
2. Chaos Altar
3. Mage Bank
4. one deeper roaming route if the pathing/content is reliable

## Performance requirements
This work only makes sense if it stays cheap.

### Hard rules
- no new per-tick full-world player scans for PvP bots
- no hot-path array sorting unless candidate sets are already very small
- no repeated loadout rebuilds during combat
- no repeated hotspot scoring every tick
- no expensive logging by default

### Performance mechanisms to use
Reuse existing runtime strengths:
- observer / LOD throttling in [BotBehaviorTask.js](/Users/toby/elvarg-web/elvarg-web-server/plugins/bots/behaviours/task/BotBehaviorTask.js)
- coarse review timers per bot state
- small candidate sets from nearby players only
- sampled bot profiling rather than full tracing

### Acceptance gates
Before merging each phase, validate with `::serverperf 60` and current bot populations.

Target guardrails:
- no material regression in `world.process_players`
- no material regression in `task.BotBehaviorTask`
- no new drift problems
- hotspot population logic should not show up as a top phase in normal serverperf windows

## Rollout phases

## Phase 1: Data model and config foundation
Deliverables:
- `PvPProfileRegistry`
- `PvPLoadoutRegistry`
- `WildernessHotspotRegistry`
- config wiring in [PlayerBots.plugin.js](/Users/toby/elvarg-web/elvarg-web-server/plugins/bots/PlayerBots.plugin.js)
- state extensions in [PlayerBotState.js](/Users/toby/elvarg-web/elvarg-web-server/plugins/bots/behaviours/state/PlayerBotState.js)

Acceptance:
- no behavior change yet unless explicitly enabled
- bots can be assigned a profile, archetype, and hotspot id
- no measurable perf regression

## Phase 2: PvP mode decomposition into nodes
Deliverables:
- extract `PvpValidateEngagementNode`
- extract `PvpAcquireTargetNode`
- extract `PvpDefensiveActionNode`
- extract `PvpPrayerDecisionNode`
- extract `PvpSpecDecisionNode`
- wire them under the existing PvP mode path cleanly

Acceptance:
- behavior remains at least as stable as current PvP bots
- `PvpBehavior` becomes thinner, easier to reason about
- profiler confirms no new hot-path explosion

## Phase 3: Difficulty profiles and realism tuning
Deliverables:
- implement the four profile tiers
- tune delays, review intervals, eat/spec/prayer behavior
- make strong bots disciplined rather than omniscient

Acceptance:
- visible bot skill variance in live testing
- metrics show different tiers behave differently
- no branchy difficulty checks scattered through hot code

## Phase 4: Archetype-based loadouts and randomness
Deliverables:
- spawn/reset loadout generation from archetypes
- controlled inventory/equipment randomness
- support for weapon families and item substitution tables

Acceptance:
- bots look varied but coherent
- no runtime inventory churn during combat
- no unsupported gear combinations

## Phase 5: Wilderness hotspot orchestration
Deliverables:
- hotspot registry and occupancy manager
- hotspot assignment and reassignment
- hotspot-specific roam/seek behavior
- initial rollout to 2-3 well-supported wilderness zones

Acceptance:
- hotspots feel populated intentionally
- PvP bots stop clustering unnaturally in irrelevant places
- occupancy logic does not appear as a hot server phase

## Phase 6: Telemetry, balancing, and polish
Deliverables:
- sampled per-profile metrics
- hotspot occupancy metrics
- K/D, TTK, prayer/spec usage, escape success
- config toggles to disable tiers/hotspots independently

Acceptance:
- balancing is data-driven rather than impression-driven
- bad profiles/hotspots can be isolated and tuned quickly

## Suggested implementation order inside the codebase
1. add registries and config wiring
2. extend PvP state bag
3. refactor `PvpBehavior` by extraction, not rewrite
4. add profile-driven timing and decision windows
5. add archetype loadouts
6. add hotspot assignment/roam logic
7. add telemetry and balancing loop

## Testing plan
### Functional
- bot acquires/retains/drops targets correctly
- different difficulties show different prayer/eat/spec timing
- bots repopulate configured hotspots sensibly
- loadouts are varied but valid

### Performance
- compare `::serverperf 60` before/after each phase
- watch:
  - `world.process_players`
  - `world.task_manager`
  - `task.BotBehaviorTask`
  - `player.process.combat`
  - `player.process.movement`

### Safety checks
- no new noisy logs by default
- all new heavy diagnostics behind env/config flags
- hotspot/target review loops use coarse timers and nearby-only candidate pools

## Completion criteria
This work is done when:
- PvP bots have clear difficulty tiers that feel believable
- loadout variation is archetype-driven and coherent
- wilderness hotspots are intentionally populated
- the implementation remains node/tree driven and maintainable
- server performance remains healthy at current bot counts
- new PvP behavior can be tuned through registries/config rather than rewriting core logic
