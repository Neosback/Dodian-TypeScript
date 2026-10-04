import { RangedCombatMethod } from "../RangedCombatMethod";
import { Animation } from "../../../../../model/Animation";
import { Priority } from "../../../../../model/Priority";
import { PendingHit } from "../../../hit/PendingHit";
import { Mobile } from "../../../../../entity/impl/Mobile";
import { CombatSpecial } from "../../../CombatSpecial";
import { RangedWeapon } from "../../../ranged/RangedData";
import { CombatFactory } from "../../../CombatFactory";
import { Projectile } from "../../../../../model/Projectile";
import { Sound } from "../../../../../Sound";
import { Sounds } from "../../../../../Sounds";
import { WeaponProfiles } from "../../../WeaponProfile";

export class BallistaCombatMethod extends RangedCombatMethod {

    private static readonly ANIMATION = new Animation(7222);

    hits(character: Mobile, target: Mobile): PendingHit[] {
        const distance = character.getLocation().getDistance(target.getLocation());
        const delay = WeaponProfiles.hitDelays(character.getAsPlayer(), distance)[0];
        return [new PendingHit(character, target, this, delay)];
    }

    canAttack(character: Mobile, target: Mobile): boolean {
        if (!character.isPlayer()) {
            return false;
        }
        const player = character.getAsPlayer();
        if (player.getCombat().getRangedWeapon() !== RangedWeapon.BALLISTA) {
            return false;
        }
        if (!CombatFactory.checkAmmo(player, 1)) {
            return false;
        }
        return true;
    }

    start(character: Mobile, target: Mobile): void {
        const player = character.getAsPlayer();
        CombatSpecial.drain(player, CombatSpecial.BALLISTA.getDrainAmount());
        character.performAnimation(BallistaCombatMethod.ANIMATION);
        Sounds.sendSound(character, Sound.SHOOT_CROSSBOW);
        Projectile.createProjectile(player, target, 1301, 70, 30, 43, 31).sendProjectile();
        CombatFactory.decrementAmmo(player, target.getLocation(), 1);
    }
}
