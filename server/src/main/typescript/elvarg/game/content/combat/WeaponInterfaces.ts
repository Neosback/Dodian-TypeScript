import { FightType } from "./FightType";

export class WeaponInterfaces {
    public static readonly STAFF = new WeaponInterfaces(
        328,
        355,
        5,
        [FightType.STAFF_BASH, FightType.STAFF_POUND, FightType.STAFF_FOCUS]
    )
    public static readonly WARHAMMER = new WeaponInterfaces(
        425,
        428,
        6,
        [FightType.WARHAMMER_POUND,
        FightType.WARHAMMER_PUMMEL, FightType.WARHAMMER_BLOCK],
        7474,
        7486 
    )

    public static readonly MAUL = new WeaponInterfaces(
        425,
        428,
        7,
        [FightType.MAUL_POUND,
        FightType.MAUL_PUMMEL, FightType.MAUL_BLOCK],
        7474,
        7486
    )

    public static readonly GRANITE_MAUL = new WeaponInterfaces(
        425,
        428,
        7,
        [FightType.GRANITE_MAUL_POUND,
        FightType.GRANITE_MAUL_PUMMEL, FightType.GRANITE_MAUL_BLOCK],
        7474,
        7486
    )

    public static readonly VERACS_FLAIL = new WeaponInterfaces(
        3796,
        3799,
        5,
        [FightType.VERACS_FLAIL_POUND,
        FightType.VERACS_FLAIL_PUMMEL, FightType.VERACS_FLAIL_SPIKE,
        FightType.VERACS_FLAIL_BLOCK],
        7624,
        7636
    )

    public static readonly SCYTHE = new WeaponInterfaces(
        776,
        779,
        4,
        [FightType.SCYTHE_REAP,
        FightType.SCYTHE_CHOP, FightType.SCYTHE_JAB,
        FightType.SCYTHE_BLOCK]
    )

    public static readonly BATTLEAXE = new WeaponInterfaces(
        1698,
        1701,
        6,
        [FightType.BATTLEAXE_CHOP,
        FightType.BATTLEAXE_HACK, FightType.BATTLEAXE_SMASH,
        FightType.BATTLEAXE_BLOCK],
        7499,
        7511
    
    )

    public static readonly GREATAXE = new WeaponInterfaces(
        1698,
        1701,
        7,
        [FightType.GREATAXE_CHOP,
        FightType.GREATAXE_HACK, FightType.GREATAXE_SMASH,
        FightType.GREATAXE_BLOCK],
        7499,
        7511
    )

    public static readonly CROSSBOW = new WeaponInterfaces(
        1764,
        1767,
        6,
        [FightType.CROSSBOW_ACCURATE,
        FightType.CROSSBOW_RAPID, FightType.CROSSBOW_LONGRANGE],
        7549,
        7561
    )

    public static readonly BALLISTA = new WeaponInterfaces(
        1764,
        1767,
        7,
        [FightType.BALLISTA_ACCURATE,
        FightType.BALLISTA_RAPID, FightType.BALLISTA_LONGRANGE],
        7549,
        7561
    )

    public static readonly BLOWPIPE = new WeaponInterfaces(
        1764,
        1767,
        3,
        [FightType.BLOWPIPE_ACCURATE,
        FightType.BLOWPIPE_RAPID, FightType.BLOWPIPE_LONGRANGE],
        7549,
        7561
    )

    public static readonly KARILS_CROSSBOW = new WeaponInterfaces(
        1764,
        1767,
        4,
        [FightType.KARILS_CROSSBOW_ACCURATE,
        FightType.KARILS_CROSSBOW_RAPID, FightType.KARILS_CROSSBOW_LONGRANGE],
        7549,
        7561
    )

    public static readonly SHORTBOW = new WeaponInterfaces(
        1764,
        1767,
        4,
        [FightType.SHORTBOW_ACCURATE,
        FightType.SHORTBOW_RAPID, FightType.SHORTBOW_LONGRANGE],
        7549,
        7561
    )
    
