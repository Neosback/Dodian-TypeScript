import { decodeLocPlacementAnchorTile } from "./LocPlacementMetadata";

/** Sentinel used in CPU-only ordering arrays when a placement has no anchor. */
export const LOC_ORDERING_ANCHOR_NONE = -1;

/**
 * Decode renderer-neutral placement anchors into a dense x/y array parallel to
 * the model-info instance stream. The array is deliberately CPU-only for now:
 * delayed-wall ordering will consume it in a later checkpoint without changing
 * current WGSL or draw behavior.
 */
export function createLocOrderingAnchorTiles(metadata: ArrayLike<number>): Int16Array {
    const anchors = new Int16Array(metadata.length * 2);
    anchors.fill(LOC_ORDERING_ANCHOR_NONE);

    for (let i = 0; i < metadata.length; i++) {
        const anchor = decodeLocPlacementAnchorTile(metadata[i]);
        if (!anchor) {
            continue;
        }
        const offset = i * 2;
        anchors[offset] = anchor.x;
        anchors[offset + 1] = anchor.y;
    }

    return anchors;
}

export type LocOrderingAnchorTile = {
    x: number;
    y: number;
};

/** Read one decoded ordering anchor by model-info instance index. */
export function getLocOrderingAnchorTile(
    anchors: Int16Array,
    instanceIndex: number,
): LocOrderingAnchorTile | undefined {
    const offset = (instanceIndex | 0) * 2;
    if (offset < 0 || offset + 1 >= anchors.length) {
        return undefined;
    }

    const x = anchors[offset];
    const y = anchors[offset + 1];
    if (x === LOC_ORDERING_ANCHOR_NONE || y === LOC_ORDERING_ANCHOR_NONE) {
        return undefined;
    }
    return { x, y };
}
