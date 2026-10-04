import { Mobile } from "../../entity/impl/Mobile";
import type { Player } from "../../entity/impl/player/Player";
import { CombatFactory } from "./CombatFactory";
import { CombatMethod } from "./method/CombatMethod";
import { CombatType } from "./CombatType";
import { TaskManager } from "../../task/TaskManager";
import { RestoreSpecialAttackTask } from '../../task/impl/RestoreSpecialAttackTask'
import { Equipment } from "../../model/container/impl/Equipment";
import { DuelRule } from "../Duelling";
import { ItemIdentifiers } from "../../../util/ItemIdentifiers";
import { PlayerRights } from "../../model/rights/PlayerRights";
import { AbyssalBludgeonCombatMethod } from "./method/impl/specials/AbyssalBludgeonCombatMethod";
import { AbyssalDaggerCombatMethod } from "./method/impl/specials/AbyssalDaggerCombatMethod";
import { AbyssalWhipCombatMethod } from "./method/impl/specials/AbyssalWhipCombatMethod";
import { AbyssalTentacleCombatMethod } from "./method/impl/specials/AbyssalTentacleCombatMethod";
import { AncientGodswordCombatMethod } from "./method/impl/specials/AncientGodswordCombatMethod";
import { ArmadylCrossbowCombatMethod } from "./method/impl/specials/ArmadylCrossbowCombatMethod";
import { ArmadylGodswordCombatMethod } from "./method/impl/specials/ArmadylGodswordCombatMethod";
import { BallistaCombatMethod } from "./method/impl/specials/BallistaCombatMethod";
import { BandosGodswordCombatMethod } from "./method/impl/specials/BandosGodswordCombatMethod";
import { BarrelchestAnchorCombatMethod } from "./method/impl/specials/BarrelchestAnchorCombatMethod";
import { DarkBowCombatMethod } from "./method/impl/specials/DarkBowCombatMethod";
import { DragonClawCombatMethod } from "./method/impl/specials/DragonClawCombatMethod";
import { DragonDaggerCombatMethod } from "./method/impl/specials/DragonDaggerCombatMethod";
import { DragonHalberdCombatMethod } from "./method/impl/specials/DragonHalberdCombatMethod";
import { DragonKnifeCombatMethod } from "./method/impl/specials/DragonKnifeCombatMethod";
import { DragonLongswordCombatMethod } from "./method/impl/specials/DragonLongswordCombatMethod";
import { DragonMaceCombatMethod } from "./method/impl/specials/DragonMaceCombatMethod";
import { DragonScimitarCombatMethod } from "./method/impl/specials/DragonScimitarCombatMethod";
import { DragonWarhammerCombatMethod } from "./method/impl/specials/DragonWarhammerCombatMethod";
import { GraniteMaulCombatMethod } from "./method/impl/specials/GraniteMaulCombatMethod";
import { MagicShortbowCombatMethod } from "./method/impl/specials/MagicShortbowCombatMethod";
import { MorrigansJavelinCombatMethod } from "./method/impl/specials/MorrigansJavelinCombatMethod";
import { RangedCombatMethod } from "./method/impl/RangedCombatMethod";
import { SaradominGodswordCombatMethod } from "./method/impl/specials/SaradominGodswordCombatMethod";
import { SaradominSwordCombatMethod } from "./method/impl/specials/SaradominSwordCombatMethod";
import { ShoveCombatMethod } from "./method/impl/specials/ShoveCombatMethod";
import { StatiusWarhammerCombatMethod } from "./method/impl/specials/StatiusWarhammerCombatMethod";
import { VestasLongswordCombatMethod } from "./method/impl/specials/VestasLongswordCombatMethod";
import { VolatileNightmareStaffCombatMethod } from "./method/impl/specials/VolatileNightmareStaffCombatMethod";
import { ZamorakGodswordCombatMethod } from "./method/impl/specials/ZamorakGodswordCombatMethod";
import { ZaryteCrossbowCombatMethod } from "./method/impl/specials/ZaryteCrossbowCombatMethod";


