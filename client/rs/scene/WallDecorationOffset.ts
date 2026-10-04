import { LocModelType } from "../config/loctype/LocModelType";
import { LocType } from "../config/loctype/LocType";

/** Unit step (per rotation) a wall decoration is pushed along, away from the wall it hangs on. */
const DISPLACEMENT_X = [1, 0, -1, 0];
const DISPLACEMENT_Y = [0, -1, 0, 1];
const DIAGONAL_DISPLACEMENT_X = [1, -1, -1, 1];
const DIAGONAL_DISPLACEMENT_Y = [-1, -1, 1, 1];

export type WallDecorationOffset = { x: number; y: number };

/**
 * How far a wall decoration of the given shape sits off the tile centre, the way the client places it: the "outside"
 * decoration (5) is pushed by the `decorDisplacement` of the wall on its tile (16 when there is none), the diagonal
 * ones (6, 8) by half of it, and the "inside" ones (4, 7) are not pushed at all.
 */
export function wallDecorationOffset(
    type: number,
    rotation: number,
    wallDisplacement: number = LocType.DEFAULT_DECOR_DISPLACEMENT,
): WallDecorationOffset {
    const rot = rotation & 3;
    if (type === LocModelType.WALL_DECORATION_OUTSIDE) {
        return { x: wallDisplacement * DISPLACEMENT_X[rot], y: wallDisplacement * DISPLACEMENT_Y[rot] };
    }
    if (
        type === LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE ||
        type === LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE
    ) {
        const half = (wallDisplacement / 2) | 0;
        return { x: half * DIAGONAL_DISPLACEMENT_X[rot], y: half * DIAGONAL_DISPLACEMENT_Y[rot] };
    }
    return { x: 0, y: 0 };
}

/** The decoration's current distance from its wall, recovered from an offset already in place (any rotation). */
function displacementFromOffset(type: number, offsetX: number, offsetY: number): number {
    if (type === LocModelType.WALL_DECORATION_OUTSIDE) {
        return Math.abs(offsetX) + Math.abs(offsetY);
    }
    // Diagonal offsets are `half` on both axes; wallDecorationOffset halves again.
    return Math.max(Math.abs(offsetX), Math.abs(offsetY)) * 2;
}

/**
 * The same decoration turned to `rotation`: it keeps its distance from the wall but is pushed the other way. Without
 * this a rotated decoration keeps the old side's offset and ends up inside (or behind) its wall.
 */
export function rotateWallDecorationOffset(
    type: number,
    rotation: number,
    offsetX: number,
    offsetY: number,
): WallDecorationOffset {
    if (offsetX === 0 && offsetY === 0) {
        return { x: 0, y: 0 };
    }
    return wallDecorationOffset(type, rotation, displacementFromOffset(type, offsetX, offsetY));
}

/**
 * The client draws an "inside"/"outside" wall decoration 1 unit toward the tile interior from where its offset puts
 * it (`WallDecoration.method6262`: orientation 1 -> x+1, 2 -> z-1, 4 -> x-1, 8 -> z+1). That also leaves the interior
 * direction readable from the placed position, which the shader uses to decide which way the decoration faces.
 */
const NUDGE_X = [1, 0, -1, 0];
const NUDGE_Y = [0, -1, 0, 1];

export function wallDecorationNudge(type: number, rotation: number): WallDecorationOffset {
    if (type !== LocModelType.WALL_DECORATION_INSIDE && type !== LocModelType.WALL_DECORATION_OUTSIDE) {
        return { x: 0, y: 0 };
    }
    const rot = rotation & 3;
    return { x: NUDGE_X[rot], y: NUDGE_Y[rot] };
}

/**
 * Where an "inside" decoration (4) has to stand so a depth-buffered view shows it the way the client does.
 *
 * Its model is authored flush with the tile edge, which is inside the thickness of a wall standing on that same edge.
 * The client paints such a decoration over the wall (and under it when the camera is beyond the edge), with no depth
 * test between the two. With a depth buffer it sinks into the wall and shows only at grazing angles, so it is stood
 * on the wall's inner face instead, exactly where the "outside" decoration (5) of the same wall goes. Seen from the
 * inside nothing changes; from the outside the wall covers it, as in the client.
 *
 * Only a straight wall (0) on the decoration's edge, or either leg of an L-wall (2), holds it; walls and
 * decorations on neighbouring tiles are not in the way and stay where they are.
 */
export function embeddedWallDecorationShift(
    decorationType: number,
    decorationRotation: number,
    wallType: number,
    wallRotation: number,
    wallDisplacement: number = LocType.DEFAULT_DECOR_DISPLACEMENT,
): WallDecorationOffset {
    const decRot = decorationRotation & 3;
    const wallRot = wallRotation & 3;

    if (decorationType === LocModelType.WALL_DECORATION_INSIDE) {
        const onEdge =
            (wallType === LocModelType.WALL && wallRot === decRot) ||
            (wallType === LocModelType.WALL_CORNER && (wallRot === decRot || ((wallRot + 1) & 3) === decRot));
        if (!onEdge) {
            return { x: 0, y: 0 };
        }
        return wallDecorationOffset(LocModelType.WALL_DECORATION_OUTSIDE, decRot, wallDisplacement);
    }

    if (
        decorationType === LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE ||
        decorationType === LocModelType.WALL_DECORATION_DIAGONAL_INSIDE ||
        decorationType === LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE
    ) {
        if (wallType === LocModelType.WALL_DIAGONAL) {
            // Diagonal wall (shape 9) rotation 1 and 3 share the diagonal axis, as do 0 and 2.
            // If the wall is rotated 180 deg relative to the decoration (e.g. wallRot 3 vs decRot 1),
            // the wall thickness is on the opposite face, so the decoration must be shifted along
            // the wall normal to stay flush against both faces.
            if (wallRot === ((decRot + 2) & 3)) {
                return wallDecorationOffset(LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE, wallRot, wallDisplacement);
            }
        }
    }

    return { x: 0, y: 0 };
}
