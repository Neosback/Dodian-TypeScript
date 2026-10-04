export class PlayerRights {
    public static NONE = new PlayerRights(0, -1, "")
    public static MODERATOR = new PlayerRights(1, 618)
    public static ADMINISTRATOR = new PlayerRights(2, 619)
    public static OWNER = new PlayerRights(3, 620)
    public static DEVELOPER = new PlayerRights(4, 621)

    private id: number;
    private spriteId: number;
    private yellTag: string;
    constructor(id: number, spriteId: number, yellTag?: string) {
        this.id = id;
        this.spriteId = spriteId;
        this.yellTag = yellTag;
    }
    public getId() {
        return this.id;
    }
    public getSpriteId() {
        return this.spriteId;
    }
    public getYellTag() {
        return this.yellTag;
    }

    public static fromId(id: number): PlayerRights {
        switch (id) {
            case 1: return PlayerRights.MODERATOR;
            case 2: return PlayerRights.ADMINISTRATOR;
            case 3: return PlayerRights.OWNER;
            case 4: return PlayerRights.DEVELOPER;
            default: return PlayerRights.NONE;
        }
    }

    public static fromSpriteId(spriteId: number): PlayerRights {
        switch (spriteId) {
            case 618: return PlayerRights.MODERATOR;
            case 619: return PlayerRights.ADMINISTRATOR;
            case 620: return PlayerRights.OWNER;
            case 621: return PlayerRights.DEVELOPER;
            default: return PlayerRights.NONE;
        }
    }

    /**
     * Returns true for admin-capable rights (administrator/owner/developer).
     * Accepts either a Player instance or a PlayerRights instance.
     */
    public static hasAdminRights(playerOrRights: any): boolean {
        const rights = playerOrRights?.getRights?.() ?? playerOrRights;
        const rightsId = rights?.getId?.();
        return Number.isInteger(rightsId) && rightsId >= PlayerRights.ADMINISTRATOR.getId();
    }
}
