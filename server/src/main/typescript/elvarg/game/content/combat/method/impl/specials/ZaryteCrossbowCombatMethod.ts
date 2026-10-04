import { RangedCombatMethod } from "../RangedCombatMethod";
import { Animation } from "../../../../../model/Animation";
import { PendingHit } from "../../../hit/PendingHit";
import { Mobile } from "../../../../../entity/impl/Mobile";
import { CombatSpecial } from "../../../CombatSpecial";
import { RangedWeapon } from "../../../ranged/RangedData";
import { CombatFactory } from "../../../CombatFactory";
import { Projectile } from "../../../../../model/Projectile";
import { Sound } from "../../../../../Sound";
import { Sounds } from "../../../../../Sounds";

export class ZaryteCrossbowCombatMethod extends RangedCombatMethod {
    private static readonly ANIMATION = new Animation(9166);

    hits(character: Mobile, target: Mobile): PendingHit[] {
        return [new PendingHit(character, target, this, 2)];
    }

    canAttack(character: Mobile, target: Mobile): boolean {
        if (!character.isPlayer()) {
            return false;
        }
        const player = character.getAsPlayer();
        if (player.getCombat().getRangedWeapon() !== RangedWeapon.ZARYTE_CROSSBOW) {
            return false;
        }
        return CombatFactory.checkAmmo(player, 1);
    }

    start(character: Mobile, target: Mobile): void {
        const player = character.getAsPlayer();
        CombatSpecial.drain(player, CombatSpecial.ZARYTE_CROSSBOW.getDrainAmount());
        player.performAnimation(ZaryteCrossbowCombatMethod.ANIMATION);
        Sounds.sendSound(character, Sound.SHOOT_CROSSBOW);
        Projectile.createProjectile(character, target, 301, 44, 35, 50, 70).sendProjectile();
        CombatFactory.decrementAmmo(player, target.getLocation(), 1);
    }
}
