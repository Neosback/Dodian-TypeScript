import assert from "node:assert/strict";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import {
    embeddedWallDecorationShift,
    rotateWallDecorationOffset,
    wallDecorationNudge,
    wallDecorationOffset,
} from "../rs/scene/WallDecorationOffset";
import { ModelData } from "../rs/model/ModelData";

// 1. Verify wall decoration offsets
// Inside decor on straight wall
assert.deepEqual(
    embeddedWallDecorationShift(LocModelType.WALL_DECORATION_INSIDE, 0, LocModelType.WALL, 0, 16),
    { x: 16, y: 0 },
);
assert.deepEqual(
    embeddedWallDecorationShift(LocModelType.WALL_DECORATION_INSIDE, 2, LocModelType.WALL, 2, 16),
    { x: -16, y: 0 },
);

// Shape 8 (double diagonal decor e.g. Loc 1821) on Shape 9 (diagonal wall e.g. Loc 1902)
assert.deepEqual(
    embeddedWallDecorationShift(LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE, 1, LocModelType.WALL_DIAGONAL, 3, 16),
    { x: 8, y: 8 },
);
assert.deepEqual(
    embeddedWallDecorationShift(LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE, 1, LocModelType.WALL_DIAGONAL, 1, 16),
    { x: 0, y: 0 },
);

// 2. Verify ModelData.mergeNormals with 1-unit vertical offset (as seen between Loc 1904 and 1907)
const model0 = new ModelData();
model0.usedVertexCount = 3;
model0.verticesCount = 3;
model0.faceCount = 1;
model0.verticesX = new Int32Array([0, 64, 128]);
// Vertices at Y = 0 (top/ground)
model0.verticesY = new Int32Array([0, 0, 0]);
model0.verticesZ = new Int32Array([0, 64, 128]);
model0.indices1 = new Int32Array([0]);
model0.indices2 = new Int32Array([1]);
model0.indices3 = new Int32Array([2]);
model0.faceColors = new Int16Array([100]);

const model1 = new ModelData();
model1.usedVertexCount = 3;
model1.verticesCount = 3;
model1.faceCount = 1;
model1.verticesX = new Int32Array([0, 64, 128]);
// Vertices at Y = 1 (1-unit vertical difference)
model1.verticesY = new Int32Array([1, 1, 1]);
model1.verticesZ = new Int32Array([0, 64, 128]);
model1.indices1 = new Int32Array([0]);
model1.indices2 = new Int32Array([1]);
model1.indices3 = new Int32Array([2]);
model1.faceColors = new Int16Array([100]);

ModelData.mergeNormals(model0, model1, 0, 0, 0, true);

// Normals should have merged
assert.ok(model0.mergedNormals, "model0 should have merged normals");
assert.ok(model1.mergedNormals, "model1 should have merged normals");
assert.equal(model0.mergedNormals.length, 3);
assert.equal(model1.mergedNormals.length, 3);

// Occluded face capping should trigger (mergedCount >= 3)
assert.ok(model0.faceRenderTypes, "model0 should have faceRenderTypes");
assert.equal(model0.faceRenderTypes[0], 2, "face should be marked as occluded (type 2)");
assert.ok(model1.faceRenderTypes, "model1 should have faceRenderTypes");
assert.equal(model1.faceRenderTypes[0], 2, "face should be marked as occluded (type 2)");

console.log("wall-decor-normal-merge test passed successfully!");