export class CombatSpecial {
    public static readonly ABYSSAL_WHIP = new CombatSpecial (
        [4151, 21371, 15441, 15442, 15443, 15444],
        50,
        1,
        1,
        new AbyssalWhipCombatMethod(),
        null as any
    )
    public static readonly ABYSSAL_TENTACLE = new CombatSpecial(
        [12006],
        50,
        1,
        1,
        new AbyssalTentacleCombatMethod(),
        null
    )
    public static readonly BARRELSCHEST_ANCHOR = new CombatSpecial(
        [10887],
        50,
        1.22,
        1.10,
        new BarrelchestAnchorCombatMethod(),
        null
    )
    public static readonly DRAGON_SCIMITAR = new CombatSpecial(
        [
            ItemIdentifiers.DRAGON_SCIMITAR,
            ItemIdentifiers.DRAGON_SCIMITAR_OR_,
            ItemIdentifiers.DRAGON_SCIMITAR_3
        ],
        55,
        1.00,
        1.25,
        new DragonScimitarCombatMethod(),
        null
    )
    public static readonly DRAGON_LONGSWORD = new CombatSpecial(
        [1305],
        25,
        1.15,
        1.25,
        new DragonLongswordCombatMethod(),
        null
    )
    public static readonly DRAGON_MACE =  new CombatSpecial(
        [1434],
        25,
        1.5,
        1.25,
        new DragonMaceCombatMethod(),
        null
    )
    public static readonly DRAGON_WARHAMMER =  new CombatSpecial (
        [13576],
        50,
        1.5,
        1.00,
        new DragonWarhammerCombatMethod(),
        null
    )
    public static readonly VESTAS_LONGSWORD = new CombatSpecial(
        [ItemIdentifiers.VESTAS_LONGSWORD],
        25,
        1.0,
        1.0,
        new VestasLongswordCombatMethod(),
        null
    )
    public static readonly STATIUS_WARHAMMER = new CombatSpecial(
        [ItemIdentifiers.STATIUSS_WARHAMMER],
        35,
        1.0,
        1.0,
        new StatiusWarhammerCombatMethod(),
        null
    )
    public static readonly SARADOMIN_SWORD = new CombatSpecial(
        [11838],
        100,
        1.0,
        1.0,
        new SaradominSwordCombatMethod(),
        null
    )
    public static readonly ARMADYL_GODSWORD = new CombatSpecial(
        [11802],
        50,
        1.375,
        2,
        new ArmadylGodswordCombatMethod(),
        null
    )
    public static readonly ANCIENT_GODSWORD = new CombatSpecial(
        [ItemIdentifiers.ANCIENT_GODSWORD],
        50,
        1.1,
        2,
        new AncientGodswordCombatMethod(),
        null
    )
    public static readonly SARADOMIN_GODSWORD = new CombatSpecial(
        [11806],
        50,
        1.1,
        1.5,
        new SaradominGodswordCombatMethod(),
        null
    )
    public static readonly BANDOS_GODSWORD = new CombatSpecial(
        [11804],
        100,
        1.21,
        1.5,
        new BandosGodswordCombatMethod(),
        null
    )
    public static readonly ZAMORAK_GODSWORD = new CombatSpecial(
        [11808],
        50,
        1.1,
        2,
        new ZamorakGodswordCombatMethod(),
        null
    )
    public static readonly ABYSSAL_BLUDGEON = new CombatSpecial(
        [13263],
        50,
        1.20,
        1.0,
        new AbyssalBludgeonCombatMethod(),
        null
    )
    public static readonly SHOVE_SPECIAL = new CombatSpecial(
        [
            ItemIdentifiers.DRAGON_SPEAR,
            ItemIdentifiers.DRAGON_SPEAR_P_PLUS_PLUS_,
            ItemIdentifiers.DRAGON_SPEAR_P_PLUS_,
            ItemIdentifiers.DRAGON_SPEAR_KP_,
            ItemIdentifiers.DRAGON_SPEAR_P_,
            ItemIdentifiers.ZAMORAKIAN_SPEAR,
            ItemIdentifiers.ZAMORAKIAN_HASTA
        ],
        25,
        1.0,
        1.0,
        new ShoveCombatMethod(),
        null
    )
    public static readonly DRAGON_HALBERD = new CombatSpecial(
        [3204],
        30,
        1.1,
        1.35,
        new DragonHalberdCombatMethod(),
        null
    )
    public static readonly DRAGON_DAGGER = new CombatSpecial(
        [1215, 1231, 5680, 5698],
        25,
        1.15,
        1.20,
        new DragonDaggerCombatMethod(),
        null
    )
    public static readonly ABYSSAL_DAGGER = new CombatSpecial (
        [13271],
        50,
        0.85,
        1.25,
        new AbyssalDaggerCombatMethod(),
        null
    )
    public static readonly GRANITE_MAUL = new CombatSpecial(
        [4153, 12848],
        50,
        1,
        1,
        new GraniteMaulCombatMethod(),
        null
    )
    public static readonly DRAGON_CLAWS = new CombatSpecial(
        [13652],
        50,
        1,
        1.35,
        new DragonClawCombatMethod(),
        null
    )
    public static readonly MAGIC_SHORTBOW = new CombatSpecial(
        [ItemIdentifiers.MAGIC_SHORTBOW, ItemIdentifiers.MAGIC_SHORTBOW_I_, ItemIdentifiers.MAGIC_SHORTBOW_3],
        55,
        1,
        1,
        new MagicShortbowCombatMethod(),
        null
    )
    public static readonly DARK_BOW = new CombatSpecial(
        [11235],
        55,
        1.5,
        1.0,
        new DarkBowCombatMethod(),
        null
    )
    public static readonly ARMADYL_CROSSBOW = new CombatSpecial(
        [11785],
        50,
        1,
        2.0,
        new ArmadylCrossbowCombatMethod(),
        null
    )
    public static readonly ZARYTE_CROSSBOW = new CombatSpecial(
        [ItemIdentifiers.ZARYTE_CROSSBOW],
        75,
        1,
        2.0,
        new ZaryteCrossbowCombatMethod(),
        null
    )
    public static readonly BALLISTA = new CombatSpecial(
        [19478, 19481],
        65,
        1.25,
        1.25,
        new BallistaCombatMethod(),
        null
    )
    public static readonly MORRIGANS_JAVELIN = new CombatSpecial(
        [ItemIdentifiers.MORRIGANS_JAVELIN],
        50,
        1,
        1,
        new MorrigansJavelinCombatMethod(),
        null
    )
    public static readonly DRAGON_KNIFE = new CombatSpecial(
        [
            ItemIdentifiers.DRAGON_KNIFE,
            ItemIdentifiers.DRAGON_KNIFE_P_,
            ItemIdentifiers.DRAGON_KNIFE_P_PLUS_,
            ItemIdentifiers.DRAGON_KNIFE_P_PLUS_PLUS_
        ],
        25,
        1,
        1,
        new DragonKnifeCombatMethod(),
        null
    )
    public static readonly TOXIC_BLOWPIPE = new CombatSpecial(
        [ItemIdentifiers.TOXIC_BLOWPIPE],
        50,
        1.5,
        2.0,
        new RangedCombatMethod(),
        null
    )
    public static readonly VOLATILE_NIGHTMARE_STAFF = new CombatSpecial(
        [ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF],
        55,
        1,
        1.5,
        new VolatileNightmareStaffCombatMethod(),
        null
    )

