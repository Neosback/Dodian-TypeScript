import { FightStyle } from './FightStyle';
import { Sound } from '../../Sound';
const ATTACK_STAB = 0;
const ATTACK_SLASH = 1;
const ATTACK_CRUSH = 2;
const ATTACK_MAGIC = 3;
const ATTACK_RANGE = 4;
const DEFENCE_STAB = 0;
const DEFENCE_SLASH = 1;
const DEFENCE_CRUSH = 2;
const DEFENCE_MAGIC = 3;
const DEFENCE_RANGE = 4;

export class FightType {

    public static STAFF_BASH = new FightType(401, 43, 0, ATTACK_CRUSH, FightStyle.ACCURATE, Sound.WEAPON_STAFF)
    public static STAFF_POUND = new FightType(406, 43, 1, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_STAFF)
    public static STAFF_FOCUS = new FightType(406, 43, 2, ATTACK_CRUSH, FightStyle.DEFENSIVE, Sound.WEAPON_STAFF)
    public static WARHAMMER_POUND = new FightType(401, 43, 0, ATTACK_CRUSH, FightStyle.ACCURATE, Sound.WEAPON_WARHAMMER)
    public static WARHAMMER_PUMMEL = new FightType(401, 43, 1, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_WARHAMMER)
    public static WARHAMMER_BLOCK = new FightType(401, 43, 2, ATTACK_CRUSH, FightStyle.DEFENSIVE, Sound.WEAPON_WARHAMMER)
    public static MAUL_POUND = new FightType(2661, 43, 0, ATTACK_CRUSH, FightStyle.ACCURATE, Sound.WEAPON_WARHAMMER)
    public static MAUL_PUMMEL = new FightType(2661, 43, 1, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_WARHAMMER)
    public static MAUL_BLOCK = new FightType(2661, 43, 2, ATTACK_CRUSH, FightStyle.DEFENSIVE, Sound.WEAPON_WARHAMMER)
    public static ELDER_MAUL_POUND = new FightType(7516, 43, 0, ATTACK_CRUSH, FightStyle.ACCURATE, Sound.WEAPON_WARHAMMER)
    public static ELDER_MAUL_PUMMEL = new FightType(7516, 43, 1, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_WARHAMMER)
    public static ELDER_MAUL_BLOCK = new FightType(7516, 43, 2, ATTACK_CRUSH, FightStyle.DEFENSIVE, Sound.WEAPON_WARHAMMER)
    public static GRANITE_MAUL_POUND = new FightType(1665, 43, 0, ATTACK_CRUSH, FightStyle.ACCURATE, Sound.WEAPON_GRANITE_MAUL)
    public static GRANITE_MAUL_PUMMEL = new FightType(1665, 43, 1, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_GRANITE_MAUL)
    public static GRANITE_MAUL_BLOCK = new FightType(1665, 43, 2, ATTACK_CRUSH, FightStyle.DEFENSIVE, Sound.WEAPON_GRANITE_MAUL)
    public static SCYTHE_REAP = new FightType(414, 43, 0, ATTACK_SLASH, FightStyle.ACCURATE, Sound.WEAPON_SCYTHE_SLASH)
    public static SCYTHE_CHOP = new FightType(382, 43, 1, ATTACK_STAB, FightStyle.AGGRESSIVE, Sound.WEAPON_SCYTHE_STAB)
    public static SCYTHE_JAB = new FightType(2066, 43, 2, ATTACK_CRUSH, FightStyle.CONTROLLED, Sound.WEAPON_SCYTHE_SLASH)
    public static SCYTHE_BLOCK = new FightType(382, 43, 3, ATTACK_SLASH, FightStyle.DEFENSIVE, Sound.WEAPON_SCYTHE_SLASH)
    public static BATTLEAXE_CHOP = new FightType(401, 43, 0, ATTACK_SLASH, FightStyle.ACCURATE, Sound.WEAPON_BATTLE_AXE)
    public static BATTLEAXE_HACK = new FightType(401, 43, 1, ATTACK_SLASH, FightStyle.AGGRESSIVE, Sound.WEAPON_BATTLE_AXE)
    public static BATTLEAXE_SMASH = new FightType(401, 43, 2, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_BATTLE_AXE)
    public static BATTLEAXE_BLOCK = new FightType(401, 43, 3, ATTACK_SLASH, FightStyle.DEFENSIVE, Sound.WEAPON_BATTLE_AXE)
    public static GREATAXE_CHOP = new FightType(2062, 43, 0, ATTACK_SLASH, FightStyle.ACCURATE, Sound.WEAPON_DHAROK_GREATAXE)
    public static GREATAXE_HACK = new FightType(2062, 43, 1, ATTACK_SLASH, FightStyle.AGGRESSIVE, Sound.WEAPON_DHAROK_GREATAXE)
    public static GREATAXE_SMASH = new FightType(2066, 43, 2, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_DHAROK_GREATAXE)
    public static GREATAXE_BLOCK = new FightType(2062, 43, 3, ATTACK_SLASH, FightStyle.DEFENSIVE, Sound.WEAPON_DHAROK_GREATAXE)
    public static CROSSBOW_ACCURATE = new FightType(4230, 43, 0, ATTACK_RANGE, FightStyle.ACCURATE)
    public static CROSSBOW_RAPID = new FightType(4230, 43, 1, ATTACK_RANGE, FightStyle.AGGRESSIVE)
    public static CROSSBOW_LONGRANGE = new FightType(4230, 43, 2, ATTACK_RANGE, FightStyle.DEFENSIVE)
    public static KARILS_CROSSBOW_ACCURATE = new FightType(2075, 43, 0, ATTACK_RANGE, FightStyle.ACCURATE)
    public static KARILS_CROSSBOW_RAPID = new FightType(2075, 43, 1, ATTACK_RANGE, FightStyle.AGGRESSIVE)
    public static KARILS_CROSSBOW_LONGRANGE = new FightType(2075, 43, 2, ATTACK_RANGE, FightStyle.DEFENSIVE)
    public static BALLISTA_ACCURATE = new FightType(7218, 43, 0, ATTACK_RANGE, FightStyle.ACCURATE)
    public static BALLISTA_RAPID = new FightType(7218, 43, 1, ATTACK_RANGE, FightStyle.AGGRESSIVE)
    public static BALLISTA_LONGRANGE = new FightType(7218, 43, 2, ATTACK_RANGE, FightStyle.DEFENSIVE)
    public static BLOWPIPE_ACCURATE = new FightType(5061, 43, 0, ATTACK_RANGE, FightStyle.ACCURATE)
    public static BLOWPIPE_RAPID = new FightType(5061, 43, 1, ATTACK_RANGE, FightStyle.AGGRESSIVE)
    public static BLOWPIPE_LONGRANGE = new FightType(5061, 43, 2, ATTACK_RANGE, FightStyle.DEFENSIVE)
    public static ABYSSAL_BLUDGEON_CHOP = new FightType(7054, 43, 0, ATTACK_SLASH, FightStyle.ACCURATE)
    public static ABYSSAL_BLUDGEON_SLASH = new FightType(7054, 43, 1, ATTACK_SLASH, FightStyle.AGGRESSIVE)
    public static ABYSSAL_BLUDGEON_SMASH = new FightType(7054, 43, 2, ATTACK_CRUSH, FightStyle.AGGRESSIVE)
    public static ABYSSAL_BLUDGEON_BLOCK = new FightType(7054, 43, 3, ATTACK_SLASH, FightStyle.DEFENSIVE)
    public static SHORTBOW_ACCURATE = new FightType(426, 43, 0, ATTACK_RANGE, FightStyle.ACCURATE)
    public static SHORTBOW_RAPID = new FightType(426, 43, 1, ATTACK_RANGE, FightStyle.AGGRESSIVE)
    public static SHORTBOW_LONGRANGE = new FightType(426, 43, 2, ATTACK_RANGE, FightStyle.DEFENSIVE)
    public static LONGBOW_ACCURATE = new FightType(426, 43, 0, ATTACK_RANGE, FightStyle.ACCURATE)
    public static LONGBOW_RAPID = new FightType(426, 43, 1, ATTACK_RANGE, FightStyle.AGGRESSIVE)
    public static LONGBOW_LONGRANGE = new FightType(426, 43, 2, ATTACK_RANGE, FightStyle.DEFENSIVE)
    public static DAGGER_STAB = new FightType(400, 43, 0, ATTACK_STAB, FightStyle.ACCURATE, Sound.WEAPON_DAGGER_STAB)
    public static DAGGER_LUNGE = new FightType(400, 43, 1, ATTACK_STAB, FightStyle.AGGRESSIVE, Sound.WEAPON_DAGGER_STAB)
    public static DAGGER_SLASH = new FightType(400, 43, 2, ATTACK_STAB, FightStyle.AGGRESSIVE, Sound.WEAPON_DAGGER_SLASH)
    public static DAGGER_BLOCK = new FightType(400, 43, 3, ATTACK_STAB, FightStyle.DEFENSIVE, Sound.WEAPON_DAGGER_STAB)
    public static DRAGON_DAGGER_STAB = new FightType(376, 43, 0, ATTACK_STAB, FightStyle.ACCURATE, Sound.WEAPON_DAGGER_STAB)
    public static DRAGON_DAGGER_LUNGE = new FightType(376, 43, 1, ATTACK_STAB, FightStyle.AGGRESSIVE, Sound.WEAPON_DAGGER_STAB)
    public static DRAGON_DAGGER_SLASH = new FightType(377, 43, 2, ATTACK_STAB, FightStyle.AGGRESSIVE, Sound.WEAPON_DAGGER_SLASH)
    public static DRAGON_DAGGER_BLOCK = new FightType(376, 43, 3, ATTACK_STAB, FightStyle.DEFENSIVE, Sound.WEAPON_DAGGER_STAB)
    public static SWORD_STAB = new FightType(412, 43, 0, ATTACK_STAB, FightStyle.ACCURATE, Sound.WEAPON_SWORD_STAB)
    public static SWORD_LUNGE = new FightType(412, 43, 1, ATTACK_STAB, FightStyle.AGGRESSIVE, Sound.WEAPON_SWORD_STAB)
    public static SWORD_SLASH = new FightType(390, 43, 2, ATTACK_SLASH, FightStyle.AGGRESSIVE, Sound.WEAPON_SWORD_SLASH)
    public static SWORD_BLOCK = new FightType(412, 43, 3, ATTACK_STAB, FightStyle.DEFENSIVE, Sound.WEAPON_SWORD_STAB)
    public static SCIMITAR_CHOP = new FightType(390, 43, 0, ATTACK_SLASH, FightStyle.ACCURATE, Sound.WEAPON_SCIMITAR)
    public static SCIMITAR_LUNGE = new FightType(390, 43, 2, ATTACK_STAB, FightStyle.CONTROLLED, Sound.WEAPON_SCIMITAR)
    public static SCIMITAR_BLOCK = new FightType(390, 43, 3, ATTACK_SLASH, FightStyle.DEFENSIVE, Sound.WEAPON_SCIMITAR)
    public static SCIMITAR_SLASH = new FightType(390, 43, 1, ATTACK_SLASH, FightStyle.AGGRESSIVE, Sound.WEAPON_SCIMITAR)
    public static LONGSWORD_CHOP = new FightType(390, 43, 0, ATTACK_SLASH, FightStyle.ACCURATE, Sound.WEAPON_SWORD_SLASH)
    public static LONGSWORD_SLASH = new FightType(390, 43, 1, ATTACK_SLASH, FightStyle.AGGRESSIVE, Sound.WEAPON_SWORD_SLASH)
    public static LONGSWORD_LUNGE = new FightType(412, 43, 2, ATTACK_STAB, FightStyle.CONTROLLED, Sound.WEAPON_SWORD_STAB)
    public static LONGSWORD_BLOCK = new FightType(390, 43, 3, ATTACK_SLASH, FightStyle.DEFENSIVE, Sound.WEAPON_SWORD_SLASH)
    public static MACE_POUND = new FightType(401, 43, 0, ATTACK_CRUSH, FightStyle.ACCURATE, Sound.WEAPON_MACE_CRUSH)
    public static MACE_PUMMEL = new FightType(401, 43, 1, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_MACE_CRUSH)
    public static MACE_SPIKE = new FightType(401, 43, 2, ATTACK_STAB, FightStyle.CONTROLLED, Sound.WEAPON_MACE_STAB)
    public static MACE_BLOCK = new FightType(401, 43, 3, ATTACK_CRUSH, FightStyle.DEFENSIVE, Sound.WEAPON_MACE_CRUSH)
    public static KNIFE_ACCURATE = new FightType(806, 43, 0, ATTACK_RANGE, FightStyle.ACCURATE)
    public static KNIFE_RAPID = new FightType(806, 43, 1, ATTACK_RANGE, FightStyle.AGGRESSIVE)
    public static KNIFE_LONGRANGE = new FightType(806, 43, 2, ATTACK_RANGE, FightStyle.DEFENSIVE)
    public static OBBY_RING_ACCURATE = new FightType(2614, 43, 0, ATTACK_RANGE, FightStyle.ACCURATE)
    public static OBBY_RING_RAPID = new FightType(2614, 43, 1, ATTACK_RANGE, FightStyle.AGGRESSIVE)
    public static OBBY_RING_LONGRANGE = new FightType(2614, 43, 2, ATTACK_RANGE, FightStyle.DEFENSIVE)
    public static SPEAR_LUNGE = new FightType(2080, 43, 0, ATTACK_STAB, FightStyle.CONTROLLED, Sound.WEAPON_SPEAR_STAB)
    public static SPEAR_SWIPE = new FightType(2081, 43, 1, ATTACK_SLASH, FightStyle.CONTROLLED, Sound.WEAPON_SPEAR_SLASH)
    public static SPEAR_POUND = new FightType(2082, 43, 2, ATTACK_CRUSH, FightStyle.CONTROLLED, Sound.WEAPON_SPEAR_CRUSH)
    public static SPEAR_BLOCK = new FightType(2080, 43, 3, ATTACK_STAB, FightStyle.DEFENSIVE, Sound.WEAPON_SPEAR_STAB)
    public static TWOHANDEDSWORD_CHOP = new FightType(407, 43, 0, ATTACK_SLASH, FightStyle.ACCURATE, Sound.WEAPON_TWO_HANDER)
    public static TWOHANDEDSWORD_SLASH = new FightType(407, 43, 1, ATTACK_SLASH, FightStyle.AGGRESSIVE, Sound.WEAPON_TWO_HANDER)
    public static TWOHANDEDSWORD_SMASH = new FightType(406, 43, 2, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_TWO_HANDER)
    public static TWOHANDEDSWORD_BLOCK = new FightType(407, 43, 3, ATTACK_SLASH, FightStyle.DEFENSIVE, Sound.WEAPON_TWO_HANDER)
    public static GODSWORD_CHOP = new FightType(7046, 43, 0, ATTACK_SLASH, FightStyle.ACCURATE, Sound.WEAPON_GODSWORD)
    public static GODSWORD_SLASH = new FightType(7045, 43, 1, ATTACK_SLASH, FightStyle.AGGRESSIVE, Sound.WEAPON_GODSWORD)
    public static GODSWORD_SMASH = new FightType(7054, 43, 2, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_GODSWORD)
    public static GODSWORD_BLOCK = new FightType(7055, 43, 3, ATTACK_SLASH, FightStyle.DEFENSIVE, Sound.WEAPON_GODSWORD)
    public static VERACS_FLAIL_POUND = new FightType(1658, 43, 0, ATTACK_CRUSH, FightStyle.ACCURATE, Sound.WEAPON_VERAC_FLAIL)
    public static VERACS_FLAIL_PUMMEL = new FightType(1658, 43, 1, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_VERAC_FLAIL)
    public static VERACS_FLAIL_SPIKE = new FightType(1658, 43, 2, ATTACK_STAB, FightStyle.CONTROLLED, Sound.WEAPON_VERAC_FLAIL)
    public static VERACS_FLAIL_BLOCK = new FightType(1658, 43, 3, ATTACK_CRUSH, FightStyle.DEFENSIVE, Sound.WEAPON_VERAC_FLAIL)
    public static PICKAXE_SPIKE = new FightType(401, 43, 0, ATTACK_STAB, FightStyle.ACCURATE, Sound.WEAPON_DAGGER_STAB)
    public static PICKAXE_IMPALE = new FightType(401, 43, 1, ATTACK_STAB, FightStyle.AGGRESSIVE, Sound.WEAPON_DAGGER_STAB)
    public static PICKAXE_SMASH = new FightType(401, 43, 2, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON)
    public static PICKAXE_BLOCK = new FightType(400, 43, 3, ATTACK_STAB, FightStyle.DEFENSIVE, Sound.WEAPON_DAGGER_STAB)
    public static CLAWS_CHOP = new FightType(393, 43, 0, ATTACK_SLASH, FightStyle.ACCURATE, Sound.WEAPON_DAGGER_SLASH)
    public static CLAWS_SLASH = new FightType(393, 43, 1, ATTACK_SLASH, FightStyle.AGGRESSIVE, Sound.WEAPON_DAGGER_SLASH)
    public static CLAWS_LUNGE = new FightType(393, 43, 2, ATTACK_STAB, FightStyle.CONTROLLED, Sound.WEAPON_DAGGER_STAB)
    public static CLAWS_BLOCK = new FightType(393, 43, 3, ATTACK_SLASH, FightStyle.DEFENSIVE, Sound.WEAPON_DAGGER_SLASH)
    public static HALBERD_JAB = new FightType(440, 43, 0, ATTACK_STAB, FightStyle.CONTROLLED, Sound.WEAPON_SPEAR_STAB)
    public static HALBERD_SWIPE = new FightType(440, 43, 1, ATTACK_SLASH, FightStyle.AGGRESSIVE, Sound.WEAPON_SPEAR_SLASH)
    public static HALBERD_FEND = new FightType(440, 43, 2, ATTACK_STAB, FightStyle.DEFENSIVE, Sound.WEAPON_SPEAR_STAB)
    public static UNARMED_PUNCH = new FightType(422, 43, 0, ATTACK_CRUSH, FightStyle.ACCURATE, Sound.WEAPON_UNARMED_PUNCH)
    public static UNARMED_KICK = new FightType(423, 43, 1, ATTACK_CRUSH, FightStyle.AGGRESSIVE, Sound.WEAPON_UNARMED_KICK)
    public static UNARMED_BLOCK = new FightType(422, 43, 2, ATTACK_CRUSH, FightStyle.DEFENSIVE, Sound.WEAPON_UNARMED_PUNCH)
    public static WHIP_FLICK = new FightType(1658, 43, 0, ATTACK_SLASH, FightStyle.ACCURATE, Sound.WEAPON_WHIP)
    public static WHIP_LASH = new FightType(1658, 43, 1, ATTACK_SLASH, FightStyle.CONTROLLED, Sound.WEAPON_WHIP)
    public static WHIP_DEFLECT = new FightType(1658, 43, 2, ATTACK_SLASH, FightStyle.DEFENSIVE, Sound.WEAPON_WHIP)
    public static THROWNAXE_ACCURATE = new FightType(806, 43, 0, ATTACK_RANGE, FightStyle.ACCURATE)
    public static THROWNAXE_RAPID = new FightType(806, 43, 1, ATTACK_RANGE, FightStyle.AGGRESSIVE)
    public static THROWNAXE_LONGRANGE = new FightType(806, 43, 2, ATTACK_RANGE, FightStyle.DEFENSIVE)
    public static DART_ACCURATE = new FightType(806, 43, 0, ATTACK_RANGE, FightStyle.ACCURATE)
    public static DART_RAPID = new FightType(806, 43, 1, ATTACK_RANGE, FightStyle.AGGRESSIVE)
    public static DART_LONGRANGE = new FightType(806, 43, 2, ATTACK_RANGE, FightStyle.DEFENSIVE)
    public static JAVELIN_ACCURATE = new FightType(806, 43, 0, ATTACK_RANGE, FightStyle.ACCURATE)
    public static JAVELIN_RAPID = new FightType(806, 43, 2, ATTACK_RANGE, FightStyle.AGGRESSIVE)
    public static JAVELIN_LONGRANGE = new FightType(806, 43, 3, ATTACK_RANGE, FightStyle.DEFENSIVE)
    public static GHRAZI_RAPIER_STAB = new FightType(8145, 43, 0, ATTACK_STAB, FightStyle.ACCURATE)
    public static GHRAZI_RAPIER_LUNGE = new FightType(8145, 43, 1, ATTACK_STAB, FightStyle.AGGRESSIVE)
    public static GHRAZI_RAPIER_SLASH = new FightType(390, 43, 2, ATTACK_STAB, FightStyle.AGGRESSIVE)
    public static GHRAZI_RAPIER_BLOCK = new FightType(8145, 43, 3, ATTACK_STAB, FightStyle.DEFENSIVE)


