import { MeleeCombatMethod } from "../MeleeCombatMethod";
import { Animation } from "../../../../../model/Animation";
import { Graphic } from "../../../../../model/Graphic";
import { Priority } from "../../../../../model/Priority";
import { PendingHit } from "../../../hit/PendingHit";
import { Mobile } from "../../../../../entity/impl/Mobile";
import { CombatSpecial } from "../../../CombatSpecial";
import { HitDamage } from "../../../hit/HitDamage";
import { HitMask } from "../../../hit/HitMask";
import { Task } from "../../../../../task/Task";
import { TaskManager } from "../../../../../task/TaskManager";
import { Sounds } from "../../../../../Sounds";

export class AncientGodswordCombatMethod extends MeleeCombatMethod {
    private static readonly ANIMATION = new Animation(9171);
    private static readonly GRAPHIC = new Graphic(1211, Priority.HIGH);

    start(character: Mobile, target: Mobile): void {
        CombatSpecial.drain(character, CombatSpecial.ANCIENT_GODSWORD.getDrainAmount());
        character.performAnimation(AncientGodswordCombatMethod.ANIMATION);
        character.performGraphic(AncientGodswordCombatMethod.GRAPHIC);
        Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit: PendingHit): void {
        if (!hit.isAccurate()) {
            return;
        }

        const attacker = hit.getAttacker();
        const target = hit.getTarget();
        target.sendMessage("You have been marked for blood sacrifice.");

        TaskManager.submit(new class extends Task {
            private processed = 0;

            constructor() {
                super(1);
            }

            execute(): void {
                this.processed++;

                if (!attacker.isRegistered() || !target.isRegistered() || attacker.getHitpoints() <= 0 || target.getHitpoints() <= 0) {
                    this.stop();
                    return;
                }

                if (attacker.calculateDistance(target) >= 5) {
                    target.sendMessage("You have escaped the blood sacrifice.");
                    this.stop();
                    return;
                }

                if (this.processed >= 8) {
                    target.sendMessage("You have been sacrificed.");
                    target.performGraphic(new Graphic(377));
                    attacker.heal(25);
                    target.getCombat().getHitQueue().addPendingDamage([new HitDamage(25, HitMask.RED)]);
                    this.stop();
                }
            }
        }());
    }
}
