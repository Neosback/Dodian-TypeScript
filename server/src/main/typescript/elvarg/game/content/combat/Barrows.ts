import { Equipment } from "../../model/container/impl/Equipment";

const BASE_ITEMS = [
    4708, 4710, 4712, 4714, 4716, 4718, 4720, 4722,
    4724, 4726, 4728, 4730, 4732, 4734, 4736, 4738,
    4745, 4747, 4749, 4751, 4753, 4755, 4757, 4759,
];

const SETS = {
    ahrims: [4708, 4712, 4714, 4710],
    dharoks: [4716, 4720, 4722, 4718],
    guthans: [4724, 4728, 4730, 4726],
    karils: [4732, 4736, 4738, 4734],
    torags: [4745, 4749, 4751, 4747],
    veracs: [4753, 4757, 4759, 4755],
} as const;

export class Barrows {
    public static readonly AMULET_OF_THE_DAMNED_FULL = 12851;
    public static readonly AMULET_OF_THE_DAMNED = 12853;

    public static baseItemId(itemId: number): number | null {
        const index = BASE_ITEMS.indexOf(itemId);
        if (index !== -1) return itemId;
        if (itemId < 4856 || itemId >= 5000) return null;
        const stage = (itemId - 4856) % 6;
        if (stage === 5) return null; // noted broken item
        const itemIndex = Math.floor((itemId - 4856) / 6);
        return BASE_ITEMS[itemIndex] ?? null;
    }

    public static stageItemId(baseItemId: number, stage: number): number | null {
        const index = BASE_ITEMS.indexOf(baseItemId);
        return index === -1 ? null : 4856 + index * 6 + stage;
    }

    public static isBarrowsItem(itemId: number): boolean {
        return this.baseItemId(itemId) != null;
    }

    public static isBroken(itemId: number): boolean {
        return itemId >= 4856 && itemId < 5000 && (itemId - 4856) % 6 === 4;
    }

    public static hasFullSet(player: any, set: keyof typeof SETS): boolean {
        const items = player?.getEquipment?.()?.getItems?.() ?? [];
        return SETS[set].every((baseItemId) =>
            items.some((item: any) => this.baseItemId(item?.getId?.()) === baseItemId && !this.isBroken(item.getId()))
        );
    }

    public static hasDamnedAmulet(player: any): boolean {
        const id = player?.getEquipment?.()?.get?.(Equipment.AMULET_SLOT)?.getId?.();
        return id === this.AMULET_OF_THE_DAMNED_FULL || id === this.AMULET_OF_THE_DAMNED;
    }

    public static hasDamnedSet(player: any, set: keyof typeof SETS): boolean {
        return this.hasFullSet(player, set) && this.hasDamnedAmulet(player);
    }
}
