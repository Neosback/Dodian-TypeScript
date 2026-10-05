import { LocModelType } from "../../rs/config/loctype/LocModelType";
import {
    LocPlacementClassFlag,
    hasLocPlacementClass,
    unpackLocPlacementMetadata,
} from "./LocPlacementMetadata";

/**
 * Camera-relative scene ordering offsets, expressed in tiles exactly as the
 * WebGPU porting guide specifies them. Positive values mean "pull toward the
 * camera"; negative values mean "push away from the camera". The backend is
 * responsible for translating that semantic sign into its view/depth space.
 */
export const OBJECT_GROUND_PULL = 3 / 128;
export const WALL_DECORATION_PULL = 2 / 128;
export const WALL_BEHIND_PUSH = 10 / 128;
export const ROOF_DEPTH_PULL = 8 / 128;
export const PLANE_DEPTH_BIAS = 2 / 128;

/**
 * Original client boundary orientation bits. These are intentionally named by
 * coordinate direction instead of compass direction because scene Y/Z naming
 * differs between renderer layers.
 */
export enum LocCardinalEdgeMask {
    NONE = 0,
    X_NEG = 1,
    Y_POS = 2,
    X_POS = 4,
    Y_NEG = 8,
}

export type LocDepthOrderingContext = {
    /** Object anchor tile in scene/world tile coordinates. */
    locTileX: number;
    locTileY: number;
    /** Camera tile, matching the software Scene painter's coarse side test. */
    cameraTileX: number;
    cameraTileY: number;
    /** Object centre in client units, used by diagonal decoration types 6..8. */
    locCenterX: number;
    locCenterY: number;
    /** Camera position in client units, used by diagonal decoration types 6..8. */
    cameraX: number;
    cameraY: number;
    plane: number;
};

/** The deob's Tiles.field964 rotation table: {1, 2, 4, 8}. */
export function getCardinalEdgeMaskForRotation(rotation: number): LocCardinalEdgeMask {
    return (1 << (rotation & 3)) as LocCardinalEdgeMask;
}

/**
 * Return the cardinal boundary edge represented by one rendered scene part.
 *
 * Type 2 (WALL_CORNER) has two boundary renderables. The original client gives
 * entity0 the source rotation edge and entity1 the next clockwise edge, which
 * is why secondaryPart is part of the placement metadata contract.
 *
 * Types 1 and 3 deliberately return NONE: the software client represents them
 * with diagonal orientation bits 16/32/64/128, not the cardinal 1/2/4/8 mask.
 * Decoration types 6..8 likewise use the special orientation=256 camera test.
 */
export function getLocCardinalEdgeMask(metadata: number): LocCardinalEdgeMask {
    const placement = unpackLocPlacementMetadata(metadata);
    if (!placement) {
        return LocCardinalEdgeMask.NONE;
    }

    switch (placement.type) {
        case LocModelType.WALL:
            return getCardinalEdgeMaskForRotation(placement.rotation);
        case LocModelType.WALL_CORNER:
            return getCardinalEdgeMaskForRotation(
                placement.rotation + (placement.secondaryPart ? 1 : 0),
            );
        case LocModelType.WALL_DECORATION_INSIDE:
        case LocModelType.WALL_DECORATION_OUTSIDE:
            return getCardinalEdgeMaskForRotation(placement.rotation);
        default:
            return LocCardinalEdgeMask.NONE;
    }
}

/**
 * Match the software Scene painter's camera-tile side test for cardinal edges.
 * A camera in the same tile is not considered outside any edge.
 */
export function isCameraOutsideCardinalEdge(
    edgeMask: number,
    locTileX: number,
    locTileY: number,
    cameraTileX: number,
    cameraTileY: number,
): boolean {
    if ((edgeMask & LocCardinalEdgeMask.X_NEG) !== 0 && cameraTileX < locTileX) {
        return true;
    }
    if ((edgeMask & LocCardinalEdgeMask.X_POS) !== 0 && cameraTileX > locTileX) {
        return true;
    }
    if ((edgeMask & LocCardinalEdgeMask.Y_NEG) !== 0 && cameraTileY < locTileY) {
        return true;
    }
    if ((edgeMask & LocCardinalEdgeMask.Y_POS) !== 0 && cameraTileY > locTileY) {
        return true;
    }
    return false;
}

/**
 * Exact orientation=256 wall-decoration comparison from the software client.
 * `deltaX`/`deltaY` are decoration centre minus camera position, in client
 * units. True means renderable1 (our primary scene part) wins the painter test.
 */
export function isPrimaryDiagonalWallDecorationFacingCamera(
    orientation2: number,
    deltaX: number,
    deltaY: number,
): boolean {
    const rotation = orientation2 & 3;
    const compareX = rotation !== 1 && rotation !== 2 ? deltaX : -deltaX;
    const compareY = rotation !== 2 && rotation !== 3 ? deltaY : -deltaY;
    return compareY < compareX;
}

