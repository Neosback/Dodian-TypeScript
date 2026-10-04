# OSRS Combat Gap Analysis — elvarg-web-server vs xrsps-typescript

**Purpose:** xrsps-typescript's combat engine (`server/src/game/combat/**`) is explicitly written
to RSMod/OSRS-Wiki-verified formulas ("RSMod parity" comments throughout) and is treated as the
accuracy reference. This doc tracks what elvarg-web-server needs to fix or add to reach the same
level of 1:1 OSRS combat accuracy. Generated 2026-08-10 via full-codebase review of both repos.
Update checkboxes as items are ported/fixed; re-run a review pass periodically rather than trusting
this doc forever, since both codebases will move.

Baseline: elvarg-web-server's core roll/damage formulas (melee/ranged/magic max hit, attack/defence
rolls, hit chance, magic 70/30 defence blend, protection prayer 40%/100% reduction, prayer drain
resistance) are already structurally correct and match xrsps/OSRS. The gaps below are specific,
not systemic.

---

## Tier 1 — Correctness bugs (wrong behavior today, not just "missing")

- [ ] **Venom is implemented as decaying poison, not increasing venom.** `task/impl/CombatPoisonEffect.ts`
  treats `PoisonType.VENOM` with the same `severity - 1` decay curve as ordinary poison, starting at
  fixed severity 12. Real OSRS venom *increases* over time (starts at 6, +2 per stack, capped at 20)
  and doesn't decay by itself. xrsps's `PoisonVenomSystem.ts` implements this correctly (increasing,
  capped at 20). Needs a dedicated venom code path, not a poison-table variant.
- [ ] **Abyssal tentacle incorrectly flagged as a venom weapon** (`CombatPoisonData` maps
  `ABYSSAL_TENTACLE → PoisonType.VENOM`). It has no poison/venom effect in OSRS — remove the mapping.
- [ ] **Verac's "ignore defence" proc RNG is inconsistent between two call sites** — one uses
  `Misc.randomInclusive(0,3)===0` (correct 25%), the other (`CombatFactory.getHitDamage`'s protection-prayer
  bypass check) uses `Misc.getRandom(4)==1` which is actually 1-in-5 (20%) since `getRandom(n)` is
  inclusive of `n`. Both should be the same 1-in-4 proc.
- [ ] **Bandos godsword special hardcodes the drained skill** (`skillDrain = 1` always) instead of
  OSRS's real mechanic: randomly selects one of Attack/Strength/Defence/Ranged/Magic to drain, scaled
  off the target's Defence level.
- [ ] **Obsidian set bonus checks the wrong item and is incomplete.** `ObsidianArmour.js` checks for
  item id `11128` (Berserker necklace) rather than the actual obsidian armour set (helm/top/legs), and
  only grants the damage bonus — not the +10% accuracy the real set bonus also gives. The necklace+weapon
  damage combo and the armour-set accuracy/damage bonus are two separate OSRS effects that need modeling
  separately (xrsps's `EquipmentBonuses.ts` does this split correctly: obsidian set +10%/10%, Berserker
  necklace +20% dmg on obsidian weapons only).
- [ ] **Trident of the Seas / Trident of the Swamp have no charge economy at all** —
  `itemsRequired`/`equipmentRequired` both return `null` in `CombatSpells.ts`, so it casts for free,
  infinitely. Every other charge-based item in the codebase (blowpipe, crystal bow) has real resource
  tracking; the tridents don't. Needs charge/coin (or swamp-tar/kraken-tentacle-equivalent) consumption
  wired the same way.
- [ ] **Ruby bolt special effect is an empty stub.** `RangedData.ts` has a `// Todo: ENCHANTED_RUBY_BOLT`
  and the switch case is empty — the 1-in-10 proc that deals `min(20% of target's current HP, 100)`
  typeless damage is entirely missing, while every sibling enchanted bolt (diamond, dragon, emerald,
  jade, onyx, pearl, sapphire, topaz, opal) is implemented. xrsps's `AmmoSystem.ts` has the full table
  including dragon-bolt-boosted variants.

