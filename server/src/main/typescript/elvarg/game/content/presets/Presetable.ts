import {Item} from '../../model/Item';
import {MagicSpellbook} from '../../model/MagicSpellbook';

export class Presetable {
    /**
 * This set's name.
 */
    protected name: string;

    /**
     * This set's inventory.
     */
    private inventory: Item[];

    /**
     * This set's equipment.
     */
    private equipment: Item[];

    /**
     * This set's skill levels.
     */
    private stats: number[];

    /**
     * This set's magic spellbook.
     */
    private spellbook: MagicSpellbook;

    /**
     * Is this a global preset?
     */
    private readonly isGlobal: boolean;

    /**
     * Optional autocast spell id to apply when this preset is loaded.
     * Use -1 to indicate no preset autocast preference.
     */
    private autocastSpellId: number;

    constructor(
        name: string,
        inventory: Item[],
        equipment: Item[],
        stats: number[],
        spellbook,
        isGlobal: boolean,
        autocastSpellId: number = -1
    ) {
        this.isGlobal = false;
        this.name = name;
        this.inventory = inventory;
        this.equipment = equipment;
        this.stats = stats;
        this.spellbook = spellbook;
        this.isGlobal = isGlobal;
        this.autocastSpellId = Number.isInteger(autocastSpellId) ? autocastSpellId : -1;
    }

    public getAmount(itemId: number): number {
        let count = 0;
        for (const item of [...this.inventory, ...this.equipment]) {
            if (!item) continue;
            if (item.getId() === itemId) {
                count += item.getAmount();
            }
        }
        return count;
    }

    public getName(): string {
        return this.name;
    }

    public setName(name: string): void {
        this.name = name;
    }

    public getInventory(): Item[] {
        return this.inventory;
    }

    public setInventory(inventory: Item[]): void {
        this.inventory = inventory;
    }

    public getEquipment(): Item[] {
        return this.equipment;
    }

    public setEquipment(equipment: Item[]): void {
        this.equipment = equipment;
    }

    public getStats(): number[] {
        return this.stats;
    }

    public setStats(stats: number[]) {
        this.stats = stats;
    }

    public getSpellbook(): MagicSpellbook {
        return this.spellbook;
    }

    public setSpellbook(spellbook: MagicSpellbook) {
        this.spellbook = spellbook;
    }

    public getIsGlobal(): boolean {
        return this.isGlobal;
    }

    public getAutocastSpellId(): number {
        return Number.isInteger(this.autocastSpellId) ? this.autocastSpellId : -1;
    }

    public setAutocastSpellId(autocastSpellId: number): void {
        this.autocastSpellId = Number.isInteger(autocastSpellId) ? autocastSpellId : -1;
    }

}
