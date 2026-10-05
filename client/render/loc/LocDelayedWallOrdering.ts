import { LocModelType } from "../../rs/config/loctype/LocModelType";
import { unpackLocPlacementMetadata } from "./LocPlacementMetadata";

/**
 * Original software-scene wall masks, indexed by the camera's 3x3 relation to
 * the wall's anchor tile. These names mirror the painter roles rather than the
 * old deobfuscated field names.
 */
export const LOC_FRONT_WALL_TYPES = [19, 55, 38, 155, 255, 110, 137, 205, 76] as const;
export const LOC_DIAGONAL_DELAY_TYPES = [160, 192, 80, 96, 0, 144, 80, 48, 160] as const;
export const LOC_BACK_WALL_TYPES = [76, 8, 137, 4, 0, 1, 38, 2, 19] as const;

/** Per-camera-sector loc-span masks used while a diagonal wall is delayed. */
export const LOC_DIAGONAL_16_BLOCK_SPANS = [0, 0, 2, 0, 0, 2, 1, 1, 0] as const;
export const LOC_DIAGONAL_32_BLOCK_SPANS = [2, 0, 0, 2, 0, 0, 0, 4, 4] as const;
export const LOC_DIAGONAL_64_BLOCK_SPANS = [0, 4, 4, 8, 0, 0, 8, 0, 0] as const;
export const LOC_DIAGONAL_128_BLOCK_SPANS = [1, 1, 0, 0, 0, 8, 0, 0, 8] as const;

export enum LocDiagonalBoundaryPhase {
    NONE = 0,
    FRONT = 1,
    DELAYED = 2,
    BACK = 3,
}

export type LocDelayedWallRule = {
    phase: LocDiagonalBoundaryPhase;
    directionIndex: number;
    orientationMask: number;
    /** Combined tile-edge mask tested by the software painter for delayed walls. */
    wallCullDirection: number;
    /** Loc-span pattern which must clear before the delayed wall is emitted. */
    blockLocSpan: number;
    /** Complementary span retained by the painter while resolving overlap. */
    oppositeLocSpan: number;
};

/**
 * Convert camera-vs-anchor tile position into the software painter's 0..8
 * direction index.
 *
 * X contributes 0/1/2 for camera east/equal/west of the wall tile. Y then
 * contributes 0/3/6 for camera south/equal/north in scene coordinates.
 */
export function getLocPainterDirectionIndex(
    locTileX: number,
    locTileY: number,
    cameraTileX: number,
    cameraTileY: number,
): number {
    let index = 0;
    if (cameraTileX === locTileX) {
        index += 1;
    } else if (cameraTileX < locTileX) {
        index += 2;
    }

    if (cameraTileY === locTileY) {
        index += 3;
    } else if (cameraTileY > locTileY) {
        index += 6;
    }
    return index;
}

/** Type-1/type-3 boundaries use 16/32/64/128 instead of cardinal 1/2/4/8. */
export function getLocDiagonalBoundaryOrientationMask(metadata: number): number {
    const placement = unpackLocPlacementMetadata(metadata);
    if (
        !placement ||
        (placement.type !== LocModelType.WALL_TRI_CORNER &&
            placement.type !== LocModelType.WALL_RECT_CORNER)
    ) {
        return 0;
    }
    return 16 << (placement.rotation & 3);
}

function delayedSpanRule(orientationMask: number, directionIndex: number): [number, number] {
    switch (orientationMask) {
        case 16: {
            const block = LOC_DIAGONAL_16_BLOCK_SPANS[directionIndex];
            return [3, block];
        }
        case 32: {
            const block = LOC_DIAGONAL_32_BLOCK_SPANS[directionIndex];
            return [6, block];
        }
        case 64: {
            const block = LOC_DIAGONAL_64_BLOCK_SPANS[directionIndex];
            return [12, block];
        }
        case 128: {
            const block = LOC_DIAGONAL_128_BLOCK_SPANS[directionIndex];
            return [9, block];
        }
        default:
            return [0, 0];
    }
}

/**
 * Exact camera-sector classification used by the software painter for diagonal
 * type-1/type-3 boundaries. This function is deliberately CPU/reference-only:
 * the next WebGPU step consumes its phase and delayed-span rule without changing
 * these tables.
 */
export function getLocDelayedWallRule(
    metadata: number,
    locTileX: number,
    locTileY: number,
    cameraTileX: number,
    cameraTileY: number,
): LocDelayedWallRule {
    const orientationMask = getLocDiagonalBoundaryOrientationMask(metadata);
    const directionIndex = getLocPainterDirectionIndex(
        locTileX,
        locTileY,
        cameraTileX,
        cameraTileY,
    );

    if (orientationMask === 0) {
        return {
            phase: LocDiagonalBoundaryPhase.NONE,
            directionIndex,
            orientationMask: 0,
            wallCullDirection: 0,
            blockLocSpan: 0,
            oppositeLocSpan: 0,
        };
    }

    if ((orientationMask & LOC_FRONT_WALL_TYPES[directionIndex]) !== 0) {
        return {
            phase: LocDiagonalBoundaryPhase.FRONT,
            directionIndex,
            orientationMask,
            wallCullDirection: 0,
            blockLocSpan: 0,
            oppositeLocSpan: 0,
        };
    }

    if ((orientationMask & LOC_DIAGONAL_DELAY_TYPES[directionIndex]) !== 0) {
        const [wallCullDirection, blockLocSpan] = delayedSpanRule(
            orientationMask,
            directionIndex,
        );
        return {
            phase: LocDiagonalBoundaryPhase.DELAYED,
            directionIndex,
            orientationMask,
            wallCullDirection,
            blockLocSpan,
            oppositeLocSpan: wallCullDirection - blockLocSpan,
        };
    }

    if ((orientationMask & LOC_BACK_WALL_TYPES[directionIndex]) !== 0) {
        return {
            phase: LocDiagonalBoundaryPhase.BACK,
            directionIndex,
            orientationMask,
            wallCullDirection: 0,
            blockLocSpan: 0,
            oppositeLocSpan: 0,
        };
    }

    // The original tables classify every diagonal orientation in every camera
    // sector. Keep an explicit NONE fallback so malformed metadata stays safe.
    return {
        phase: LocDiagonalBoundaryPhase.NONE,
        directionIndex,
        orientationMask,
        wallCullDirection: 0,
        blockLocSpan: 0,
        oppositeLocSpan: 0,
    };
}