    public static readonly LONGBOW = new WeaponInterfaces(
        1764,
        1767,
        6,
        [FightType.LONGBOW_ACCURATE,
        FightType.LONGBOW_RAPID, FightType.LONGBOW_LONGRANGE],
        7549,
        7561
    )

    public static readonly DRAGON_DAGGER = new WeaponInterfaces(
        2276,
        2279,
        4,
        [FightType.DRAGON_DAGGER_STAB,
        FightType.DRAGON_DAGGER_LUNGE, FightType.DRAGON_DAGGER_SLASH,
        FightType.DRAGON_DAGGER_BLOCK],
        7574,
        7586
    )

    public static readonly ABYSSAL_DAGGER = new WeaponInterfaces(
        2276,
        2279,
        4,
        [FightType.DRAGON_DAGGER_STAB,
        FightType.DRAGON_DAGGER_LUNGE, FightType.DRAGON_DAGGER_SLASH,
        FightType.DRAGON_DAGGER_BLOCK],
        7574,
        7586
    )

    public static readonly DAGGER = new WeaponInterfaces(
        2276,
        2279,
        4,
        [FightType.DAGGER_STAB,
        FightType.DAGGER_LUNGE, FightType.DAGGER_SLASH,
        FightType.DAGGER_BLOCK],
        7574,
        7586
    )

    public static readonly SWORD = new WeaponInterfaces(
        2276,
        2279,
        4,
        [FightType.SWORD_STAB,
        FightType.SWORD_LUNGE, FightType.SWORD_SLASH,
        FightType.SWORD_BLOCK],
        7574,
        7586
    )

    public static readonly FANG = new WeaponInterfaces(
        2276,
        2279,
        5,
        [FightType.SWORD_STAB,
        FightType.SWORD_LUNGE, FightType.SWORD_SLASH,
        FightType.SWORD_BLOCK],
        7574,
        7586
    )

    public static readonly SCIMITAR = new WeaponInterfaces(
        2423,
        2426,
        4,
        [FightType.SCIMITAR_CHOP,
        FightType.SCIMITAR_SLASH, FightType.SCIMITAR_LUNGE,
        FightType.SCIMITAR_BLOCK],
        7599,
        7611
    )

    public static readonly LONGSWORD = new WeaponInterfaces(
        2423,
        2426,
        5,
        [FightType.LONGSWORD_CHOP,
        FightType.LONGSWORD_SLASH, FightType.LONGSWORD_LUNGE,
        FightType.LONGSWORD_BLOCK],
        7599,
        7611
    )

    public static readonly MACE = new WeaponInterfaces(
        3796,
        3799,
        4,
        [FightType.MACE_POUND,
        FightType.MACE_PUMMEL, FightType.MACE_SPIKE,
        FightType.MACE_BLOCK],
        7624,
        7636
    )

    public static readonly KNIFE = new WeaponInterfaces(
        4446,
        4449,
        3,
        [FightType.KNIFE_ACCURATE,
        FightType.KNIFE_RAPID, FightType.KNIFE_LONGRANGE],
        7649,
        7661
    )

    public static readonly OBBY_RINGS = new WeaponInterfaces(
        4446,
        4449,
        4,
        [FightType.OBBY_RING_ACCURATE,
        FightType.OBBY_RING_RAPID, FightType.OBBY_RING_LONGRANGE],
        7649,
        7661
    )

    public static readonly SPEAR = new WeaponInterfaces(
        4679,
        4682,
        4,
        [FightType.SPEAR_LUNGE,
        FightType.SPEAR_SWIPE, FightType.SPEAR_POUND,
        FightType.SPEAR_BLOCK],
        7674,
        7686
    )

    public static readonly TWO_HANDED_SWORD = new WeaponInterfaces(
        4705,
        4708,
        7,
        [FightType.TWOHANDEDSWORD_CHOP, FightType.TWOHANDEDSWORD_SLASH,
        FightType.TWOHANDEDSWORD_SMASH, FightType.TWOHANDEDSWORD_BLOCK],
        7699,
        7711
    )