    constructor(identifiers: any, drainAmount: number, strengthMultiplier: number, accuracyMultiplier: number, combatMethod: CombatMethod, weaponInterface: any){
        this.identifiers = identifiers
        this.drainAmount = drainAmount
        this.strengthMultiplier = strengthMultiplier
        this.accuracyMultiplier = accuracyMultiplier
        this.combatMethod = combatMethod
        this.weaponType = weaponInterface
    }

    SPECIAL_ATTACK_WEAPON_IDS = new Set(Object.values(CombatSpecial).flatMap((cs) => cs.identifiers));

    private drainAmount: number;
    private strengthMultiplier: number;
    private accuracyMultiplier: number;
    private combatMethod: any;
    private weaponType: any;
    private identifiers: [];


    public static checkSpecial(player: Player, special: CombatSpecial): boolean {
        return (
            player.getCombatSpecial() != null &&
            player.getCombatSpecial() == special &&
            player.isSpecialActivated() &&
            player.getSpecialPercentage() >= special.getDrainAmount()
        );
    }

    public static drain(character: Mobile, amount: number) {
        character.decrementSpecialPercentage(amount);

        CombatSpecial.ensureRestoreTask(character);

        if (character.isPlayer()) {
            let p = character.getAsPlayer();
            CombatSpecial.updateBar(p);
        }
    }

    public static ensureRestoreTask(character: Mobile): boolean {
        if (!character || character.getSpecialPercentage() >= 100 || character.isRecoveringSpecialAttack()) {
            return false;
        }

        let initialDelayTicks: number | undefined;
        if (character.isPlayer()) {
            const secondsRemaining = character.getAsPlayer().getSpecialAttackRestore().secondsRemaining();
            initialDelayTicks = RestoreSpecialAttackTask.initialDelayTicksFromSeconds(
                secondsRemaining,
                character
            );
        }

        TaskManager.submit(new RestoreSpecialAttackTask(character, initialDelayTicks));
        return true;
    }

