import assert from "node:assert/strict";

import {
    LocDiagonalBoundaryPhase,
    createLocDelayedWallDrawOrder,
    getLocDelayedWallRule,
    getLocDiagonalBoundaryOrientationMask,
    getLocFootprintSpanMaskAtTile,
    getLocPainterDirectionIndex,
} from "../render/loc/LocDelayedWallOrdering";
import {
    LOC_PLACEMENT_NONE,
    encodeLocPlacementFootprint,
    packLocPlacementMetadata,
} from "../render/loc/LocPlacementMetadata";
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

// The original scene attaches a four-bit continuation mask to every covered
// tile of a multi-tile loc. These masks are exactly the data delayed walls test
// while deciding whether an overlapping loc must be emitted first.
const footprint = { startX: 10, startY: 20, endX: 12, endY: 22 };
assert.equal(getLocFootprintSpanMaskAtTile(footprint, 10, 20), 6); // north + east
assert.equal(getLocFootprintSpanMaskAtTile(footprint, 11, 20), 7); // west + north + east
assert.equal(getLocFootprintSpanMaskAtTile(footprint, 12, 20), 3); // west + north
assert.equal(getLocFootprintSpanMaskAtTile(footprint, 10, 21), 14); // north + east + south
assert.equal(getLocFootprintSpanMaskAtTile(footprint, 11, 21), 15); // interior
assert.equal(getLocFootprintSpanMaskAtTile(footprint, 12, 22), 9); // west + south
assert.equal(getLocFootprintSpanMaskAtTile(footprint, 9, 20), 0); // outside footprint
assert.equal(
    getLocFootprintSpanMaskAtTile({ startX: 10, startY: 20, endX: 10, endY: 20 }, 10, 20),
    0,
    "single-tile locs have no continuation edges",
);

const oneByOne = encodeLocPlacementFootprint(1, 1);
const twoByTwo = encodeLocPlacementFootprint(2, 2);
const wallRotation0 = packLocPlacementMetadata(LocModelType.WALL_TRI_CORNER, 0);
const normalLoc = packLocPlacementMetadata(LocModelType.NORMAL, 0);
const orderingItem = (
    placementMetadata: number,
    anchorX: number,
    anchorY: number,
    encodedFootprint: number = oneByOne,
    plane: number = 0,
) => ({ plane, placementMetadata, anchorX, anchorY, encodedFootprint });

// FRONT: even if the baseline puts the wall after the loc, the wall is emitted first.
assert.deepEqual(
    createLocDelayedWallDrawOrder(
        [
            orderingItem(normalLoc, tileX, tileY),
            orderingItem(wallRotation0, tileX, tileY),
        ],
        11,
        19,
    ),
    [1, 0],
);

// BACK: the opposite camera sector forces every overlapping loc before the wall.
assert.deepEqual(
    createLocDelayedWallDrawOrder(
        [
            orderingItem(wallRotation0, tileX, tileY),
            orderingItem(normalLoc, tileX, tileY),
        ],
        9,
        21,
    ),
    [1, 0],
);

// DELAYED orientation 16 / sector 2 requires block span 2 under cull mask 3.
// A 2x2 loc anchored on the wall tile has span 6 there, so 6 & 3 == 2 and
// must be emitted before the wall.
assert.deepEqual(
    createLocDelayedWallDrawOrder(
        [
            orderingItem(wallRotation0, tileX, tileY),
            orderingItem(normalLoc, tileX, tileY, twoByTwo),
        ],
        9,
        19,
    ),
    [1, 0],
);

// A non-blocking overlapping loc is emitted after the delayed wall, matching
// the software painter's immediate release once no matching blocker remains.
assert.deepEqual(
    createLocDelayedWallDrawOrder(
        [
            orderingItem(normalLoc, tileX, tileY),
            orderingItem(wallRotation0, tileX, tileY),
        ],
        9,
        19,
    ),
    [1, 0],
);

// Mixed blockers/non-blockers produce blocker -> wall -> non-blocker regardless
// of their baseline positions.
assert.deepEqual(
    createLocDelayedWallDrawOrder(
        [
            orderingItem(normalLoc, tileX, tileY),
            orderingItem(wallRotation0, tileX, tileY),
            orderingItem(normalLoc, tileX, tileY, twoByTwo),
        ],
        9,
        19,
    ),
    [2, 1, 0],
);

// Only same-plane locs covering the wall anchor participate. Unrelated geometry
// and missing placement metadata retain their baseline order.
assert.deepEqual(
    createLocDelayedWallDrawOrder(
        [
            orderingItem(normalLoc, tileX + 5, tileY + 5, oneByOne),
            orderingItem(LOC_PLACEMENT_NONE, -1, -1, 0),
            orderingItem(wallRotation0, tileX, tileY, oneByOne, 0),
            orderingItem(normalLoc, tileX, tileY, twoByTwo, 1),
        ],
        9,
        19,
    ),
    [0, 1, 2, 3],
);

// Version-2/no-footprint compatibility safely treats an anchored scene loc as
// 1x1, which is sufficient for old single-tile packets without inventing spans.
assert.deepEqual(
    createLocDelayedWallDrawOrder(
        [
            orderingItem(normalLoc, tileX, tileY, 0),
            orderingItem(wallRotation0, tileX, tileY),
        ],
        9,
        19,
    ),
    [1, 0],
);

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

console.log("loc diagonal delayed-wall painter reference and scheduling checks passed");