    public static readonly PICKAXE = new WeaponInterfaces(
        5570,
        5573,
        5,
        [FightType.PICKAXE_SPIKE,
        FightType.PICKAXE_IMPALE, FightType.PICKAXE_SMASH,
        FightType.PICKAXE_BLOCK]
    )

    public static readonly CLAWS = new WeaponInterfaces(
        7762,
        7765,
        4,
        [FightType.CLAWS_CHOP,
        FightType.CLAWS_SLASH, FightType.CLAWS_LUNGE,
        FightType.CLAWS_BLOCK],
        7800,
        7812
    )

    public static readonly HALBERD = new WeaponInterfaces(
        8460,
        8463,
        7,
        [FightType.HALBERD_JAB,
        FightType.HALBERD_SWIPE, FightType.HALBERD_FEND],
        8493,
        8505
    )

    public static readonly UNARMED = new WeaponInterfaces(
        5855,
        5857,
        4,
        [FightType.UNARMED_PUNCH,
        FightType.UNARMED_KICK, FightType.UNARMED_BLOCK]
    )

    public static readonly WHIP = new WeaponInterfaces(
        12290,
        12293,
        4,
        [FightType.WHIP_FLICK,
        FightType.WHIP_LASH, FightType.WHIP_DEFLECT],
        12323,
        12335
    )

    public static readonly THROWNAXE = new WeaponInterfaces(
        4446,
        4449,
        5,
        [FightType.THROWNAXE_ACCURATE, FightType.THROWNAXE_RAPID,
        FightType.THROWNAXE_LONGRANGE],
        7649,
        7661
    )

    public static readonly DART = new WeaponInterfaces(
        4446,
        4449,
        3,
        [FightType.DART_ACCURATE,
        FightType.DART_RAPID, FightType.DART_LONGRANGE],
        7649,
        7661
    )

    public static readonly JAVELIN = new WeaponInterfaces(
        4446,
        4449,
        6,
        [FightType.JAVELIN_ACCURATE,
        FightType.JAVELIN_RAPID, FightType.JAVELIN_LONGRANGE],
        7649,
        7661
    )

    public static readonly ANCIENT_STAFF = new WeaponInterfaces(
        328,
        355,
        5,
        [FightType.STAFF_BASH, FightType.STAFF_POUND, FightType.STAFF_FOCUS]
    )

    public static readonly DARK_BOW = new WeaponInterfaces(
        1764,
        1767,
        9,
        [FightType.LONGBOW_ACCURATE,
        FightType.LONGBOW_RAPID, FightType.LONGBOW_LONGRANGE],
        7549,
        7561
    )

    public static readonly GODSWORD = new WeaponInterfaces(
        4705,
        4708,
        6,
        [FightType.GODSWORD_CHOP, FightType.GODSWORD_SLASH,
        FightType.GODSWORD_SMASH, FightType.GODSWORD_BLOCK],
        7699,
        7711
    )

    public static readonly ABYSSAL_BLUDGEON = new WeaponInterfaces(
        4705,
        4708,
        4,
        [FightType.ABYSSAL_BLUDGEON_CHOP, FightType.ABYSSAL_BLUDGEON_SLASH,
        FightType.ABYSSAL_BLUDGEON_SMASH, FightType.ABYSSAL_BLUDGEON_BLOCK],
        7699,
        7711
    )

    public static readonly SARADOMIN_SWORD = new WeaponInterfaces(
        4705,
        4708,
        4,
        [FightType.TWOHANDEDSWORD_CHOP, FightType.TWOHANDEDSWORD_SLASH,
        FightType.TWOHANDEDSWORD_SMASH, FightType.TWOHANDEDSWORD_BLOCK],
        7699,
        7711
    )

    public static readonly ELDER_MAUL = new WeaponInterfaces(
        425,
        428,
        6,
        [FightType.ELDER_MAUL_POUND,
        FightType.ELDER_MAUL_PUMMEL, FightType.ELDER_MAUL_BLOCK],
        7474,
        7486
    )

