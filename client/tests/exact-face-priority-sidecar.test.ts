import assert from "node:assert/strict";

import { Model } from "../rs/model/Model";
import type { ModelFace } from "../render/buffer/SceneBuffer";
import {
    ExactFacePrioritySceneBuffer,
    validateExactFacePriorityAlignment,
} from "../render/priority/ExactFacePrioritySceneBuffer";

function createTwoFaceModel(priorities?: [number, number], modelPriority: number = 0): Model {
    const model = new Model();
    model.verticesCount = 4;
    model.usedVertexCount = 4;
    model.faceCount = 2;
    model.priority = modelPriority;
    model.verticesX = new Int32Array([0, 128, 128, 0]);
    model.verticesY = new Int32Array([0, 0, 0, 0]);
    model.verticesZ = new Int32Array([0, 0, 128, 128]);
    model.indices1 = new Int32Array([0, 0]);
    model.indices2 = new Int32Array([1, 2]);
    model.indices3 = new Int32Array([2, 3]);
    model.faceColors1 = new Int32Array([100, 200]);
    model.faceColors2 = new Int32Array([100, 200]);
    model.faceColors3 = new Int32Array([100, 200]);
    model.faceColors = new Uint16Array([100, 200]);
    if (priorities) {
        model.faceRenderPriorities = new Int8Array(priorities);
    }
    return model;
}

const faces: ModelFace[] = [
    { index: 0, alpha: 0xff, priority: 0, textureId: -1 },
    { index: 1, alpha: 0xff, priority: 0, textureId: -1 },
];

const sceneBuf = new ExactFacePrioritySceneBuffer({} as any, new Map(), 8);
const perFaceModel = createTwoFaceModel([2, 11]);
sceneBuf.addModel(perFaceModel, faces, undefined, false);
assert.deepEqual(Array.from(sceneBuf.toExactFacePriorityArray()), [2, 11]);
assert.deepEqual(Array.from(sceneBuf.toExactFacePriorityModelSpans()), [0, 6]);

// Models without a per-face array use the model-wide priority. The legacy
// ModelFace extraction currently defaults its packed-vertex hint separately,
// so the exact sidecar must source this directly from Model.
const modelWidePriority = createTwoFaceModel(undefined, 9);
sceneBuf.addModel(modelWidePriority, [faces[0]], undefined, false);
assert.deepEqual(Array.from(sceneBuf.toExactFacePriorityArray()), [2, 11, 9]);
assert.deepEqual(Array.from(sceneBuf.toExactFacePriorityModelSpans()), [0, 6, 6, 3]);

validateExactFacePriorityAlignment(
    sceneBuf.indices.length,
    sceneBuf.toExactFacePriorityArray(),
    sceneBuf.toExactFacePriorityModelSpans(),
);
validateExactFacePriorityAlignment(0, new Uint8Array(0), new Uint32Array(0));

assert.throws(
    () => validateExactFacePriorityAlignment(4, new Uint8Array(0), new Uint32Array(0)),
    /multiple of 3/,
);
assert.throws(
    () => validateExactFacePriorityAlignment(6, new Uint8Array([1]), new Uint32Array([0, 6])),
    /count mismatch/,
);
assert.throws(
    () => validateExactFacePriorityAlignment(6, new Uint8Array([1, 2]), new Uint32Array([3, 3, 6, 3])),
    /starts at 3, expected 0/,
);
assert.throws(
    () => validateExactFacePriorityAlignment(6, new Uint8Array([1, 2]), new Uint32Array([0, 3])),
    /cover 3 indices, expected 6/,
);

const invalid = new ExactFacePrioritySceneBuffer({} as any, new Map(), 4);
const invalidModel = createTwoFaceModel(undefined, 12);
assert.throws(() => invalid.addModel(invalidModel, [faces[0]], undefined, false), /0\.\.11/);
assert.equal(invalid.indices.length, 0, "invalid priority must fail before model emission");

console.log("exact face-priority sidecar alignment checks passed");