    private animation: number;
    private attackSound: Sound;
    private parentId: number;
    private childId: number;
    private bonusType: number;
    private style: FightStyle;

    private constructor(animation: number, parentId: number, childId: number, bonusType: number, style: FightStyle, sound?: Sound) {
        this.animation = animation;
        this.parentId = parentId;
        this.childId = childId;
        this.bonusType = bonusType;
        this.style = style;
        this.attackSound = sound ?? Sound.WEAPON;
    }

    public static values(): FightType[] {
        return Object.values(FightType).filter((value): value is FightType => value instanceof FightType);
    }

    public static resolve(value: unknown): FightType | null {
        if (value instanceof FightType) {
            return value;
        }

        if (!value || typeof value !== "object") {
            return null;
        }

        const raw = value as Record<string, unknown>;
        const animation = FightType.asFiniteInt(raw.animation);
        const parentId = FightType.asFiniteInt(raw.parentId);
        const childId = FightType.asFiniteInt(raw.childId);
        const bonusType = FightType.asFiniteInt(raw.bonusType);
        if (animation === null && parentId === null && childId === null && bonusType === null) {
            return null;
        }

        const candidates = FightType.values().filter((fightType) => {
            return (animation === null || fightType.animation === animation)
                && (parentId === null || fightType.parentId === parentId)
                && (childId === null || fightType.childId === childId)
                && (bonusType === null || fightType.bonusType === bonusType);
        });

        if (candidates.length === 0) {
            return null;
        }

        return candidates[0];
    }

