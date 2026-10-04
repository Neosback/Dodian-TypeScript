import { RangedCombatMethod } from "../RangedCombatMethod";
import { Animation } from "../../../../../model/Animation";
import { PendingHit } from "../../../hit/PendingHit";
import { Mobile } from "../../../../../entity/impl/Mobile";
import { CombatSpecial } from "../../../CombatSpecial";
import { Projectile } from "../../../../../model/Projectile";
import { ItemIdentifiers } from "../../../../../../util/ItemIdentifiers";
import { Equipment } from "../../../../../model/container/impl/Equipment";
import { Item } from "../../../../../model/Item";
import { WeaponInterfaceManager } from "../../../WeaponInterfaceManager";
import { Flag } from "../../../../../model/Flag";
import { Task } from "../../../../../task/Task";
import { TaskManager } from "../../../../../task/TaskManager";
import { HitDamage } from "../../../hit/HitDamage";
import { HitMask } from "../../../hit/HitMask";
import { Sound } from "../../../../../Sound";
import { Sounds } from "../../../../../Sounds";
import { WeaponProfiles } from "../../../WeaponProfile";

export class MorrigansJavelinCombatMethod extends RangedCombatMethod {
    private static readonly ANIMATION = new Animation(806);
    private static readonly BLEED_TASK_KEY_ATTRIBUTE = "combat:bleed:taskKey";

    hits(character: Mobile, target: Mobile): PendingHit[] {
        const distance = character.getLocation().getDistance(target.getLocation());
        const hitDelay = WeaponProfiles.hitDelays(character.getAsPlayer(), distance)[0];
        return [new PendingHit(character, target, this, hitDelay)];
    }

    canAttack(character: Mobile, target: Mobile): boolean {
        if (!character.isPlayer() || !target.isPlayer()) {
            return false;
        }
        return character.getAsPlayer().getEquipment().get(Equipment.WEAPON_SLOT).getId() === ItemIdentifiers.MORRIGANS_JAVELIN;
    }

    start(character: Mobile, target: Mobile): void {
        const player = character.getAsPlayer();
        CombatSpecial.drain(player, CombatSpecial.MORRIGANS_JAVELIN.getDrainAmount());
        player.performAnimation(MorrigansJavelinCombatMethod.ANIMATION);
        Sounds.sendSound(character, Sound.THROW_DART);
        Projectile.createProjectile(character, target, 1622, 30, 60, 40, 36).sendProjectile();
        MorrigansJavelinCombatMethod.decrementThrownWeapon(player, 1);
    }

    handleAfterHitEffects(hit: PendingHit): void {
        const target = hit.getTarget();
        const existingTaskKey = target?.isPlayer?.() ? target.getAsPlayer().getAttribute?.(MorrigansJavelinCombatMethod.BLEED_TASK_KEY_ATTRIBUTE) : null;
        if (existingTaskKey) {
            TaskManager.cancelTasks(existingTaskKey);
        }
        const bleedTaskKey = {};
        if (target?.isPlayer?.()) {
            target.getAsPlayer().setAttribute?.(MorrigansJavelinCombatMethod.BLEED_TASK_KEY_ATTRIBUTE, bleedTaskKey);
        }

        TaskManager.submit(new class extends Task {
            private processed = 0;
            private first = true;
            private dealt = 0;

            constructor() {
                super(1, bleedTaskKey);
            }

            execute(): void {
                const attacker = hit.getAttacker();
                const target = hit.getTarget();
                if (!attacker.isRegistered() || !target.isRegistered() || attacker.getHitpoints() <= 0 || target.getHitpoints() <= 0) {
                    if (target?.isPlayer?.()) {
                        target.getAsPlayer().setAttribute?.(MorrigansJavelinCombatMethod.BLEED_TASK_KEY_ATTRIBUTE, null);
                    }
                    this.stop();
                    return;
                }

                this.processed++;
                if (this.processed % 3 !== 0) {
                    return;
                }

                const damageToDeal = Math.min(5, hit.getTotalDamage() - this.dealt);
                if (damageToDeal <= 0) {
                    if (target?.isPlayer?.()) {
                        target.getAsPlayer().setAttribute?.(MorrigansJavelinCombatMethod.BLEED_TASK_KEY_ATTRIBUTE, null);
                    }
                    this.stop();
                    return;
                }

                this.dealt += damageToDeal;
                target.getCombat().getHitQueue().addPendingDamage([new HitDamage(damageToDeal, HitMask.RED)]);
                target.sendMessage(this.first
                    ? "You start to bleed as a result of the javelin strike."
                    : "You continue to bleed as a result of the javelin strike.");
                this.first = false;
            }
        }());
    }

    private static decrementThrownWeapon(player: any, amount: number): void {
        const item = player.getEquipment().get(Equipment.WEAPON_SLOT);
        item.decrementAmountBy(amount);

        if (item.getAmount() <= 0) {
            player.sendMessage("You have run out of ammunition!");
            player.getEquipment().set(Equipment.WEAPON_SLOT, new Item(-1));
            WeaponInterfaceManager.assign(player);
            player.getUpdateFlag().flag(Flag.APPEARANCE);
        }

        player.getEquipment().refreshItems();
    }
}
