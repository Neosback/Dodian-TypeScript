import { LocModelType } from "../../rs/config/loctype/LocModelType";

/**
 * Exact CPU-side placement identity for a rendered location model.
 *
 * This is deliberately renderer-neutral. WebGL2 can continue consuming the
 * existing four-word model-info texture unchanged, while WebGPU can carry this
 * metadata beside the instance stream for OSRS-specific wall/decor ordering.
 *
 * Low-word layout (uint16):
 *   bits 0..5  = LocModelType
 *   bits 6..7  = source rotation (0..3)
 *   bit  8     = secondary scene part (entity1 vs entity0)
 *   bits 9..15 = reserved
 *
 * Optional high word:
 *   0          = no placement anchor
 *   otherwise  = packed 8-bit scene-tile X/Y + 1
 *
 * The anchor is intentionally separate from the low-word identity so the
 * legacy WebGL2 model-info ABI and existing placement decoding stay unchanged.
 */
export const LOC_PLACEMENT_NONE = 0xffff;
export const LOC_PLACEMENT_IDENTITY_MASK = 0xffff;
export const LOC_PLACEMENT_ANCHOR_NONE = 0;
export const LOC_PLACEMENT_FOOTPRINT_NONE = 0;

/**
 * Placement metadata is appended after the legacy model-info payload. WebGL2
 * never indexes this tail, while WebGPU can opt in without changing the worker
 * packet shape or the WebGL texture ABI.
 *
 * Version 1 stored one identity uint16 per instance.
 * Version 2 stored identity + optional anchor.
 * Version 3 stores identity + optional anchor + packed sizeX/sizeY footprint.
 */
export const LOC_PLACEMENT_TRAILER_MAGIC = 0x4c50; // "LP"
export const LOC_PLACEMENT_TRAILER_LEGACY_VERSION = 1;
export const LOC_PLACEMENT_TRAILER_ANCHOR_VERSION = 2;
export const LOC_PLACEMENT_TRAILER_VERSION = 3;
export const LOC_PLACEMENT_TRAILER_HEADER_WORDS = 4;
export const LOC_PLACEMENT_TRAILER_WORDS_PER_INSTANCE = 3;

/** WebGPU uses zero in the upper half of info.w to mean no placement metadata. */
export const LOC_PLACEMENT_GPU_NONE = 0;

const TYPE_MASK = 0x3f;
const ROTATION_MASK = 0x3;
const ROTATION_SHIFT = 6;
const SECONDARY_PART_SHIFT = 8;
const ANCHOR_SHIFT = 16;
const ANCHOR_COMPONENT_MAX = 0xfe;
const FOOTPRINT_COMPONENT_MAX = 0xff;

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

export type LocPlacementAnchorTile = {
    x: number;
    y: number;
};

export type LocPlacementFootprint = {
    sizeX: number;
    sizeY: number;
};

export function getLocPlacementIdentity(metadata: number): number {
    return metadata & LOC_PLACEMENT_IDENTITY_MASK;
}

/**
 * Encode a scene-tile anchor into the optional high word. Scene construction is
 * far smaller than 255x255 tiles, so 0xff is deliberately reserved to keep a
 * zero high word available as the no-anchor sentinel after the +1 encoding.
 */
export function encodeLocPlacementAnchorTile(x: number, y: number): number {
    const tileX = x | 0;
    const tileY = y | 0;
    if (
        tileX < 0 ||
        tileX > ANCHOR_COMPONENT_MAX ||
        tileY < 0 ||
        tileY > ANCHOR_COMPONENT_MAX
    ) {
        throw new RangeError(
            `Loc placement anchor tile must be within 0..${ANCHOR_COMPONENT_MAX}: ${tileX},${tileY}`,
        );
    }
    return ((((tileY & 0xff) << 8) | (tileX & 0xff)) + 1) & 0xffff;
}

export function decodeLocPlacementAnchorTile(
    metadata: number,
): LocPlacementAnchorTile | undefined {
    const encoded = (metadata >>> ANCHOR_SHIFT) & 0xffff;
    if (encoded === LOC_PLACEMENT_ANCHOR_NONE) {
        return undefined;
    }
    const packed = (encoded - 1) & 0xffff;
    return {
        x: packed & 0xff,
        y: (packed >>> 8) & 0xff,
    };
}