## Tier 2 — Missing or unverified OSRS mechanics

- [ ] **No PID (attack-priority) system for simultaneous same-tick hits.** No PID/attack-priority
  resolution exists anywhere in elvarg's combat/NPC code — `HitQueue` orders purely by scheduled reveal
  tick + insertion order. xrsps has an explicit per-session randomized `pidPriority` used to sort
  same-tick action ordering (`player.ts`, `TickPhaseService.ts`). This matters for multi-combat tick-eating
  and PK interactions. Needs a real per-entity PID assigned on login/spawn and used as the tie-break.
- [ ] **Dragon hunter gear bonuses (lance / crossbow / mace) are stubbed out, never wired.**
  `DamageFormulas.ts` and `AccuracyFormulasDpsCalc.ts` both have commented-out dragon-hunter multiplier
  code (`// if (dragonHunter(input)) rngStrength *= 1.3`) with no plugin filling the gap. xrsps has
  DHL +20%/+20% and DHCB +30% acc/+25% dmg vs draconic targets fully implemented.
- [ ] **NPCs have no stab/slash/crush differentiation for melee accuracy or defence.** Elvarg's
  `attackMeleeRoll`/`defenseMeleeRoll` explicitly comment "NPCs don't currently have stab/slash/crush
  bonuses" — NPC attack roll is a flat `×64` and NPC defence bonuses per style are hardcoded to 0.
  Real OSRS NPCs have differentiated per-style attack/defence bonuses (this is why certain weapon
  choices matter against certain monsters). Confirm whether xrsps's NPC combat profile
  (`buildNpcAttackProfile` in `CombatHitEvaluator.ts`) models this per-style, and port the NPC bonus
  data if so.
- [ ] **Kodai wand (and Staff of the Dead family) only apply a magic damage bonus, not the matching
  accuracy bonus.** `MagicStaves.js` registers `registerMagicHitModifier` but never
  `registerMagicAttackAccuracyModifier`. In OSRS, Kodai wand grants both +15% damage and +15% accuracy.
- [ ] **Prayer-flicking correctness — verify the 1-tick delayed drain start is implemented.** xrsps's
  `PrayerDrainProcessor.ts` explicitly delays the start of prayer drain by 1 tick after activation,
  which is what makes prayer flicking (toggling on/off within a tick to avoid drain) work correctly.
  Elvarg's `PrayerHandler.processDrain` needs to be checked against this — if drain starts immediately
  on activation, flicking will behave wrong.
- [ ] **Elemental spell family tiering — verify "cast the weak one, hit like the strongest unlocked
  one" behavior.** xrsps's `ElementalSpellMaxHit.ts` explicitly implements the real (and commonly
  missed) OSRS mechanic where casting e.g. Fire Strike with Fire Wave unlocked uses Fire Wave's max
  hit, not Fire Strike's own. Elvarg's `CombatSpells.ts` appears to use each spell's own
  `maximumHit()` directly — confirm and port the family-tier lookup if missing.
