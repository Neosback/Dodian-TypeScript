import assert from "node:assert/strict";

import { InteractType } from "../render/InteractType";
import {
    ContourGroundType,
    type DrawCommand,
    createModelInfoTextureData,
} from "../render/buffer/SceneBuffer";
import {
    LOC_ORDERING_ANCHOR_NONE,
    getLocOrderingAnchorTile,
} from "../render/loc/LocOrderingMetadata";
import {
    LOC_PLACEMENT_NONE,
    LOC_PLACEMENT_TRAILER_HEADER_WORDS,
    LOC_PLACEMENT_TRAILER_LEGACY_VERSION,
    LOC_PLACEMENT_TRAILER_MAGIC,
    LOC_PLACEMENT_TRAILER_VERSION,
    encodeLocPlacementMetadataForWebGPU,
    getEncodedLocPlacementAnchor,
    getLocPlacementIdentity,
    getLocPlacementTrailerWordOffset,
    packLocPlacementMetadata,
} from "../render/loc/LocPlacementMetadata";
import { createWebGPUStaticLocPlanFromData } from "../render/webgpu/loc/WebGPUStaticLocResources";
import { LocModelType } from "../rs/config/loctype/LocModelType";

const wallPlacement = packLocPlacementMetadata(LocModelType.WALL, 2, false, 6, 69);
const decorationPlacement = packLocPlacementMetadata(
    LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
    1,
    true,
    10,
    11,
);

const commands: DrawCommand[] = [
    {
        offset: 0,
        elements: 3,
        instances: [
            {
                sceneX: 128,
                sceneZ: 256,
                heightOffset: 96,
                level: 1,
                planeCullLevel: 2,
                contourGround: ContourGroundType.CENTER_TILE,
                priority: 1,
                interactType: InteractType.LOC,
                interactId: 42,
                placementMetadata: wallPlacement,
            },
        ],
    },
    {
        offset: 12,
        elements: 6,
        instances: [
            {
                sceneX: 384,
                sceneZ: 512,
                heightOffset: 56,
                level: 2,
                planeCullLevel: 3,
                contourGround: ContourGroundType.VERTEX,
                priority: 2,
                interactType: InteractType.LOC,
                interactId: 99,
                placementMetadata: decorationPlacement,
            },
        ],
    },
];

const modelData = createModelInfoTextureData(commands);

// Legacy WebGL2 header and four-word instance records remain in exactly the
// same locations. The placement data only begins after those records.
assert.equal(modelData[0], 2);
assert.equal(modelData[4], 3);
assert.equal(modelData[8], 128 | (1 << 14));
assert.equal(modelData[9], 256 | (ContourGroundType.CENTER_TILE << 14));
assert.equal(modelData[11], 42);
assert.equal(modelData[12], 384 | (2 << 14));
assert.equal(modelData[13], 512 | (ContourGroundType.VERTEX << 14));
assert.equal(modelData[15], 99);

const trailerOffset = getLocPlacementTrailerWordOffset(commands.length, 2);
assert.equal(modelData[trailerOffset], LOC_PLACEMENT_TRAILER_MAGIC);
assert.equal(modelData[trailerOffset + 1], LOC_PLACEMENT_TRAILER_VERSION);
assert.equal(modelData[trailerOffset + 2], 2);
assert.equal(modelData[trailerOffset + 3], 0);

// The placement trailer must carry both halves of each renderer-neutral
// placement value. Keeping the anchor in a second uint16 word leaves the
// legacy WebGL2 header/instance ABI unchanged while allowing WebGPU to recover
// the exact scene-tile anchor needed by diagonal boundary ordering.
const payloadOffset = trailerOffset + LOC_PLACEMENT_TRAILER_HEADER_WORDS;
assert.equal(modelData[payloadOffset], getLocPlacementIdentity(wallPlacement));
assert.equal(modelData[payloadOffset + 1], getEncodedLocPlacementAnchor(wallPlacement));
assert.equal(modelData[payloadOffset + 2], getLocPlacementIdentity(decorationPlacement));
assert.equal(
    modelData[payloadOffset + 3],
    getEncodedLocPlacementAnchor(decorationPlacement),
);

const plan = createWebGPUStaticLocPlanFromData(
    modelData,
    [
        [0, 3, 1],
        [12, 6, 1],
    ],
    new Uint8Array([2, 3]),
);