/**
 * Reproduce the original wall-decoration part selection for model types 6..8.
 *
 * Type 6: orientation2 = source rotation, one primary renderable.
 * Type 7: orientation2 = source rotation + 2, one primary renderable.
 * Type 8: orientation2 = source rotation, primary/secondary alternate by side.
 * Types 4/5 use cardinal painter ordering and remain visible on either side.
 */
export function isLocPlacementPartVisible(
    metadata: number,
    locCenterX: number,
    locCenterY: number,
    cameraX: number,
    cameraY: number,
): boolean {
    const placement = unpackLocPlacementMetadata(metadata);
    if (!placement) {
        return true;
    }

    const deltaX = locCenterX - cameraX;
    const deltaY = locCenterY - cameraY;

    switch (placement.type) {
        case LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE: {
            if (placement.secondaryPart) {
                return false;
            }
            return isPrimaryDiagonalWallDecorationFacingCamera(
                placement.rotation,
                deltaX,
                deltaY,
            );
        }
        case LocModelType.WALL_DECORATION_DIAGONAL_INSIDE: {
            if (placement.secondaryPart) {
                return false;
            }
            return isPrimaryDiagonalWallDecorationFacingCamera(
                placement.rotation + 2,
                deltaX,
                deltaY,
            );
        }
        case LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE: {
            const primaryVisible = isPrimaryDiagonalWallDecorationFacingCamera(
                placement.rotation,
                deltaX,
                deltaY,
            );
            return placement.secondaryPart ? !primaryVisible : primaryVisible;
        }
        default:
            return true;
    }
}

export function getPlaneDepthPullTiles(plane: number): number {
    return Math.max(0, plane | 0) * PLANE_DEPTH_BIAS;
}

/**
 * Semantic per-loc camera pull before the universal plane bias is added.
 *
 * Cardinal walls/decorations follow the software painter's camera-side rule.
 * Diagonal boundary pieces (types 1/3) intentionally receive no guessed wall
 * offset until their 16/32/64/128 delayed-object ordering is ported. Diagonal
 * decorations (6..8) use their exact visibility rule above and pull only the
 * part the original client would draw.
 */
export function getLocBaseCameraPullTiles(
    metadata: number,
    context: Omit<LocDepthOrderingContext, "plane">,
): number {
    const placement = unpackLocPlacementMetadata(metadata);
    if (!placement) {
        return 0;
    }

    if (hasLocPlacementClass(metadata, LocPlacementClassFlag.ROOF)) {
        return ROOF_DEPTH_PULL;
    }

    if (hasLocPlacementClass(metadata, LocPlacementClassFlag.WALL_PIECE)) {
        const edgeMask = getLocCardinalEdgeMask(metadata);
        if (edgeMask === LocCardinalEdgeMask.NONE) {
            return 0;
        }
        const outside = isCameraOutsideCardinalEdge(
            edgeMask,
            context.locTileX,
            context.locTileY,
            context.cameraTileX,
            context.cameraTileY,
        );
        return outside ? 0 : -WALL_BEHIND_PUSH;
    }

    if (hasLocPlacementClass(metadata, LocPlacementClassFlag.WALL_DECORATION)) {
        if (
            placement.type === LocModelType.WALL_DECORATION_INSIDE ||
            placement.type === LocModelType.WALL_DECORATION_OUTSIDE
        ) {
            const edgeMask = getLocCardinalEdgeMask(metadata);
            const outside = isCameraOutsideCardinalEdge(
                edgeMask,
                context.locTileX,
                context.locTileY,
                context.cameraTileX,
                context.cameraTileY,
            );
            return outside ? -WALL_DECORATION_PULL : WALL_DECORATION_PULL;
        }

        return isLocPlacementPartVisible(
            metadata,
            context.locCenterX,
            context.locCenterY,
            context.cameraX,
            context.cameraY,
        )
            ? WALL_DECORATION_PULL
            : 0;
    }

    // The remaining placed loc shapes are ground/game-object pieces. This
    // includes the client's type-9 diagonal game object and ordinary 10/11
    // scenery as well as floor decorations.
    if (
        placement.type === LocModelType.WALL_DIAGONAL ||
        placement.type === LocModelType.NORMAL ||
        placement.type === LocModelType.NORMAL_DIAGIONAL ||
        placement.type === LocModelType.FLOOR_DECORATION
    ) {
        return OBJECT_GROUND_PULL;
    }

    return 0;
}

export function getLocCameraPullTiles(
    metadata: number,
    context: LocDepthOrderingContext,
): number {
    return getPlaneDepthPullTiles(context.plane) + getLocBaseCameraPullTiles(metadata, context);
}
