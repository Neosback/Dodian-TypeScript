import { MeleeCombatMethod } from "../MeleeCombatMethod";
import { Animation } from "../../../../../model/Animation";
import { Graphic } from "../../../../../model/Graphic";
import { Priority } from "../../../../../model/Priority";
import { Mobile } from "../../../../../entity/impl/Mobile";
import { CombatSpecial } from "../../../CombatSpecial";
import { PendingHit } from "../../../hit/PendingHit";
import { PrayerHandler } from "../../../../PrayerHandler";
import { CombatConstants } from "../../../CombatConstants";
import { DamageFormulas } from "../../../formula/DamageFormulas";
import { Misc } from "../../../../../../util/Misc";
import { Sounds } from "../../../../../Sounds";

export class DragonClawCombatMethod extends MeleeCombatMethod {

    private static readonly ANIMATION = new Animation(7527);
    private static readonly GRAPHIC = new Graphic(1171, Priority.HIGH);

    public hits(character: Mobile, target: Mobile): PendingHit[] {
        const hit = new PendingHit(character, target, this, {
            delay: 0,
            rollAccuracy: true,
            hitAmount: 4,
        });

        let maxHit = DamageFormulas.calculateMaxMeleeHit(character);
        if (target.getPrayerActive()[PrayerHandler.PROTECT_FROM_MELEE]) {
            const reduction = target.isNpc()
                ? CombatConstants.PRAYER_DAMAGE_REDUCTION_AGAINST_NPCS
                : CombatConstants.PRAYER_DAMAGE_REDUCTION_AGAINST_PLAYERS;
            maxHit = Math.floor(maxHit * reduction);
        }

        const roll = (min: number, max: number): number => {
            const clampedMin = Math.max(0, min);
            const clampedMax = Math.max(clampedMin, max);
            return Misc.randomInclusive(clampedMin, clampedMax);
        };

        let first = 0;
        let second = 0;
        let third = 0;
        let fourth = 0;

        if (hit.getHits()[0].getDamage() > 0) {
            first = roll(Math.round(maxHit * 0.5), maxHit - 1);
            second = Math.floor(first / 2);
            third = Math.floor(second / 2);
            fourth = third + Misc.getRandom(1);
        } else if (hit.getHits()[1].getDamage() > 0) {
            second = roll(Math.round(maxHit * (3 / 8)), Math.round(maxHit * (7 / 8)));
            third = Math.floor(second / 2);
            fourth = third + Misc.getRandom(1);
        } else if (hit.getHits()[2].getDamage() > 0) {
            third = roll(Math.round(maxHit * 0.25), Math.round(maxHit * 0.75));
            fourth = third + Misc.getRandom(1);
        } else if (hit.getHits()[3].getDamage() > 0) {
            fourth = roll(Math.round(maxHit * 0.25), Math.round(maxHit * 1.25));
        } else {
            third = Misc.getRandom(1);
            fourth = third;
        }

        hit.getHits()[0].setDamage(first);
        hit.getHits()[1].setDamage(second);
        hit.getHits()[2].setDamage(third);
        hit.getHits()[3].setDamage(fourth);
        hit.updateTotalDamage();
        return [hit];
    }

    public start(character: Mobile, target: Mobile) {
        CombatSpecial.drain(character, CombatSpecial.DRAGON_CLAWS.getDrainAmount());
        character.performAnimation(DragonClawCombatMethod.ANIMATION);
        character.performGraphic(DragonClawCombatMethod.GRAPHIC);
        Sounds.sendSound(character, character.getAttackSound());
    }
}