assert.deepEqual(Array.from(plan.placementMetadata), [wallPlacement, decorationPlacement]);
assert.deepEqual(Array.from(plan.orderingAnchorTiles), [6, 69, 10, 11]);
assert.deepEqual(getLocOrderingAnchorTile(plan.orderingAnchorTiles, 0), { x: 6, y: 69 });
assert.deepEqual(getLocOrderingAnchorTile(plan.orderingAnchorTiles, 1), { x: 10, y: 11 });
assert.equal(getLocOrderingAnchorTile(plan.orderingAnchorTiles, 2), undefined);
assert.equal(plan.modelInfoWords[3] & 0xffff, 42);
assert.equal(
    plan.modelInfoWords[3] >>> 16,
    encodeLocPlacementMetadataForWebGPU(wallPlacement),
);
assert.equal(plan.modelInfoWords[7] & 0xffff, 99);
assert.equal(
    plan.modelInfoWords[7] >>> 16,
    encodeLocPlacementMetadataForWebGPU(decorationPlacement),
);

// Version-1 trailers remain readable. They only carried placement identity, so
// their decoded values intentionally have no anchor high word or ordering anchor.
const legacyTrailerData = modelData.slice();
legacyTrailerData[trailerOffset + 1] = LOC_PLACEMENT_TRAILER_LEGACY_VERSION;
legacyTrailerData[payloadOffset] = getLocPlacementIdentity(wallPlacement);
legacyTrailerData[payloadOffset + 1] = getLocPlacementIdentity(decorationPlacement);
const legacyTrailerPlan = createWebGPUStaticLocPlanFromData(
    legacyTrailerData,
    [
        [0, 3, 1],
        [12, 6, 1],
    ],
    new Uint8Array([2, 3]),
);
assert.deepEqual(Array.from(legacyTrailerPlan.placementMetadata), [
    getLocPlacementIdentity(wallPlacement),
    getLocPlacementIdentity(decorationPlacement),
]);
assert.deepEqual(Array.from(legacyTrailerPlan.orderingAnchorTiles), [
    LOC_ORDERING_ANCHOR_NONE,
    LOC_ORDERING_ANCHOR_NONE,
    LOC_ORDERING_ANCHOR_NONE,
    LOC_ORDERING_ANCHOR_NONE,
]);
assert.equal(getLocOrderingAnchorTile(legacyTrailerPlan.orderingAnchorTiles, 0), undefined);
assert.equal(
    legacyTrailerPlan.modelInfoWords[3] >>> 16,
    encodeLocPlacementMetadataForWebGPU(wallPlacement),
);
assert.equal(
    legacyTrailerPlan.modelInfoWords[7] >>> 16,
    encodeLocPlacementMetadataForWebGPU(decorationPlacement),
);

// Old packets without the trailer remain valid. Zero stays in the upper half
// of info.w, preserving the WebGPU model-info words used before this checkpoint.
const legacyData = new Uint16Array(16);
legacyData[0] = 1;
legacyData[4] = 64 | (1 << 14);
legacyData[5] = 128;
legacyData[6] = 1 | (1 << 6);
legacyData[7] = 77;
const legacyPlan = createWebGPUStaticLocPlanFromData(
    legacyData,
    [[0, 3, 1]],
    new Uint8Array([1]),
);
assert.deepEqual(Array.from(legacyPlan.placementMetadata), [LOC_PLACEMENT_NONE]);
assert.deepEqual(Array.from(legacyPlan.orderingAnchorTiles), [
    LOC_ORDERING_ANCHOR_NONE,
    LOC_ORDERING_ANCHOR_NONE,
]);
assert.equal(getLocOrderingAnchorTile(legacyPlan.orderingAnchorTiles, 0), undefined);
assert.equal(legacyPlan.modelInfoWords[3], 77);

const malformed = modelData.slice();
malformed[trailerOffset + 2] = 100;
assert.throws(
    () =>
        createWebGPUStaticLocPlanFromData(
            malformed,
            [
                [0, 3, 1],
                [12, 6, 1],
            ],
            new Uint8Array([2, 3]),
        ),
    /trailer exceeds model-info data/,
);

console.log("loc placement serialization and WebGPU ordering bridge checks passed");
