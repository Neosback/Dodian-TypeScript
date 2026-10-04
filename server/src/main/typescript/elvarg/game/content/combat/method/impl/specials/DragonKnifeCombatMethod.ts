import { RangedCombatMethod } from "../RangedCombatMethod";
import { Animation } from "../../../../../model/Animation";
import { PendingHit } from "../../../hit/PendingHit";
import { Mobile } from "../../../../../entity/impl/Mobile";
import { CombatSpecial } from "../../../CombatSpecial";
import { Projectile } from "../../../../../model/Projectile";
import { ItemIdentifiers } from "../../../../../../util/ItemIdentifiers";
import { Equipment } from "../../../../../model/container/impl/Equipment";
import { Sound } from "../../../../../Sound";
import { Sounds } from "../../../../../Sounds";
import { CombatFactory } from "../../../CombatFactory";
import { WeaponProfiles } from "../../../WeaponProfile";

export class DragonKnifeCombatMethod extends RangedCombatMethod {
    private static readonly ANIMATION = new Animation(8292);
    private static readonly SPECIAL_AMMO_COST = 2;

    hits(character: Mobile, target: Mobile): PendingHit[] {
        const distance = character.getLocation().getDistance(target.getLocation());
        const hitDelay = WeaponProfiles.hitDelays(character.getAsPlayer(), distance)[0];
        return [
            new PendingHit(character, target, this, hitDelay),
            new PendingHit(character, target, this, hitDelay)
        ];
    }

    canAttack(character: Mobile, target: Mobile): boolean {
        if (!character.isPlayer()) {
            return false;
        }
        const player = character.getAsPlayer();
        const weaponId = player.getEquipment().get(Equipment.WEAPON_SLOT).getId();
        if (!(weaponId === ItemIdentifiers.DRAGON_KNIFE
            || weaponId === ItemIdentifiers.DRAGON_KNIFE_P_
            || weaponId === ItemIdentifiers.DRAGON_KNIFE_P_PLUS_
            || weaponId === ItemIdentifiers.DRAGON_KNIFE_P_PLUS_PLUS_)) {
            return false;
        }
        return CombatFactory.checkAmmo(player, DragonKnifeCombatMethod.SPECIAL_AMMO_COST);
    }

    start(character: Mobile, target: Mobile): void {
        const player = character.getAsPlayer();
        CombatSpecial.drain(player, CombatSpecial.DRAGON_KNIFE.getDrainAmount());
        player.performAnimation(DragonKnifeCombatMethod.ANIMATION);
        Sounds.sendSound(character, Sound.THROW_DART);
        Projectile.createProjectile(character, target, 1629, 30, 60, 40, 36).sendProjectile();
        Projectile.createProjectile(character, target, 1629, 26, 64, 43, 36).sendProjectile();
        CombatFactory.decrementAmmo(player, target.getLocation(), DragonKnifeCombatMethod.SPECIAL_AMMO_COST);
    }
}
