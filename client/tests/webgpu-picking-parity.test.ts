import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { InteractType } from "../render/InteractType";
import {
    classifyWebGPUPickingParity,
    isWebGPUPickingParityIdentityEqual,
    snapshotWebGPUPick,
    type WebGPUPickingParityIdentity,
} from "../render/webgpu/picking/WebGPUPickingParity";

const loc = {
    domain: "static",
    mapId: 12860,
    interactionId: 1001,
    interactType: InteractType.LOC,
    tileX: 3200,
    tileY: 3201,
} satisfies WebGPUPickingParityIdentity;
const otherLoc = {
    ...loc,
    interactionId: 1002,
} satisfies WebGPUPickingParityIdentity;
const player = {
    domain: "player",
    mapId: 12860,
    interactionId: 0x8003,
    actorId: 77,
    serverId: 901,
} satisfies WebGPUPickingParityIdentity;
const npc = {
    domain: "npc",
    mapId: 12860,
    interactionId: 456,
    actorId: 12,
    serverId: 456,
} satisfies WebGPUPickingParityIdentity;

assert.deepEqual(classifyWebGPUPickingParity([loc], loc), {
    classification: "match-front",
    cpuFront: loc,
    cpuMatchIndex: 0,
    gpu: loc,
});
assert.deepEqual(classifyWebGPUPickingParity([otherLoc, loc], loc), {
    classification: "match-deeper-cpu-hit",
    cpuFront: otherLoc,
    cpuMatchIndex: 1,
    gpu: loc,
});
assert.deepEqual(classifyWebGPUPickingParity([], undefined), {
    classification: "both-miss",
    cpuMatchIndex: -1,
});
assert.equal(
    classifyWebGPUPickingParity([loc], undefined).classification,
    "cpu-hit-gpu-miss",
);
assert.equal(
    classifyWebGPUPickingParity([], loc).classification,
    "gpu-hit-cpu-miss",
);
assert.equal(
    classifyWebGPUPickingParity([loc], otherLoc).classification,
    "gpu-hit-absent-from-cpu-stack",
);

// Dynamic equality uses stable actor identity for players and server identity for NPCs.
assert.equal(
    isWebGPUPickingParityIdentityEqual(player, { ...player, interactionId: 0x8008 }),
    true,
);
assert.equal(
    isWebGPUPickingParityIdentityEqual(npc, { ...npc, actorId: 99 }),
    true,
);
assert.equal(
    isWebGPUPickingParityIdentityEqual(npc, { ...npc, serverId: 457 }),
    false,
);
assert.equal(
    isWebGPUPickingParityIdentityEqual(loc, { ...loc, tileX: 3201 }),
    false,
);

assert.deepEqual(
    snapshotWebGPUPick({
        source: "static",
        result: {
            interactId: 1001,
            mapId: 12860,
            interactType: InteractType.LOC,
            tileX: 3200,
            tileY: 3201,
            plane: 1,
        },
    }),
    loc,
);
assert.deepEqual(
    snapshotWebGPUPick({
        source: "dynamic",
        result: {
            kind: "player",
            interactionId: 0x8003,
            mapId: 12860,
            actorId: 77,
            serverId: 901,
        },
    }),
    player,
);

const recorderSource = readFileSync(
    new URL("../render/webgpu/picking/WebGPUPickingParityRecorder.ts", import.meta.url),
    "utf8",
);
const canvasSource = readFileSync(new URL("../ui/Canvas.tsx", import.meta.url), "utf8");

// Recorder taps the authoritative CPU result once and returns it unchanged.
assert.match(recorderSource, /const hits = previousRaycast\.apply\(this, args\)/);
assert.match(recorderSource, /return hits;/);
assert.match(recorderSource, /snapshotWebGPUCpuPickStack\(host, hits\)/);
assert.match(recorderSource, /requestWebGPUTerrainCombinedPick\(host, point\.x, point\.y\)/);

// Avoid time-skewed comparisons: no second parity request is queued while readback is pending.
assert.match(recorderSource, /if \(!active \|\| parityBusy\) return hits/);
assert.match(recorderSource, /parityBusy = true/);
assert.match(recorderSource, /\.finally\(\(\) => \{\s*parityBusy = false;/);

// Diagnostics stay bounded and remain read-only with respect to gameplay interaction state.
assert.match(recorderSource, /MAX_RECENT_PARITY_SAMPLES = 128/);
assert.match(recorderSource, /diagnostics\.recent\.splice/);
assert.doesNotMatch(recorderSource, /menuEntries\s*=|menuOpen\s*=|hoveredTile\s*=|interactHighlight\w*\s*=/);

// Canvas owns install/restore with the rest of comparison lifecycle.
const installDynamic = canvasSource.indexOf("installWebGPUDynamicComparisons(renderer)");
const installParity = canvasSource.indexOf("installWebGPUPickingParityRecorder(renderer)");
const restoreParity = canvasSource.indexOf("restorePickingParity?.()");
const restoreDynamic = canvasSource.indexOf("restoreDynamicComparisons?.()");
assert.ok(installDynamic >= 0 && installParity > installDynamic);
assert.ok(restoreParity >= 0 && restoreDynamic > restoreParity);

console.log("WebGPU picking parity recorder checks passed");
