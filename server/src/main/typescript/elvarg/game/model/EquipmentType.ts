// Avoid importing Equipment to prevent circular bootstrap with ItemDefinition/Equipment/ItemContainer.
const HEAD_SLOT = 0;
const CAPE_SLOT = 1;
const AMULET_SLOT = 2;
const WEAPON_SLOT = 3;
const BODY_SLOT = 4;
const SHIELD_SLOT = 5;
const LEG_SLOT = 7;
const HANDS_SLOT = 9;
const FEET_SLOT = 10;
const RING_SLOT = 12;
const AMMUNITION_SLOT = 13;

export class EquipmentType {
    public static readonly HOODED_CAPE = new EquipmentType(CAPE_SLOT);
    public static readonly CAPE = new EquipmentType(CAPE_SLOT);
    public static readonly SHIELD = new EquipmentType(SHIELD_SLOT);
    public static readonly GLOVES =  new EquipmentType(HANDS_SLOT);
    public static readonly BOOTS =  new EquipmentType(FEET_SLOT);
    public static readonly AMULET = new EquipmentType(AMULET_SLOT);
    public static readonly RING = new EquipmentType(RING_SLOT);
    public static readonly ARROWS = new EquipmentType(AMMUNITION_SLOT);
    public static readonly COIF = new EquipmentType(HEAD_SLOT);
    public static readonly HAT =  new EquipmentType(HEAD_SLOT);
    public static readonly MASK =  new EquipmentType(HEAD_SLOT);
    public static readonly MED_HELMET = new EquipmentType(HEAD_SLOT);
    public static readonly FULL_HELMET = new EquipmentType(HEAD_SLOT);
    public static readonly BODY = new EquipmentType(BODY_SLOT);
    public static readonly PLATEBODY =  new EquipmentType(BODY_SLOT);
    public static readonly LEGS = new EquipmentType(LEG_SLOT);
    public static readonly WEAPON =  new EquipmentType(WEAPON_SLOT);
    public static readonly NONE = new EquipmentType(-1);

    private slot: number;

    constructor(slot: number) {
        this.slot = slot;
    }

    public getSlot() {
        return this.slot;
    }
}
