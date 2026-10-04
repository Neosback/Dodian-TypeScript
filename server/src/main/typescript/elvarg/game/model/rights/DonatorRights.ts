export class DonatorRights {
    public static NONE = { id: 0, spriteId: -1, yellDelay: -1, yellTag: "" };
    public static REGULAR_DONATOR = { id: 1, spriteId: 622, yellDelay: 40, yellTag: "[Donator]" };
    public static SUPER_DONATOR = { id: 2, spriteId: 623, yellDelay: 25, yellTag: "[Super Donator]" };
    public static UBER_DONATOR = { id: 3, spriteId: 624, yellDelay: 10, yellTag: "[Uber Donator]" };

    public static getId(rights: any) {
        return rights?.id ?? 0;
    }

    public static getSpriteId(rights: any) {
        return rights?.spriteId ?? -1;
    }

    public static getYellDelay(rights: any) {
        return rights?.yellDelay ?? -1;
    }

    public static getYellTag(rights: any) {
        return rights?.yellTag ?? "";
    }

    public static fromId(id: number): typeof DonatorRights.NONE {
        switch (id) {
            case 1: return DonatorRights.REGULAR_DONATOR;
            case 2: return DonatorRights.SUPER_DONATOR;
            case 3: return DonatorRights.UBER_DONATOR;
            default: return DonatorRights.NONE;
        }
    }

    public static fromSpriteId(spriteId: number): typeof DonatorRights.NONE {
        switch (spriteId) {
            case 622: return DonatorRights.REGULAR_DONATOR;
            case 623: return DonatorRights.SUPER_DONATOR;
            case 624: return DonatorRights.UBER_DONATOR;
            default: return DonatorRights.NONE;
        }
    }
}
