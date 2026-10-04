import { Task } from "../Task";
import { Mobile } from "../../entity/impl/Mobile";
import { CombatSpecial } from "../../content/combat/CombatSpecial";
import { Equipment } from "../../model/container/impl/Equipment";
import { GameConstants } from "../../GameConstants";
import { ItemIdentifiers } from "../../../util/ItemIdentifiers";

const DEFAULT_RESTORE_DELAY_TICKS = 50;
const LIGHTBEARER_RESTORE_DELAY_TICKS = 25;
const TICK_RATE_MS = Number(GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE ?? 600);

function resolveRestoreDelayTicks(character: Mobile): number {
    if (!character?.isPlayer?.()) {
        return DEFAULT_RESTORE_DELAY_TICKS;
    }
    const ringId = character
        .getAsPlayer()
        .getEquipment()
        .get(Equipment.RING_SLOT)
        ?.getId?.();
    return ringId === ItemIdentifiers.LIGHTBEARER
        ? LIGHTBEARER_RESTORE_DELAY_TICKS
        : DEFAULT_RESTORE_DELAY_TICKS;
}

function ticksToSeconds(delayTicks: number): number {
    return Math.max(1, Math.ceil((Math.max(1, delayTicks) * TICK_RATE_MS) / 1000));
}

function secondsToTicks(seconds: number, character: Mobile): number {
    const normalizedSeconds = Math.max(0, Number(seconds ?? 0));
    if (normalizedSeconds <= 0) {
        return resolveRestoreDelayTicks(character);
    }
    return Math.max(1, Math.ceil((normalizedSeconds * 1000) / TICK_RATE_MS));
}

export class RestoreSpecialAttackTask extends Task {
    constructor(private character: Mobile, initialDelayTicks?: number) {
    const restoreDelayTicks = resolveRestoreDelayTicks(character);
    const firstDelayTicks = Math.max(1, Number(initialDelayTicks ?? restoreDelayTicks));
    super(firstDelayTicks);
    this.setDelay(restoreDelayTicks);
    this.character = character;
    character.setRecoveringSpecialAttack(true);
    if (character.isPlayer()) {
        character.getAsPlayer().getSpecialAttackRestore().start(ticksToSeconds(firstDelayTicks));
    }
    }
    
    public execute() {
        if (this.character == null || !this.character.isRegistered() || this.character.getSpecialPercentage() >= 100 || !this.character.isRecoveringSpecialAttack()) {
            this.character.setRecoveringSpecialAttack(false);
            if (this.character?.isPlayer?.()) {
                this.character.getAsPlayer().getSpecialAttackRestore().stop();
            }
            this.stop();
            return;
        }
        let amount = this.character.getSpecialPercentage() + 10;
        if (amount >= 100) {
            amount = 100;
            this.character.setRecoveringSpecialAttack(false);
            if (this.character.isPlayer()) {
                this.character.getAsPlayer().getSpecialAttackRestore().stop();
            }
            this.stop();
        }
        this.character.setSpecialPercentage(amount);
        const nextDelayTicks = resolveRestoreDelayTicks(this.character);
        this.setDelay(nextDelayTicks);
        if (this.character.isPlayer() && this.character.getSpecialPercentage() < 100) {
            this.character.getAsPlayer().getSpecialAttackRestore().start(ticksToSeconds(nextDelayTicks));
        }
    
        if (this.character.isPlayer()) {
            let player = this.character.getAsPlayer();
            CombatSpecial.updateBar(player);
        }
    }

    public static initialDelayTicksFromSeconds(seconds: number, character: Mobile): number {
        return secondsToTicks(seconds, character);
    }
}
