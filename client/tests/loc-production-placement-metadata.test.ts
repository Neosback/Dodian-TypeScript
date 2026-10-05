import assert from "node:assert/strict";

import { Loc } from "../rs/scene/Loc";
import { Scene } from "../rs/scene/Scene";
import { EntityType, calculateEntityTag } from "../rs/scene/entity/EntityTag";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import { createModelInfoTextureData } from "../render/buffer/SceneBuffer";
import { resolveLocOrderingAnchorWorldTile } from "../render/loc/LocOrderingMetadata";
import {
    decodeLocPlacementAnchorTile,
    decodeLocPlacementFootprint,
    getLocPlacementIdentity,
} from "../render/loc/LocPlacementMetadata";
import { createSceneLocEntity, createSceneModel } from "../render/loc/SceneLocs";
import { createWebGPUStaticLocPlanFromData } from "../render/webgpu/loc/WebGPUStaticLocResources";

const tileX = 6;
const tileY = 69;
const rotation = 2;
const id = 42;
const scene = new Scene(1, 80, 80);
const locTypeLoader = {
    load() {
        return {
            contourGroundType: 0,
            isInteractive: 0,
            clipType: 0,
            obstructsGround: false,
        };
    },
} as any;
const model = { contourVerticesY: false } as any;
const tag = calculateEntityTag(tileX, tileY, EntityType.LOC, false, id);
const flags = LocModelType.WALL_TRI_CORNER | (rotation << 6);
const sceneLoc = new Loc(
    tag,
    flags,
    0,
    tileX * 128 + 64,
    tileY * 128 + 64,
    0,
    model,
    rotation,
    tileX,
    tileY,
    tileX + 2,
    tileY + 1,
);

const staticModel = createSceneModel(
    locTypeLoader,
    scene,
    model,
    sceneLoc,
    0,
    0,
    0,
    tileX,
    tileY,
    1,
);
assert.deepEqual(decodeLocPlacementAnchorTile(staticModel.placementMetadata!), {
    x: tileX,
    y: tileY,
});
assert.deepEqual(decodeLocPlacementFootprint(staticModel.placementFootprint!), {
    sizeX: 3,
    sizeY: 2,
});

const dynamicModel = createSceneLocEntity(
    locTypeLoader,
    {} as any,
    sceneLoc,
    0,
    0,
    0,
    tileX,
    tileY,
    1,
);
assert.deepEqual(decodeLocPlacementAnchorTile(dynamicModel.placementMetadata!), {
    x: tileX,
    y: tileY,
});
assert.deepEqual(decodeLocPlacementFootprint(dynamicModel.placementFootprint!), {
    sizeX: 3,
    sizeY: 2,
});
assert.equal(
    getLocPlacementIdentity(dynamicModel.placementMetadata!),
    getLocPlacementIdentity(staticModel.placementMetadata!),
);

// Wall/decor SceneLoc records are anchored to one tile rather than Loc spans.
const wallSceneLoc = {
    tag,
    flags,
    x: tileX * 128 + 64,
    y: tileY * 128 + 64,
    height: 0,
};
const wallModel = createSceneModel(
    locTypeLoader,
    scene,
    model,
    wallSceneLoc,
    0,
    0,
    0,
    tileX,
    tileY,
    1,
);
assert.deepEqual(decodeLocPlacementFootprint(wallModel.placementFootprint!), {
    sizeX: 1,
    sizeY: 1,
});

// Exercise the actual production ModelInfo -> v3 trailer -> WebGPU CPU-plan bridge.
const modelData = createModelInfoTextureData([
    {
        offset: 0,
        elements: 3,
        instances: [staticModel],
    },
]);
const plan = createWebGPUStaticLocPlanFromData(modelData, [[0, 3, 1]], new Uint8Array([0]));
assert.deepEqual(decodeLocPlacementAnchorTile(plan.placementMetadata[0]), {
    x: tileX,
    y: tileY,
});
assert.deepEqual(Array.from(plan.orderingAnchorTiles), [tileX, tileY]);
assert.deepEqual(decodeLocPlacementFootprint(plan.orderingFootprints[0]), {
    sizeX: 3,
    sizeY: 2,
});

// Scene anchors include the loader border. Renderer camera positions are world
// tiles, so the pass resolves the local anchor through the map render position.
assert.deepEqual(
    resolveLocOrderingAnchorWorldTile(plan.orderingAnchorTiles, 0, 50, 60, 6),
    { x: 50 * 64, y: 60 * 64 + 63 },
);

console.log("production loc placement anchor and footprint checks passed");
