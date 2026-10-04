import type { GroundItemGeometryBuildData } from "./GroundItemMeshBuilder";

export interface GroundItemGeometrySnapshot {
    readonly revision: number;
    readonly data: GroundItemGeometryBuildData | undefined;
}

let nextRevision = 1;
const snapshots = new WeakMap<object, GroundItemGeometrySnapshot>();

/**
 * Record the latest CPU geometry produced for a map square.
 *
 * The revision is process-global rather than per-map so replacing a map object
 * cannot accidentally reuse an old revision number for the same map id.
 */
export function recordGroundItemGeometrySnapshot(
    map: object,
    data: GroundItemGeometryBuildData | undefined,
): GroundItemGeometrySnapshot {
    const snapshot: GroundItemGeometrySnapshot = {
        revision: nextRevision++,
        data,
    };
    snapshots.set(map, snapshot);
    return snapshot;
}

export function getGroundItemGeometrySnapshot(
    map: object,
): GroundItemGeometrySnapshot | undefined {
    return snapshots.get(map);
}
