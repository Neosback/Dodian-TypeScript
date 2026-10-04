import { RegionManager } from "../../../../../collision/RegionManager";
import { DuelRule } from "../../../../Duelling";
import { CombatFactory } from "../../../CombatFactory";
import { CombatSpecial } from "../../../CombatSpecial";
import { CombatMethod } from "../../CombatMethod";
import { CombatType } from "../../../CombatType";
import { PendingHit } from "../../../hit/PendingHit";
import { Mobile } from "../../../../../entity/impl/Mobile";
import { Animation } from "../../../../../model/Animation";
import { Direction } from "../../../../../model/Direction";
import { Graphic } from "../../../../../model/Graphic";
import { GraphicHeight } from "../../../../../model/GraphicHeight";
import { Sound } from "../../../../../Sound";
import { Sounds } from "../../../../../Sounds";
import { Task } from "../../../../../task/Task";
import { TaskManager } from "../../../../../task/TaskManager";
import { TimerKey } from "../../../../../../util/timers/TimerKey";

export class ShoveCombatMethod extends CombatMethod {
    private static readonly ANIMATION = new Animation(1064);
    private static readonly GRAPHIC = new Graphic(263, GraphicHeight.HIGH);
    private static readonly STUN_ANIMATION = new Animation(424);

    hits(character: Mobile, target: Mobile): PendingHit[] {
        return null;
    }

    start(character: Mobile, target: Mobile): void {
        // Also blocked during the 1-tick grace period after a stun wears
        // off (see CombatFactory.stun) - Shove can't land on the same
        // target more than once every 6 ticks. Checked here, before any
        // energy/animation/sound, so a blocked Shove doesn't waste the
        // special attack.
        if (target.getTimers().has(TimerKey.STUN) || target.getTimers().has(TimerKey.STUN_IMMUNITY)) {
            return;
        }

        if (character.isPlayer()) {
            const player = character.getAsPlayer();
            if (player.getDueling().inDuel() && player.getDueling().getRules()[DuelRule.NO_MOVEMENT.getButtonId()]) {
                player.sendMessage("This weapon's special attack cannot be used in this duel.");
                return;
            }
        }

        if (target.getSize() > 1) {
            character.sendMessage("That creature is too large to knock back!");
            return;
        }

        CombatSpecial.drain(character, CombatSpecial.SHOVE_SPECIAL.getDrainAmount());
        character.performAnimation(ShoveCombatMethod.ANIMATION);
        character.performGraphic(ShoveCombatMethod.GRAPHIC);
        Sounds.sendSound(character, Sound.DRAGON_SPEAR_SPECIAL);
        target.performAnimation(ShoveCombatMethod.STUN_ANIMATION);
        CombatFactory.stun(target, 3, true);
        target.getTimers().registers(TimerKey.FREEZE_IMMUNITY, 10);

        const direction = ShoveCombatMethod.getDirection(character, target);
        if (direction != null) {
            const destination = target.getLocation().transform(direction.getX(), direction.getY());
            if (RegionManager.canMovestart(target.getLocation(), destination, 1, 1, target.getPrivateArea())) {
                TaskManager.submit(new class extends Task {
                    constructor() {
                        super(1);
                    }

                    execute(): void {
                        if (!target.isRegistered()) {
                            this.stop();
                            return;
                        }
                        target.setLocation(destination);
                        target.setWalkingDirection(direction);
                        if (target.isPlayer()) {
                            target.getMovementQueue().handleRegionChange();
                        }
                        this.stop();
                    }
                }());
            }
        }

        // Shove's own attack speed is 1 tick slower than the weapon's normal
        // speed (5 ticks vs. the spear's normal 4), not the weapon's base speed.
        character.getCombat().setAttackDelay(character.getBaseAttackSpeed() + 1);
        character.setSpecialActivated(false);
        if (character.isPlayer()) {
            CombatSpecial.updateBar(character.getAsPlayer());
        }
    }

    type(): CombatType {
        return CombatType.MELEE;
    }

    private static getDirection(character: Mobile, target: Mobile): Direction | null {
        const dx = Math.sign(target.getLocation().getX() - character.getLocation().getX());
        const dy = Math.sign(target.getLocation().getY() - character.getLocation().getY());
        if (dx === 0 && dy === 0) {
            return null;
        }
        return Direction.fromDeltas(dx, dy);
    }
}
