import { LocModelType } from "../../rs/config/loctype/LocModelType";
import {
    decodeLocPlacementFootprint,
    unpackLocPlacementMetadata,
} from "./LocPlacementMetadata";

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
 * type-1/type-3 boundaries.
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

    return {
        phase: LocDiagonalBoundaryPhase.NONE,
        directionIndex,
        orientationMask: 0,
        wallCullDirection: 0,
        blockLocSpan: 0,
        oppositeLocSpan: 0,
    };
}

export type LocTileFootprint = {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
};

/**
 * Recreate the four-bit per-tile span mask attached to a multi-tile loc by the
 * software scene. The bits describe which other covered tiles continue away
 * from the queried tile: west=1, north=2, east=4, south=8 in the original
 * painter's tile-edge convention.
 */
export function getLocFootprintSpanMaskAtTile(
    footprint: LocTileFootprint,
    tileX: number,
    tileY: number,
): number {
    if (
        tileX < footprint.startX ||
        tileX > footprint.endX ||
        tileY < footprint.startY ||
        tileY > footprint.endY
    ) {
        return 0;
    }

    let mask = 0;
    if (tileX > footprint.startX) mask |= 1;
    if (tileY < footprint.endY) mask |= 2;
    if (tileX < footprint.endX) mask |= 4;
    if (tileY > footprint.startY) mask |= 8;
    return mask;
}

/**
 * Minimal CPU description of one submitted static-model draw. Anchors are in
 * world-tile coordinates so this ordering layer is independent of map borders
 * and map-square/world-entity placement details.
 */
export type LocDelayedWallDrawItem = {
    plane: number;
    placementMetadata: number;
    anchorX: number;
    anchorY: number;
    encodedFootprint: number;
};

function isLocSpanPlacement(metadata: number): boolean {
    const placement = unpackLocPlacementMetadata(metadata);
    return (
        !!placement &&
        placement.type >= LocModelType.WALL_DIAGONAL &&
        placement.type <= LocModelType.ROOF_SLOPED_OVERHANG_HARD_OUTER_CORNER
    );
}

function footprintForOrdering(item: LocDelayedWallDrawItem): LocTileFootprint | undefined {
    if (item.anchorX < 0 || item.anchorY < 0 || !isLocSpanPlacement(item.placementMetadata)) {
        return undefined;
    }
    const size = decodeLocPlacementFootprint(item.encodedFootprint) ?? { sizeX: 1, sizeY: 1 };
    return {
        startX: item.anchorX,
        startY: item.anchorY,
        endX: item.anchorX + size.sizeX - 1,
        endY: item.anchorY + size.sizeY - 1,
    };
}

function footprintContainsTile(footprint: LocTileFootprint, tileX: number, tileY: number): boolean {
    return (
        tileX >= footprint.startX &&
        tileX <= footprint.endX &&
        tileY >= footprint.startY &&
        tileY <= footprint.endY
    );
}

/**
 * Build a stable draw order which reproduces the software painter's local
 * diagonal-boundary constraints while preserving the caller's baseline order
 * wherever no painter dependency exists.
 *
 * FRONT walls precede every overlapping scene loc. BACK walls follow them all.
 * DELAYED walls follow only locs whose span mask matches BlockLocSpans and
 * precede overlapping non-blockers, matching the original release condition.
 */
export function createLocDelayedWallDrawOrder(
    items: readonly LocDelayedWallDrawItem[],
    cameraTileX: number,
    cameraTileY: number,
): number[] {
    const count = items.length;
    if (count <= 1) {
        return count === 0 ? [] : [0];
    }

    const footprints: Array<LocTileFootprint | undefined> = new Array(count);
    for (let i = 0; i < count; i++) {
        footprints[i] = footprintForOrdering(items[i]);
    }

    const outgoing: Array<Set<number>> = Array.from({ length: count }, () => new Set<number>());
    const indegree = new Int32Array(count);
    const addConstraint = (before: number, after: number): void => {
        if (before === after || outgoing[before].has(after)) {
            return;
        }
        outgoing[before].add(after);
        indegree[after]++;
    };

    for (let wallIndex = 0; wallIndex < count; wallIndex++) {
        const wall = items[wallIndex];
        if (wall.anchorX < 0 || wall.anchorY < 0) {
            continue;
        }
        const rule = getLocDelayedWallRule(
            wall.placementMetadata,
            wall.anchorX,
            wall.anchorY,
            cameraTileX,
            cameraTileY,
        );
        if (rule.phase === LocDiagonalBoundaryPhase.NONE) {
            continue;
        }

        for (let locIndex = 0; locIndex < count; locIndex++) {
            if (locIndex === wallIndex || items[locIndex].plane !== wall.plane) {
                continue;
            }
            const footprint = footprints[locIndex];
            if (!footprint || !footprintContainsTile(footprint, wall.anchorX, wall.anchorY)) {
                continue;
            }

            if (rule.phase === LocDiagonalBoundaryPhase.FRONT) {
                addConstraint(wallIndex, locIndex);
                continue;
            }
            if (rule.phase === LocDiagonalBoundaryPhase.BACK) {
                addConstraint(locIndex, wallIndex);
                continue;
            }

            const span = getLocFootprintSpanMaskAtTile(footprint, wall.anchorX, wall.anchorY);
            const blocks = (span & rule.wallCullDirection) === rule.blockLocSpan;
            if (blocks) {
                addConstraint(locIndex, wallIndex);
            } else {
                addConstraint(wallIndex, locIndex);
            }
        }
    }

    // Stable Kahn sort: always emit the earliest baseline draw currently free
    // of painter dependencies. This minimizes movement of unrelated geometry.
    const available: number[] = [];
    for (let i = 0; i < count; i++) {
        if (indegree[i] === 0) available.push(i);
    }
    const ordered: number[] = [];
    while (available.length > 0) {
        let bestOffset = 0;
        for (let i = 1; i < available.length; i++) {
            if (available[i] < available[bestOffset]) bestOffset = i;
        }
        const next = available.splice(bestOffset, 1)[0];
        ordered.push(next);
        for (const after of outgoing[next]) {
            indegree[after]--;
            if (indegree[after] === 0) available.push(after);
        }
    }

    // Malformed/cyclic metadata must never drop geometry. The real placement
    // graph is acyclic, but retain the original order as a defensive fallback.
    if (ordered.length !== count) {
        return Array.from({ length: count }, (_, index) => index);
    }
    return ordered;
}
