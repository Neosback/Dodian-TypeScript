import assert from "node:assert/strict";

import type { WebGPUFacePrioritySortResources } from "../render/webgpu/loc/WebGPUFacePrioritySortResources";
import {
    applyWebGPUAnimatedLocDrawRanges,
    refreshWebGPUStaticLocFacePrioritySpans,
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
        placementMetadata: new Uint32Array(0),
        orderingAnchorTiles: new Int16Array(0),
        orderingFootprints: new Uint16Array(0),
    };
}

const prioritySort = {
    resolveDraw(draw: { firstIndex: number; indexCount: number }) {
        if (draw.firstIndex < 0 || draw.indexCount < 0 || draw.firstIndex % 3 !== 0 || draw.indexCount % 3 !== 0) {
            throw new Error("triangle-aligned");
        }
        return {
            firstSpan: draw.indexCount === 0 ? 0 : draw.firstIndex / 3,
            spanCount: draw.indexCount === 0 ? 0 : 1,
            firstFace: draw.firstIndex / 3,
            faceCount: draw.indexCount / 3,
        };
    },
} as unknown as WebGPUFacePrioritySortResources;

const initialPriorityDraw: WebGPUStaticLocDrawPlanEntry = {
    firstIndex: 3,
    indexCount: 6,
    instanceCount: 1,
    firstInstance: 0,
    plane: 0,
};
assert.equal(refreshWebGPUStaticLocFacePrioritySpans([initialPriorityDraw], prioritySort), 1);
assert.deepEqual(initialPriorityDraw.facePrioritySpan, {
    firstSpan: 1,
    spanCount: 1,
    firstFace: 1,
    faceCount: 2,
});

const opaqueDraw: WebGPUStaticLocDrawPlanEntry = {
    firstIndex: 0,
    indexCount: 3,
    instanceCount: 1,
    firstInstance: 7,
    plane: 2,
};
const opaquePass = makePass(opaqueDraw);

const alphaDraw: WebGPUStaticLocDrawPlanEntry = {
    firstIndex: 3,
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
            [24, 6, 2],
        ],
        framesAlpha: [
            [12, 3, 1],
            [36, 9, 1],
        ],
    },
    getDrawRangeIndex(isAlpha, _isInteract, _isLod) {
        return isAlpha ? 0 : 0;
    },
};

assert.equal(
    applyWebGPUAnimatedLocDrawRanges(opaquePass, [loc], false, false, prioritySort),
    1,
);
assert.deepEqual(opaqueDraw, {
    firstIndex: 6,
    indexCount: 6,
    instanceCount: 2,
    firstInstance: 7,
    plane: 2,
    facePrioritySpan: {
        firstSpan: 2,
        spanCount: 1,
        firstFace: 2,
        faceCount: 2,
    },
});

assert.equal(
    applyWebGPUAnimatedLocDrawRanges(alphaPass, [loc], true, false, prioritySort),
    1,
);
assert.deepEqual(alphaDraw, {
    firstIndex: 9,
    indexCount: 9,
    instanceCount: 1,
    firstInstance: 9,
    plane: 1,
    facePrioritySpan: {
        firstSpan: 3,
        spanCount: 1,
        firstFace: 3,
        faceCount: 3,
    },
});

const missingIndexLoc: WebGPUAnimatedLocState = {
    ...loc,
    getDrawRangeIndex() {
        return 4;
    },
};
assert.equal(
    applyWebGPUAnimatedLocDrawRanges(opaquePass, [missingIndexLoc], false, false, prioritySort),
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
    () => applyWebGPUAnimatedLocDrawRanges(opaquePass, [unalignedLoc], false, false, prioritySort),
    /4-byte aligned/,
);

const hiddenLoc: WebGPUAnimatedLocState = {
    frame: 0,
    anim: { frames: [[36, 0, 0]] },
    getDrawRangeIndex() {
        return 0;
    },
};
assert.equal(
    applyWebGPUAnimatedLocDrawRanges(opaquePass, [hiddenLoc], false, false, prioritySort),
    1,
);
assert.equal(opaqueDraw.firstIndex, 9);
assert.equal(opaqueDraw.indexCount, 0);
assert.equal(opaqueDraw.instanceCount, 0);
assert.equal(opaqueDraw.firstInstance, 7, "animation must not alter model placement");
assert.equal(opaqueDraw.plane, 2, "animation must not alter roof-plane metadata");
assert.deepEqual(opaqueDraw.facePrioritySpan, {
    firstSpan: 0,
    spanCount: 0,
    firstFace: 3,
    faceCount: 0,
});

console.log("webgpu animated loc draw-range and face-priority span checks passed");
