import { LocModelType } from "../../rs/config/loctype/LocModelType";

/**
 * Exact CPU-side placement identity for a rendered location model.
 *
 * This is deliberately renderer-neutral. WebGL2 can continue consuming the
 * existing four-word model-info texture unchanged, while WebGPU can carry this
 * metadata beside the instance stream for OSRS-specific wall/decor ordering.
 *
 * Layout (uint16):
 *   bits 0..5  = LocModelType
 *   bits 6..7  = source rotation (0..3)
 *   bit  8     = secondary scene part (entity1 vs entity0)
 *   bits 9..15 = reserved
 */
export const LOC_PLACEMENT_NONE = 0xffff;

/**
 * Placement metadata is appended after the legacy model-info payload. WebGL2
 * never indexes this tail, while WebGPU can opt in without changing the worker
 * packet shape or the WebGL texture ABI.
 */
export const LOC_PLACEMENT_TRAILER_MAGIC = 0x4c50; // "LP"
export const LOC_PLACEMENT_TRAILER_VERSION = 1;
export const LOC_PLACEMENT_TRAILER_HEADER_WORDS = 4;

const TYPE_MASK = 0x3f;
const ROTATION_MASK = 0x3;
const ROTATION_SHIFT = 6;
const SECONDARY_PART_SHIFT = 8;

export enum LocPlacementClassFlag {
    NONE = 0,
    WALL_PIECE = 1 << 0,
    WALL_DECORATION = 1 << 1,
    ROOF = 1 << 2,
    FLOOR_DECORATION = 1 << 3,
}

export type LocPlacementDescriptor = {
    type: LocModelType;
    rotation: number;
    secondaryPart: boolean;
};

export function packLocPlacementMetadata(
    type: LocModelType | number,
    rotation: number,
    secondaryPart: boolean = false,
): number {
    return (
        (type & TYPE_MASK) |
        ((rotation & ROTATION_MASK) << ROTATION_SHIFT) |
        (Number(secondaryPart) << SECONDARY_PART_SHIFT)
    );
}

export function unpackLocPlacementMetadata(
    metadata: number,
): LocPlacementDescriptor | undefined {
    if ((metadata & 0xffff) === LOC_PLACEMENT_NONE) {
        return undefined;
    }

    return {
        type: (metadata & TYPE_MASK) as LocModelType,
        rotation: (metadata >> ROTATION_SHIFT) & ROTATION_MASK,
        secondaryPart: ((metadata >> SECONDARY_PART_SHIFT) & 0x1) !== 0,
    };
}

export function getLocPlacementClassFlags(metadata: number): LocPlacementClassFlag {
    const placement = unpackLocPlacementMetadata(metadata);
    if (!placement) {
        return LocPlacementClassFlag.NONE;
    }

    const type = placement.type;
    let flags = LocPlacementClassFlag.NONE;

    if (type >= LocModelType.WALL && type <= LocModelType.WALL_RECT_CORNER) {
        flags |= LocPlacementClassFlag.WALL_PIECE;
    }
    if (
        type >= LocModelType.WALL_DECORATION_INSIDE &&
        type <= LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE
    ) {
        flags |= LocPlacementClassFlag.WALL_DECORATION;
    }
    if (
        type >= LocModelType.ROOF_SLOPED &&
        type <= LocModelType.ROOF_SLOPED_OVERHANG_HARD_OUTER_CORNER
    ) {
        flags |= LocPlacementClassFlag.ROOF;
    }
    if (type === LocModelType.FLOOR_DECORATION) {
        flags |= LocPlacementClassFlag.FLOOR_DECORATION;
    }

    return flags;
}

export function hasLocPlacementClass(
    metadata: number,
    flag: LocPlacementClassFlag,
): boolean {
    return (getLocPlacementClassFlags(metadata) & flag) !== 0;
}

/** Word offset immediately after draw headers and four-word instance records. */
export function getLocPlacementTrailerWordOffset(drawCount: number, instanceCount: number): number {
    return (Math.max(0, drawCount | 0) + Math.max(0, instanceCount | 0)) * 4;
}
