import assert from "node:assert/strict";

import { Scene } from "../rs/scene/Scene";
import { EntityType, calculateEntityTag } from "../rs/scene/entity/EntityTag";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import { createModelInfoTextureData } from "../render/buffer/SceneBuffer";
import { resolveLocOrderingAnchorWorldTile } from "../render/loc/LocOrderingMetadata";
import {
    decodeLocPlacementAnchorTile,
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
const sceneLoc = {
    tag: calculateEntityTag(tileX, tileY, EntityType.LOC, false, id),
    flags: LocModelType.WALL_TRI_CORNER | (rotation << 6),
    x: tileX * 128 + 64,
    y: tileY * 128 + 64,
    height: 0,
};
const model = { contourVerticesY: false } as any;

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
assert.equal(
    getLocPlacementIdentity(dynamicModel.placementMetadata!),
    getLocPlacementIdentity(staticModel.placementMetadata!),
);

// Exercise the actual production ModelInfo -> trailer -> WebGPU CPU-plan bridge.
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

// Scene anchors include the loader border. Renderer camera positions are world
// tiles, so the pass resolves the local anchor through the map render position.
assert.deepEqual(
    resolveLocOrderingAnchorWorldTile(plan.orderingAnchorTiles, 0, 50, 60, 6),
    { x: 50 * 64, y: 60 * 64 + 63 },
);

console.log("production loc placement anchor checks passed");