    private static asFiniteInt(value: unknown): number | null {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return null;
        }
        return value | 0;
    }

    public getAnimation(): number {
        return this.animation;
    }

    /**
     * Gets the parent config      *
     * @return the parent      */
    public getParentId(): number {
        return this.parentId;
    }

    /**
     * Gets the child config      *
     * @return the child      */
    public getChildId(): number {
        return this.childId;
    }

    /**
     * Gets the bonus type.
     *
     * @return the bonus type.
     */
    public getBonusType(): number {
        return this.bonusType;

    }
    public getBonusTypes(): number {
        return this.bonusType;

    }

    /**
     * Gets the fighting style.
     *
     * @return the fighting style.
     */
    public getStyle(): FightStyle {
        return this.style;
    }

    public getCorrespondingBonus(): number {
        switch (this.bonusType) {
            case ATTACK_CRUSH:
                return DEFENCE_CRUSH;
            case ATTACK_MAGIC:
                return DEFENCE_MAGIC;
            case ATTACK_RANGE:
                return DEFENCE_RANGE;
            case ATTACK_SLASH:
                return DEFENCE_SLASH;
            case ATTACK_STAB:
                return DEFENCE_STAB;
            default:
                return DEFENCE_CRUSH;
        }
    }

    public getAttackSound(): Sound {
        return this.attackSound;
    }

    public isRapid(): boolean {
        return this === FightType.CROSSBOW_RAPID
            || this === FightType.KARILS_CROSSBOW_RAPID
            || this === FightType.BALLISTA_RAPID
            || this === FightType.BLOWPIPE_RAPID
            || this === FightType.SHORTBOW_RAPID
            || this === FightType.LONGBOW_RAPID
            || this === FightType.KNIFE_RAPID
            || this === FightType.OBBY_RING_RAPID
            || this === FightType.THROWNAXE_RAPID
            || this === FightType.DART_RAPID
            || this === FightType.JAVELIN_RAPID;
    }

}    