    public static updateBar(player: Player) {
        const packetSender = player.getPacketSender();
        packetSender.updateSpecialAttackOrb();
        packetSender.sendSpecialAttackState(player.isSpecialActivated());

        const weapon = player.getWeapon();
        if (!weapon || typeof weapon.getSpecialBar !== "function" || typeof weapon.getSpecialMeter !== "function") {
            return;
        }
        if (weapon.getSpecialBar() == -1 || weapon.getSpecialMeter() == -1) {
            return;
        }
        let specialCheck = 10;
        let specialBar = weapon.getSpecialMeter();
        let specialAmount = player.getSpecialPercentage() / 10;

        for (let i = 0; i < 10; i++) {
            player.getPacketSender().sendInterfaceComponentMoval(specialAmount >= specialCheck ? 500 : 0, 0, --specialBar);
            specialCheck--;
        }
        packetSender.sendString(
            player.isSpecialActivated()
                ? ("@yel@ Special Attack (" + player.getSpecialPercentage() + "%)")
                : ("@bla@ Special Attack (" + player.getSpecialPercentage() + "%)"),
            weapon.getSpecialMeter()
        );
    }

    public static assign(player: Player) {
        if (player.getWeapon().getSpecialBar() == -1) {
            player.setSpecialActivated(false);
            player.setCombatSpecial(null);
            CombatSpecial.updateBar(player);
            return;
        }

        const equippedWeaponId = player.getEquipment().get(Equipment.WEAPON_SLOT).getId();
        for (let c of Object.values(CombatSpecial)) {
            if (!(c instanceof CombatSpecial)) {
                continue;
            }
            if (c.identifiers.some(id => equippedWeaponId == id)) {
                player.getPacketSender().sendInterfaceDisplayState(player.getWeapon().getSpecialBar(), false);
                player.setCombatSpecial(c);
                return;
            }
        }

        player.getPacketSender().sendInterfaceDisplayState(player.getWeapon().getSpecialBar(), true);
        player.setCombatSpecial(null);
        player.setSpecialActivated(false);
        player.getPacketSender().sendSpecialAttackState(false);
    }

    public static activate(player: Player) {
        if (player.getCombatSpecial() == null) {
            return;
        }

        if (player.getDueling().inDuel() && player.getDueling().getRules()[DuelRule.NO_SPECIAL_ATTACKS.getButtonId()]) {
            return;
        }

        if (player.isSpecialActivated()) {
            player.setSpecialActivated(false);
            CombatSpecial.updateBar(player);
        } else {
            const spec = player.getCombatSpecial();
            const developerGraniteMaulSpam =
                spec == CombatSpecial.GRANITE_MAUL &&
                player.getRights?.() === PlayerRights.DEVELOPER;
            player.setSpecialActivated(true);
            CombatSpecial.updateBar(player);

            if (spec == CombatSpecial.GRANITE_MAUL) {
                if (!developerGraniteMaulSpam && player.getSpecialPercentage() < player.getCombatSpecial().getDrainAmount()) {
                    player.sendMessage("You do not have enough special attack energy left!");
                    player.setSpecialActivated(false);
                    CombatSpecial.updateBar(player);
                    return;
                }

                const target = player.getCombat().getTarget();
                if (target != null && CombatFactory.getMethod(player).type() == CombatType.MELEE) {
                    const drainAmount = spec.getDrainAmount();
                    player.getCombat().setGraniteMaulSpecialQueued(true);
                    if (!developerGraniteMaulSpam) {
                        CombatSpecial.drain(player, drainAmount);
                    }
                    const attacked = player.getCombat().performNewAttack(true);
                    if (!attacked) {
                        player.getCombat().setGraniteMaulSpecialQueued(false);
                        if (!developerGraniteMaulSpam) {
                            player.incrementSpecialPercentage(drainAmount);
                        }
                        player.setSpecialActivated(false);
                        CombatSpecial.updateBar(player);
                    }
                    return;
                } else {
                    // Uninformed player using gmaul without being in combat..
                    // Teach them a lesson!
                    player.sendMessage("Although not required, the Granite maul special attack should be used during");
                    player.sendMessage("combat for maximum effect.");
                }
            }
        }

    }

    public getIdentifiers(): number[] {
        return this.identifiers;
    }

    public getDrainAmount(): number {
        return this.drainAmount;
    }

    public getStrengthMultiplier(): number {
        return this.strengthMultiplier;
    }

    public getAccuracyMultiplier(): number {
        return this.accuracyMultiplier;
    }

    public getCombatMethod(): CombatMethod {
        return this.combatMethod;
    }

    public getWeaponType(): any {
        return this.weaponType;
    }

}