export function getEncodedLocPlacementAnchor(metadata: number): number {
    return (metadata >>> ANCHOR_SHIFT) & 0xffff;
}

/** Pack a positive 1..255 tile footprint into one uint16. Zero is reserved. */
export function encodeLocPlacementFootprint(sizeX: number, sizeY: number): number {
    const width = sizeX | 0;
    const height = sizeY | 0;
    if (
        width < 1 ||
        width > FOOTPRINT_COMPONENT_MAX ||
        height < 1 ||
        height > FOOTPRINT_COMPONENT_MAX
    ) {
        throw new RangeError(
            `Loc placement footprint must be within 1..${FOOTPRINT_COMPONENT_MAX}: ${width}x${height}`,
        );
    }
    return (width & 0xff) | ((height & 0xff) << 8);
}

export function decodeLocPlacementFootprint(
    encodedFootprint: number,
): LocPlacementFootprint | undefined {
    const encoded = encodedFootprint & 0xffff;
    if (encoded === LOC_PLACEMENT_FOOTPRINT_NONE) {
        return undefined;
    }
    const sizeX = encoded & 0xff;
    const sizeY = (encoded >>> 8) & 0xff;
    if (sizeX === 0 || sizeY === 0) {
        return undefined;
    }
    return { sizeX, sizeY };
}

export function combineLocPlacementMetadata(identity: number, encodedAnchor: number): number {
    return (
        (identity & LOC_PLACEMENT_IDENTITY_MASK) |
        ((encodedAnchor & LOC_PLACEMENT_IDENTITY_MASK) << ANCHOR_SHIFT)
    ) >>> 0;
}

export function packLocPlacementMetadata(
    type: LocModelType | number,
    rotation: number,
    secondaryPart: boolean = false,
    anchorTileX?: number,
    anchorTileY?: number,
): number {
    if ((anchorTileX === undefined) !== (anchorTileY === undefined)) {
        throw new Error("Loc placement anchor requires both tile coordinates");
    }

    const identity =
        (type & TYPE_MASK) |
        ((rotation & ROTATION_MASK) << ROTATION_SHIFT) |
        (Number(secondaryPart) << SECONDARY_PART_SHIFT);
    const encodedAnchor =
        anchorTileX === undefined
            ? LOC_PLACEMENT_ANCHOR_NONE
            : encodeLocPlacementAnchorTile(anchorTileX, anchorTileY!);
    return combineLocPlacementMetadata(identity, encodedAnchor);
}

export function unpackLocPlacementMetadata(
    metadata: number,
): LocPlacementDescriptor | undefined {
    const identity = getLocPlacementIdentity(metadata);
    if (identity === LOC_PLACEMENT_NONE) {
        return undefined;
    }

    return {
        type: (identity & TYPE_MASK) as LocModelType,
        rotation: (identity >> ROTATION_SHIFT) & ROTATION_MASK,
        secondaryPart: ((identity >> SECONDARY_PART_SHIFT) & 0x1) !== 0,
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

/**
 * WebGPU packs placement identity into the unused upper 16 bits of the fourth
 * model-info word. Add one so a valid WALL/rotation-0 primary value (raw zero)
 * does not collide with the no-metadata sentinel. The optional anchor remains a
 * separate value and therefore cannot alter the legacy identity encoding.
 */
export function encodeLocPlacementMetadataForWebGPU(metadata: number): number {
    const identity = getLocPlacementIdentity(metadata);
    if (identity === LOC_PLACEMENT_NONE) {
        return LOC_PLACEMENT_GPU_NONE;
    }
    return (identity + 1) & 0xffff;
}

export function decodeLocPlacementMetadataFromWebGPU(encoded: number): number {
    const value = encoded & 0xffff;
    if (value === LOC_PLACEMENT_GPU_NONE) {
        return LOC_PLACEMENT_NONE;
    }
    return (value - 1) & 0xffff;
}
