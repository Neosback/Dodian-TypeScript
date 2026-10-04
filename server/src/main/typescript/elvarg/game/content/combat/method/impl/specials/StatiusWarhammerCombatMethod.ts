import { MeleeCombatMethod } from "../MeleeCombatMethod";
import { Animation } from "../../../../../model/Animation";
import { PendingHit } from "../../../hit/PendingHit";
import { Mobile } from "../../../../../entity/impl/Mobile";
import { CombatSpecial } from "../../../CombatSpecial";
import { Skill } from "../../../../../model/Skill";
import { DamageFormulas } from "../../../formula/DamageFormulas";
import { Misc } from "../../../../../../util/Misc";
import { Sounds } from "../../../../../Sounds";

export class StatiusWarhammerCombatMethod extends MeleeCombatMethod {
    private static readonly ANIMATION = new Animation(1378);

    hits(character: Mobile, target: Mobile): PendingHit[] {
        const hit = new PendingHit(character, target, this);
        if (hit.isAccurate()) {
            const maxHit = DamageFormulas.calculateMaxMeleeHit(character);
            const lowerRoll = Math.floor(0.25 * maxHit);
            const upperRoll = maxHit + lowerRoll;
            hit.setTotalDamage(Misc.randomInclusive(lowerRoll, upperRoll));
        }
        return [hit];
    }

    start(character: Mobile, target: Mobile): void {
        CombatSpecial.drain(character, CombatSpecial.STATIUS_WARHAMMER.getDrainAmount());
        character.performAnimation(StatiusWarhammerCombatMethod.ANIMATION);
        Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit: PendingHit): void {
        if (!hit.isAccurate() || hit.getTotalDamage() <= 0 || !hit.getTarget().isPlayer()) {
            return;
        }

        const target = hit.getTarget().getAsPlayer();
        const currentDefence = target.getSkillManager().getCurrentLevel(Skill.DEFENCE);
        target.getSkillManager().setCurrentLevels(Skill.DEFENCE, Math.max(1, Math.floor(currentDefence * 0.7)));
    }
}
