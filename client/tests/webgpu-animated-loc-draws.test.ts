import assert from "node:assert/strict";

import {
    applyWebGPUAnimatedLocDrawRanges,
    type WebGPUAnimatedLocState,
    type WebGPUStaticLocDrawPlanEntry,
    type WebGPUStaticLocPassResources,
} from "../render/webgpu/loc/WebGPUStaticLocResources";

function makePass(draw: WebGPUStaticLocDrawPlanEntry): WebGPUStaticLocPassResources {
    return {
        modelInfoBuffer: {} as any,
        bindGroup: {} as any,
        draws: [draw],
        drawsBySourceIndex: [draw],
    };
}

const opaqueDraw: WebGPUStaticLocDrawPlanEntry = {
    firstIndex: 0,
    indexCount: 3,
    instanceCount: 1,
    firstInstance: 7,
    plane: 2,
};
const opaquePass = makePass(opaqueDraw);

const alphaDraw: WebGPUStaticLocDrawPlanEntry = {
    firstIndex: 2,
    indexCount: 3,
    instanceCount: 1,
    firstInstance: 9,
    plane: 1,
};
const alphaPass = makePass(alphaDraw);

const loc: WebGPUAnimatedLocState = {
    frame: 1,
    anim: {
        frames: [
            [0, 3, 1],
            [16, 6, 2],
        ],
        framesAlpha: [
            [8, 3, 1],
            [24, 9, 1],
        ],
    },
    getDrawRangeIndex(isAlpha, _isInteract, _isLod) {
        return isAlpha ? 0 : 0;
    },
};

assert.equal(applyWebGPUAnimatedLocDrawRanges(opaquePass, [loc], false, false), 1);
assert.deepEqual(opaqueDraw, {
    firstIndex: 4,
    indexCount: 6,
    instanceCount: 2,
    firstInstance: 7,
    plane: 2,
});

assert.equal(applyWebGPUAnimatedLocDrawRanges(alphaPass, [loc], true, false), 1);
assert.deepEqual(alphaDraw, {
    firstIndex: 6,
    indexCount: 9,
    instanceCount: 1,
    firstInstance: 9,
    plane: 1,
});

const missingIndexLoc: WebGPUAnimatedLocState = {
    ...loc,
    getDrawRangeIndex() {
        return 4;
    },
};
assert.equal(
    applyWebGPUAnimatedLocDrawRanges(opaquePass, [missingIndexLoc], false, false),
    0,
);

const unalignedLoc: WebGPUAnimatedLocState = {
    frame: 0,
    anim: { frames: [[2, 3, 1]] },
    getDrawRangeIndex() {
        return 0;
    },
};
assert.throws(
    () => applyWebGPUAnimatedLocDrawRanges(opaquePass, [unalignedLoc], false, false),
    /4-byte aligned/,
);

const hiddenLoc: WebGPUAnimatedLocState = {
    frame: 0,
    anim: { frames: [[32, 0, 0]] },
    getDrawRangeIndex() {
        return 0;
    },
};
assert.equal(applyWebGPUAnimatedLocDrawRanges(opaquePass, [hiddenLoc], false, false), 1);
assert.equal(opaqueDraw.firstIndex, 8);
assert.equal(opaqueDraw.indexCount, 0);
assert.equal(opaqueDraw.instanceCount, 0);
assert.equal(opaqueDraw.firstInstance, 7, "animation must not alter model placement");
assert.equal(opaqueDraw.plane, 2, "animation must not alter roof-plane metadata");

console.log("webgpu animated loc draw-range checks passed");
