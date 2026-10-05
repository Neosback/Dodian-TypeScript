import assert from "node:assert/strict";

import {
    LocDiagonalBoundaryPhase,
    getLocDelayedWallRule,
    getLocDiagonalBoundaryOrientationMask,
    getLocPainterDirectionIndex,
} from "../render/loc/LocDelayedWallOrdering";
import { packLocPlacementMetadata } from "../render/loc/LocPlacementMetadata";
import { LocModelType } from "../rs/config/loctype/LocModelType";

const tileX = 10;
const tileY = 20;

const cameraByDirectionIndex = [
    [11, 19],
    [10, 19],
    [9, 19],
    [11, 20],
    [10, 20],
    [9, 20],
    [11, 21],
    [10, 21],
    [9, 21],
] as const;

for (let i = 0; i < cameraByDirectionIndex.length; i++) {
    const [cameraX, cameraY] = cameraByDirectionIndex[i];
    assert.equal(getLocPainterDirectionIndex(tileX, tileY, cameraX, cameraY), i);
}

for (const type of [LocModelType.WALL_TRI_CORNER, LocModelType.WALL_RECT_CORNER]) {
    for (let rotation = 0; rotation < 4; rotation++) {
        const metadata = packLocPlacementMetadata(type, rotation, false, tileX, tileY);
        assert.equal(getLocDiagonalBoundaryOrientationMask(metadata), 16 << rotation);

        const phases = cameraByDirectionIndex.map(([cameraX, cameraY]) =>
            getLocDelayedWallRule(metadata, tileX, tileY, cameraX, cameraY).phase,
        );
        assert.equal(
            phases.filter((phase) => phase === LocDiagonalBoundaryPhase.FRONT).length,
            4,
            `type ${type} rotation ${rotation} front-sector count`,
        );
        assert.equal(
            phases.filter((phase) => phase === LocDiagonalBoundaryPhase.DELAYED).length,
            4,
            `type ${type} rotation ${rotation} delayed-sector count`,
        );
        assert.equal(
            phases.filter((phase) => phase === LocDiagonalBoundaryPhase.BACK).length,
            1,
            `type ${type} rotation ${rotation} back-sector count`,
        );
    }
}

// Same-tile camera is always in the software painter's immediate/front phase.
for (let rotation = 0; rotation < 4; rotation++) {
    const metadata = packLocPlacementMetadata(LocModelType.WALL_TRI_CORNER, rotation);
    assert.equal(
        getLocDelayedWallRule(metadata, tileX, tileY, tileX, tileY).phase,
        LocDiagonalBoundaryPhase.FRONT,
    );
}

// Verify the original delayed loc-span masks for one delayed sector of each
// 16/32/64/128 orientation.
const delayed16 = getLocDelayedWallRule(
    packLocPlacementMetadata(LocModelType.WALL_TRI_CORNER, 0),
    tileX,
    tileY,
    9,
    19,
);
assert.deepEqual(delayed16, {
    phase: LocDiagonalBoundaryPhase.DELAYED,
    directionIndex: 2,
    orientationMask: 16,
    wallCullDirection: 3,
    blockLocSpan: 2,
    oppositeLocSpan: 1,
});

const delayed32 = getLocDelayedWallRule(
    packLocPlacementMetadata(LocModelType.WALL_TRI_CORNER, 1),
    tileX,
    tileY,
    11,
    19,
);
assert.deepEqual(delayed32, {
    phase: LocDiagonalBoundaryPhase.DELAYED,
    directionIndex: 0,
    orientationMask: 32,
    wallCullDirection: 6,
    blockLocSpan: 2,
    oppositeLocSpan: 4,
});

const delayed64 = getLocDelayedWallRule(
    packLocPlacementMetadata(LocModelType.WALL_RECT_CORNER, 2),
    tileX,
    tileY,
    10,
    19,
);
assert.deepEqual(delayed64, {
    phase: LocDiagonalBoundaryPhase.DELAYED,
    directionIndex: 1,
    orientationMask: 64,
    wallCullDirection: 12,
    blockLocSpan: 4,
    oppositeLocSpan: 8,
});

const delayed128 = getLocDelayedWallRule(
    packLocPlacementMetadata(LocModelType.WALL_RECT_CORNER, 3),
    tileX,
    tileY,
    11,
    19,
);
assert.deepEqual(delayed128, {
    phase: LocDiagonalBoundaryPhase.DELAYED,
    directionIndex: 0,
    orientationMask: 128,
    wallCullDirection: 9,
    blockLocSpan: 1,
    oppositeLocSpan: 8,
});

// Opposite diagonal sector is the one back-phase sector for each orientation.
const backSectorByRotation = [8, 6, 0, 2] as const;
for (let rotation = 0; rotation < 4; rotation++) {
    const [cameraX, cameraY] = cameraByDirectionIndex[backSectorByRotation[rotation]];
    const metadata = packLocPlacementMetadata(LocModelType.WALL_TRI_CORNER, rotation);
    assert.equal(
        getLocDelayedWallRule(metadata, tileX, tileY, cameraX, cameraY).phase,
        LocDiagonalBoundaryPhase.BACK,
    );
}

// Non-diagonal placements do not participate in this painter path.
for (const type of [LocModelType.WALL, LocModelType.WALL_CORNER, LocModelType.NORMAL]) {
    const metadata = packLocPlacementMetadata(type, 0);
    assert.equal(getLocDiagonalBoundaryOrientationMask(metadata), 0);
    assert.equal(
        getLocDelayedWallRule(metadata, tileX, tileY, 9, 19).phase,
        LocDiagonalBoundaryPhase.NONE,
    );
}

console.log("loc diagonal delayed-wall painter reference checks passed");
