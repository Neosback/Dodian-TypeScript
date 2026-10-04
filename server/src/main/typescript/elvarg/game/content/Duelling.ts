import type { Player } from "../entity/impl/player/Player";
import { SecondsTimer } from "../model/SecondsTimer";
import { Equipment } from "../model/container/impl/Equipment";

// Shared state consumed by combat/movement. DuelArena.plugin.js owns the gameplay.
export class Dueling {
    private state = DuelState.NONE;
    private interact: Player | null = null;
    private rules: boolean[] = Array(28).fill(false);
    private buttonDelay = new SecondsTimer();

    constructor(_player: Player) {}
    getState(): DuelState { return this.state; }
    setState(state: DuelState): void { this.state = state; }
    getInteract(): Player | null { return this.interact; }
    setInteract(player: Player | null): void { this.interact = player; }
    getRules(): boolean[] { return this.rules; }
    getButtonDelay(): SecondsTimer { return this.buttonDelay; }
    inDuel(): boolean { return this.state === DuelState.STARTING_DUEL || this.state === DuelState.IN_DUEL; }
}

export class DuelRule {
    public static readonly NO_RANGED = new DuelRule(4, -1);
    public static readonly NO_MELEE = new DuelRule(5, -1);
    public static readonly NO_MAGIC = new DuelRule(6, -1);
    public static readonly NO_SPECIAL_ATTACKS = new DuelRule(13, -1);
    public static readonly LOCK_WEAPON = new DuelRule(2, -1);
    public static readonly NO_FORFEIT = new DuelRule(0, -1);
    public static readonly NO_POTIONS = new DuelRule(7, -1);
    public static readonly NO_FOOD = new DuelRule(8, -1);
    public static readonly NO_PRAYER = new DuelRule(9, -1);
    public static readonly NO_MOVEMENT = new DuelRule(1, -1);
    public static readonly FUN_WEAPONS = new DuelRule(12, -1);
    public static readonly SHOW_INVENTORIES = new DuelRule(3, -1);

    public static readonly NO_HELM = new DuelRule(14, Equipment.HEAD_SLOT);
    public static readonly NO_CAPE = new DuelRule(15, Equipment.CAPE_SLOT);
    public static readonly NO_AMULET = new DuelRule(16, Equipment.AMULET_SLOT);
    public static readonly NO_AMMUNITION = new DuelRule(27, Equipment.AMMUNITION_SLOT);
    public static readonly NO_WEAPON = new DuelRule(17, Equipment.WEAPON_SLOT);
    public static readonly NO_BODY = new DuelRule(18, Equipment.BODY_SLOT);
    public static readonly NO_SHIELD = new DuelRule(19, Equipment.SHIELD_SLOT);
    public static readonly NO_LEGS = new DuelRule(21, Equipment.LEG_SLOT);
    public static readonly NO_RING = new DuelRule(26, Equipment.RING_SLOT);
    public static readonly NO_BOOTS = new DuelRule(24, Equipment.FEET_SLOT);
    public static readonly NO_GLOVES = new DuelRule(23, Equipment.HANDS_SLOT);

    constructor(private bit: number, private equipmentSlot: number) {}
    // Existing combat callers use this accessor as the rule-array index.
    getButtonId(): number { return this.bit; }
    getConfigId(): number { return 1 << this.bit; }
    getEquipmentSlot(): number { return this.equipmentSlot; }
}

export enum DuelState {
    NONE, REQUESTED_DUEL, DUEL_SCREEN, ACCEPTED_DUEL_SCREEN, CONFIRM_SCREEN, ACCEPTED_CONFIRM_SCREEN, STARTING_DUEL, IN_DUEL
}
