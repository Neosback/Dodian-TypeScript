import { Direction } from './Direction';

export class FacingDirection {
    public static readonly NORTH_WEST = new FacingDirection(Direction.NORTH_WEST);
    public static readonly NORTH = new FacingDirection(Direction.NORTH);
    public static readonly NORTH_EAST = new FacingDirection(Direction.NORTH_EAST);
    public static readonly SOUTH = new FacingDirection(Direction.SOUTH);
    public static readonly SOUTH_EAST = new FacingDirection(Direction.SOUTH_EAST);
    public static readonly SOUTH_WEST = new FacingDirection(Direction.SOUTH_WEST);
    public static readonly EAST = new FacingDirection(Direction.EAST);
    public static readonly WEST = new FacingDirection(Direction.WEST);

    private direction: Direction;

    constructor(direction: Direction) {
        this.direction = direction;
    }
    public getDirection(): Direction {
        return this.direction;
    }
}
