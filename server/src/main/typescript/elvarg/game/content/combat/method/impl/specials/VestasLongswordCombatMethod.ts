import { MeleeCombatMethod } from "../MeleeCombatMethod";
import { Animation } from "../../../../../model/Animation";
import { PendingHit } from "../../../hit/PendingHit";
import { Mobile } from "../../../../../entity/impl/Mobile";
import { CombatSpecial } from "../../../CombatSpecial";
import { DamageFormulas } from "../../../formula/DamageFormulas";
import { Misc } from "../../../../../../util/Misc";
import { Sounds } from "../../../../../Sounds";

export class VestasLongswordCombatMethod extends MeleeCombatMethod {
    private static readonly ANIMATION = new Animation(8145);

    hits(character: Mobile, target: Mobile): PendingHit[] {
        const hit = new PendingHit(character, target, this);
        if (hit.isAccurate()) {
            const maxHit = DamageFormulas.calculateMaxMeleeHit(character);
            const lowerRoll = Math.floor(0.2 * maxHit);
            const upperRoll = maxHit + lowerRoll;
            hit.setTotalDamage(Misc.randomInclusive(lowerRoll, upperRoll));
        }
        return [hit];
    }

    start(character: Mobile, target: Mobile): void {
        CombatSpecial.drain(character, CombatSpecial.VESTAS_LONGSWORD.getDrainAmount());
        character.performAnimation(VestasLongswordCombatMethod.ANIMATION);
        Sounds.sendSound(character, character.getAttackSound());
    }
}
