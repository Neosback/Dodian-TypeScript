# Area To Hook Migration Matrix

## Goal
Replace `Area` subclass dependency inversion with explicit plugin hooks for gameplay policy checks, while keeping `Area` as a fallback for not-yet-migrated systems.

## Hook Coverage Implemented
- `onPlayerProcess`
- `onCanAttack`
- `onCanTeleport`
- `onCanEat`
- `onCanDrink`
- `onCanTrade`
- `onCanEquip`
- `onSpellDisabled`
- `onNpcAggressionTolerance`
- `onPlayerDefeated`
- `onObjectInteraction`

## Core Callsites Migrated To Hook-First
- `Food.consume` -> `emitCanEat` (`src/main/typescript/elvarg/game/content/Food.ts`)
- `PotionConsumable.drink` -> `emitCanDrink` and `emitCanEat` (`src/main/typescript/elvarg/game/content/PotionConsumable.ts`)
- `TradeRequestPacketListener.sendRequest` -> `emitCanTrade` (`src/main/typescript/elvarg/net/packet/impl/TradeRequestPacketListener.ts`)
- `EquipPacketListener.equip` -> `emitCanEquip` (`src/main/typescript/elvarg/net/packet/impl/EquipPacketListener.ts`)
- `Spell.canCast` -> `emitSpellDisabled` (`src/main/typescript/elvarg/game/content/combat/magic/Spell.ts`)
- `NpcAggression.runAggression` tolerance override -> `emitNpcAggressionTolerance` (`src/main/typescript/elvarg/game/entity/impl/npc/NpcAggression.ts`)

## Vertical Slice Status
- Wilderness:
  - Fully pluginized for enter/leave/process/combat/teleport/obelisk/death integration.
  - Implemented in `plugins/areas/Wilderness.plugin.js`.
  - Legacy class removed: `src/main/typescript/elvarg/game/model/areas/impl/WildernessArea.ts`.

## Remaining `Area`-Coupled Systems (Priority Order)
1. Duel Arena:
   - `canAttack`, `canTeleport`, death handling, object handling.
2. Castle Wars:
   - waiting/game area state transitions, object interactions, equipment constraints.
3. Fight Caves / Barrows / Godwars / KBD:
   - mostly policy hooks and object/teleport constraints.

## Migration Rule
For each subsystem:
1. Add missing generic hook once in core (if required).
2. Move subsystem logic to plugin.
3. Keep `Area` fallback in core until plugin parity is proven.
4. Remove old `Area` subclass when no references remain.
