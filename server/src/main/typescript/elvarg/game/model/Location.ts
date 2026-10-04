import { Misc } from '../../util/Misc';
import { Direction } from './Direction';

export class Location {

    /**
     * The x coordinate of the position.
     */
    public x: number;
    /**
     * The y coordinate of the position.
     */
    public y: number;
    /**
     * The height level of the position.
     */
    public z: number;

    /**
     * The Position constructor.
     *
     * @param x The x-type coordinate of the position.
     * @param y The y-type coordinate of the position.
     * @param z The height of the position.
     */
    constructor(x: number, y: number, z?: number) {
        this.x = x;
        this.y = y;
        this.z = z ?? 0;
    }

    private static readAxis(source: any, axis: "X" | "Y" | "Z"): number | null {
        if (!source) {
            return null;
        }
        const getter = source[`get${axis}`];
        const fallback = source[axis.toLowerCase()];
        const value = typeof getter === "function" ? getter.call(source) : fallback;
        return Number.isFinite(value) ? value : null;
    }

    public static readTile(source: any): Location | null {
        const x = Location.readAxis(source, "X");
        const y = Location.readAxis(source, "Y");
        const z = Location.readAxis(source, "Z");
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            return null;
        }
        return new Location(x, y, z);
    }

    public static isSameTile(a: any, b: any): boolean {
        const left = Location.readTile(a);
        const right = Location.readTile(b);
        return !!left && !!right && left.x === right.x && left.y === right.y && left.z === right.z;
    }

    /**
     * Gets the x coordinate of this position.
     *
     * @return The associated x coordinate.
     */
    public getX(): number {
        return this.x;
    }

    setX(x: number): Location {
        this.x = x;
        return this;
    }

    getY(): number {
        return this.y;
    }

    setY(y: number): Location {
        this.y = y;
        return this;
    }

    getZ(): number {
        return this.z;
    }

    setZ(z: number): Location {
        this.z = z;
        return this;
    }

    set(x: number, y: number, z: number): void {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    setAs(other: Location): void {
        this.x = other.x;
        this.y = other.y;
        this.z = other.z;
    }

    getLocalX(position: Location): number {
        return this.x - 8 * position.getRegionX();
    }

    getLocalY(position: Location): number {
        return this.y - 8 * position.getRegionY();
    }

    getRegionX(): number {
        return (this.x >> 3) - 6;
    }

    getRegionY(): number {
        return (this.y >> 3) - 6;
    }

    add(x: number, y: number): Location {
        this.x += x;
        this.y += y;
        return this;
    }

    addX(x: number): Location {
        this.x += x;
        return this;
    }

    addY(y: number): Location {
        this.y += y;
        return this;
    }

    transform(x: number, y: number): Location {
        return this.clone().addX(x).addY(y);
    }

    clone(): Location {
        let location = new Location(this.x, this.y);
        location.x = this.x;
        location.y = this.y;
        location.z = this.z;
        return location;
    }

    isPerpendicularTo(other: Location): boolean {
        let delta = Misc.delta(this, other);
        return delta.x !== delta.y && delta.x === 0 || delta.y === 0;
    }

    isWithinDistance(other: Location, distance: number): boolean {
        if (this.z !== other.z) {
            return false;
        }
        let deltaX = Math.abs(this.x - other.x);
        let deltaY = Math.abs(this.y - other.y);
        return deltaX <= distance && deltaY <= distance;
    }

    isWithinInteractionDistance(other: Location): boolean {
        if (this.z !== other.z) {
            return false;
        }
        let deltaX = other.x - this.x, deltaY = other.y - this.y;
        return deltaX <= 2 && deltaX >= -3 && deltaY <= 2 && deltaY >= -3;
    }

    getDistance(other: Location): number {
        if (this.z !== other.z) {
            return Number.MAX_SAFE_INTEGER;
        }
        const deltaX = Math.abs(this.x - other.x);
        const deltaY = Math.abs(this.y - other.y);
        // Tile distance for movement/reach checks in RS-style grid logic.
        return Math.max(deltaX, deltaY);
    }

    move(position: Location): Location {
        let x = (this.x + position.x);
        let y = (this.y + position.y);
        let z = (this.z + position.z);
        return new Location(x, y);
    }

    getMove(direction: Direction): Location {
        return this.move(new Location(direction.x, direction.y));
    }

    static delta(a: Location, b: Location): Location {
        return new Location(b.x - a.x, b.y - a.y);
    }

    distanceToPoint(pointX: number, pointY: number): number {
        return Math.sqrt(Math.pow(this.x - pointX, 2) + Math.pow(this.y - pointY, 2));
    }

    calculateDistance(other: Location): number {
        return this.getDistance(other);
    }

    static calculateDistance(tiles: Location[], otherTiles: Location[]): number {
        let lowestCount = Number.MAX_SAFE_INTEGER;

        for (let tile of tiles) {
            for (let toTile of otherTiles) {
                if (tile === toTile) {
                    return 0;
                }

                let distance = tile.calculateDistance(toTile);
                if (distance < lowestCount) {
                    lowestCount = distance;
                }
            }
        }

        return lowestCount;
    }

    toString(): string {
        return "[" + this.x + ", " + this.y + ", " + this.z + "]";
    }

    hashCode(): number {
        return this.z << 30 | this.x << 15 | this.y;
    }

    equals(other: any): boolean {
        if (!(other instanceof Location)) {
            return false;
        }
        let position = other as Location;
        return position.x == this.x && position.y == this.y && position.z == this.z;
    }

    isViewableFrom(other: Location): boolean {
        return this.isViewableFromWithin(other, 15);
    }

    /**
     * Hot path: called O(players x candidates) per cycle by the local-player rebuild.
     * Deliberately does not go through Misc.delta, which allocates a Location per
     * call and made this the largest single source of GC pressure under load.
     */
    isViewableFromWithin(other: Location, distance: number): boolean {
        if (this.z !== other.z) {
            return false;
        }
        const dx = other.x - this.x;
        if (dx > distance || dx < -distance) {
            return false;
        }
        const dy = other.y - this.y;
        return dy <= distance && dy >= -distance;
    }

    getTranslate(x: number, y: number): Location {
        return this.translate(x, y, 0);
    }

    translate(x: number, y: number, z: number): Location {
        return new Location(this.x + x, this.y + y);
    }

    rotate(degrees: number): Location {
        let rx = Math.floor((this.x * Math.cos(degrees)) - (this.y * Math.sin(degrees)));
        let ry = Math.floor((this.x * Math.sin(degrees)) + (this.y * Math.cos(degrees)));
        return new Location(rx, ry);
    }
}