- [ ] **Freeze duration halving under Protect from Magic — verify presence.** xrsps notes half-duration
  freezes when the target has an active protection prayer. Confirm this is (or isn't) real OSRS
  behavior for the specific spellbook/context in question before porting — flagged for verification,
  not a confirmed bug.

## Tier 3 — Content breadth gaps (structurally fine, just incomplete data)

- [ ] **Special attack coverage is far behind.** elvarg implements ~28 special-attack weapons;
  xrsps implements ~86, including essentially the full modern OSRS meta: Voidwaker, Osmumten's fang,
  Noxious halberd, Elder maul, Emberlight, Eye of Ayak, Blue moon spear, Purging staff, Webweaver bow,
  Sunspear, Soulflame horn, Tonalztics of Ralos, Keris partisan (+ of corruption/of the sun variants),
  Dual macuahuitl, Burning claws, Dawnbringer, Eldritch nightmare/Volatile nightmare staff, Staff of
  balance, Rune claws, Crimson kisten (zombie axe), Excalibur, Seercull, Dorgeshuun crossbow, and more.
  This is the single largest quantifiable gap. Suggest porting in priority order of what's actually
  used/farmable content in your server, not alphabetically.
- [ ] **Equipment/set-effect bonus breadth needs auditing.** xrsps's `EquipmentBonuses.ts` (719 lines)
  covers Salve amulet(e/ei) with correct 1.2 vs 7/6 tiering and the task-priority-vs-Salve(e) exception,
  Inquisitor's armour (crush-only, per-piece + set bonus), Crystal armour (per-piece + set bonus,
  including Bow of Faerdhinen), Arclight/Darklight (+70%/+60% vs demons), Keris (1/51 proc for 3x vs
  kalphites), Slayer helm (imbued vs non-imbued tiers), Tome of Fire, Smoke staff, Chaos gauntlets,
  Tumeken's Shadow (3x/4x ToA). None of these were surfaced in elvarg's `EquipmentEffects`/plugins
  review except Void, Obsidian, Dharok's, and generic magic staff damage — audit which of the above
  are actually present in elvarg vs entirely absent, then port missing ones.
- [ ] **Multi-combat / boss-arena zone coverage is likely thinner.** xrsps has explicit named zone
  rectangles for ToB, ToA, CoX, Nightmare, Corp, GWD, DKs, Giant Mole, KQ, KBD, Vorkath, on top of the
  wilderness multi-zone list, plus PvP-area/LMS detection scaffolding. elvarg's multi-combat handling
  is a simpler `Wilderness.MULTI` boundary list + `AreaManager.inMulti()`. Fine if your server doesn't
  run those raids/bosses yet — becomes a real gap the moment it does.
- [ ] **No generalized boss phase/mechanic scripting framework.** xrsps has `BossScriptFramework.ts`
  (phases, HP-threshold transitions, cooldown-gated specials, telegraphs) as a reusable base that
  concrete bosses build on. elvarg's bosses (Jad, Vétion, Venenatis, Bandit, plus JS boss plugins for
  Callisto/Chaos Elemental/Chaos Fanatic/Crazy Archaeologist/KBD/Elvarg/Count Draynor) are each
  hand-rolled independently. Not a bug, but worth considering before porting many more bosses — a
  shared framework will save time and reduce mechanic-implementation drift.

## Tier 4 — Cleanup (low priority, don't block on these)

- [ ] Dead constants `PRAYER_ACCURACY_REDUCTION_AGAINST_PLAYERS`/`_NPCS` in `CombatConstants.ts` are
  declared but never referenced anywhere — remove, or confirm they're not meant to be wired up as a
  leftover pre-2023-prayer-rework mechanic.
- [ ] `VetionCombatMethod` implements the `CombatMethod` interface directly instead of extending
  the abstract base class every other combat method uses — future abstract-method additions to
  `CombatMethod` won't be enforced here the same way.
- [ ] Stale `// TODO - Populate ___ map` comments in `RangedData.ts` and `PrayerHandler.ts` — the maps
  are actually populated below the comment in both cases; just leftover documentation, but worth
  deleting so they don't mislead the next person (or agent) reading the file.

---

## Notes for continuing the port

- xrsps's formula layer is intentionally written against RSMod source references and cites the OSRS
  Wiki mechanics pages in comments — when porting a formula, prefer copying its exact integer math
  over re-deriving it, since integer floor/rounding order matters for exact-hit-number parity.
- Cross-check every "Tier 3" content item against what your server actually needs before porting —
  no point implementing ToA zone data or Elder maul specs if that content isn't live yet. Tier 1 and
  Tier 2 are worth fixing regardless of current content scope, since they affect core combat that's
  already live.