    public static readonly GHRAZI_RAPIER = new WeaponInterfaces(
        2276,
        2279,
        4,
        [FightType.GHRAZI_RAPIER_STAB,
        FightType.GHRAZI_RAPIER_LUNGE, FightType.GHRAZI_RAPIER_SLASH,
        FightType.GHRAZI_RAPIER_BLOCK],
        7574,
        7586
    )
    private static readonly CATEGORIES = new Map<WeaponInterfaces, number>([
        [WeaponInterfaces.UNARMED, 0],
        [WeaponInterfaces.BATTLEAXE, 1], [WeaponInterfaces.GREATAXE, 1],
        [WeaponInterfaces.WARHAMMER, 2], [WeaponInterfaces.GRANITE_MAUL, 2],
        [WeaponInterfaces.SHORTBOW, 3], [WeaponInterfaces.LONGBOW, 3], [WeaponInterfaces.DARK_BOW, 3],
        [WeaponInterfaces.CLAWS, 4],
        [WeaponInterfaces.CROSSBOW, 5], [WeaponInterfaces.BALLISTA, 5], [WeaponInterfaces.KARILS_CROSSBOW, 5],
        [WeaponInterfaces.SCIMITAR, 9], [WeaponInterfaces.LONGSWORD, 9],
        [WeaponInterfaces.TWO_HANDED_SWORD, 10], [WeaponInterfaces.GODSWORD, 10],
        [WeaponInterfaces.PICKAXE, 11], [WeaponInterfaces.HALBERD, 12], [WeaponInterfaces.SCYTHE, 14],
        [WeaponInterfaces.SPEAR, 15], [WeaponInterfaces.MACE, 16], [WeaponInterfaces.VERACS_FLAIL, 16],
        [WeaponInterfaces.DAGGER, 17], [WeaponInterfaces.DRAGON_DAGGER, 17],
        [WeaponInterfaces.ABYSSAL_DAGGER, 17], [WeaponInterfaces.SWORD, 17],
        [WeaponInterfaces.FANG, 17], [WeaponInterfaces.GHRAZI_RAPIER, 17],
        [WeaponInterfaces.SARADOMIN_SWORD, 17],
        [WeaponInterfaces.STAFF, 18], [WeaponInterfaces.ANCIENT_STAFF, 18],
        [WeaponInterfaces.KNIFE, 19], [WeaponInterfaces.OBBY_RINGS, 19],
        [WeaponInterfaces.THROWNAXE, 19], [WeaponInterfaces.DART, 19],
        [WeaponInterfaces.JAVELIN, 19], [WeaponInterfaces.BLOWPIPE, 19],
        [WeaponInterfaces.WHIP, 20],
        [WeaponInterfaces.MAUL, 27], [WeaponInterfaces.ELDER_MAUL, 27],
        [WeaponInterfaces.ABYSSAL_BLUDGEON, 27],
    ]);

    private interfaceId: number;
    private nameLineId: number;
    private speed: number;
    private fightType: {};
    private specialBar: number;
    private specialMeter: number;

    private constructor(interfaceId: number, nameLineId: number, speed: number,
        fightType: {}, specialBar?: number, specialMeter?: number) {
        this.interfaceId = interfaceId;
        this.nameLineId = nameLineId;
        this.speed = speed;
        this.fightType = fightType;
        this.specialBar = specialBar ?? -1;
        this.specialMeter = specialMeter ?? -1;
    }

    public getInterfaceId(): number {
        return this.interfaceId;
    }

    public getNameLineId(): number {
        return this.nameLineId;
    }

    public getSpeed(): number {
        return this.speed;
    }

    public getFightType(){
        return this.fightType;
    }

    public getCategory(): number {
        return WeaponInterfaces.CATEGORIES.get(this) ?? 0;
    }

    public getSpecialBar(): number {
        return this.specialBar;
    }

    public getSpecialMeter(): number {
        return this.specialMeter;
    }
}
