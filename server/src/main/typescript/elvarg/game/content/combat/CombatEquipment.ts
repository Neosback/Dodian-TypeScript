import type { Player } from "../../entity/impl/player/Player";
// Avoid importing Equipment to dodge bootstrap cycles; use slot ids directly.
const HEAD_SLOT = 0;
const CAPE_SLOT = 1;
const AMULET_SLOT = 2;
const WEAPON_SLOT = 3;
const BODY_SLOT = 4;
const SHIELD_SLOT = 5;
const LEG_SLOT = 7;
const HANDS_SLOT = 9;
const FEET_SLOT = 10;
import { CombatType } from "./CombatType";
import { ItemIdentifiers } from "../../../util/ItemIdentifiers";
export class CombatEquipment {
    public static readonly MAGE_VOID_HELM = 11663;
    public static readonly RANGED_VOID_HELM = 11664;
    public static readonly MELEE_VOID_HELM = 11665;
    public static readonly VOID_ARMOUR: [number, number][] = [
        [BODY_SLOT, 8839],
        [LEG_SLOT, 8840],
        [HANDS_SLOT, 8842],
    ];
    public static readonly ELITE_VOID_ARMOUR: [number, number][] = [
        [BODY_SLOT, ItemIdentifiers.ELITE_VOID_TOP],
        [LEG_SLOT, ItemIdentifiers.ELITE_VOID_ROBE],
        [HANDS_SLOT, ItemIdentifiers.VOID_KNIGHT_GLOVES],
    ];
    public static readonly OBSIDIAN_WEAPONS = [
        746, 747, 6523, 6525, 6526, 6527, 6528
    ];
    private static readonly VOID_KNIGHT_DEFLECTOR = 19712;
    /**
 * Is the player wearing obsidian?
 *
 * @param player The player.
 * @return true if player is wearing obsidian, false otherwise.
 */
    public static wearingObsidian(player: Player): boolean {
        if (player.getEquipment().getItems()[2].getId() != 11128)
            return false;

        for (let weapon of CombatEquipment.OBSIDIAN_WEAPONS) {
            if (player.getEquipment().getItems()[3].getId() == weapon) {
                return true;
            }
        }
        return false;
    }

    /**
     * Is the player wearing void?
     *
     * @param player The player.
     * @return true if player is wearing void, false otherwise.
     */
    public static wearingVoid(player: Player, attackType: CombatType): boolean {
        let correctEquipment = 0;
        let helmet = attackType == CombatType.MAGIC ? CombatEquipment.MAGE_VOID_HELM :
            attackType == CombatType.RANGED ? CombatEquipment.RANGED_VOID_HELM : CombatEquipment.MELEE_VOID_HELM;
        const equipmentItems = player.getEquipment().getItems();
        for (let [slot, id] of CombatEquipment.VOID_ARMOUR) {
            if (equipmentItems[slot].getId() == id) {
                correctEquipment++;
            }
        }
        if (equipmentItems[SHIELD_SLOT].getId() == CombatEquipment.VOID_KNIGHT_DEFLECTOR) {
            correctEquipment++;
        }
        return correctEquipment >= 3 && equipmentItems[HEAD_SLOT].getId() == helmet;
    }

    public static wearingEliteVoid(player: Player, attackType: CombatType): boolean {
        let correctEquipment = 0;
        const helmet =
            attackType == CombatType.MAGIC
                ? CombatEquipment.MAGE_VOID_HELM
                : attackType == CombatType.RANGED
                ? CombatEquipment.RANGED_VOID_HELM
                : CombatEquipment.MELEE_VOID_HELM;
        const equipmentItems = player.getEquipment().getItems();
        for (let [slot, id] of CombatEquipment.ELITE_VOID_ARMOUR) {
            if (equipmentItems[slot].getId() == id) {
                correctEquipment++;
            }
        }
        if (equipmentItems[SHIELD_SLOT].getId() == CombatEquipment.VOID_KNIGHT_DEFLECTOR) {
            correctEquipment++;
        }
        return correctEquipment >= 3 && equipmentItems[HEAD_SLOT].getId() == helmet;
    }

    public static hasDragonProtectionGear(player: Player): boolean {
        const shieldId = player.getEquipment().get(SHIELD_SLOT).getId();
        return shieldId == ItemIdentifiers.ANTI_DRAGON_SHIELD
            || shieldId == ItemIdentifiers.DRAGONFIRE_SHIELD
            || shieldId == ItemIdentifiers.DRAGONFIRE_WARD;
    }
}
