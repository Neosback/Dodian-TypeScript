import assert from "node:assert/strict";

import {
    DYNAMIC_ACTOR_WEBGL_RECORD_BYTES,
    DYNAMIC_ACTOR_WEBGL_RECORD_WORDS,
    createDynamicActorBatches,
    createDynamicActorGeometry,
    decodeDynamicActorSignedU16,
    decodeDynamicActorWebGLRecord,
    encodeDynamicActorSignedU16,
    type DynamicActorInstance,
    writeDynamicActorWebGLRecord,
} from "../render/dynamic/DynamicActorRenderData";

assert.equal(DYNAMIC_ACTOR_WEBGL_RECORD_WORDS, 8);
assert.equal(DYNAMIC_ACTOR_WEBGL_RECORD_BYTES, 16);
assert.equal(encodeDynamicActorSignedU16(-1), 0xffff);
assert.equal(encodeDynamicActorSignedU16(-257), 0xfeff);
assert.equal(decodeDynamicActorSignedU16(0xffff), -1);
assert.equal(decodeDynamicActorSignedU16(0xfeff), -257);
assert.equal(decodeDynamicActorSignedU16(8191), 8191);

const player: DynamicActorInstance = {
    identity: {
        kind: "player",
        actorId: 17,
        serverId: 42,
        worldViewId: -1,
        interactionId: 0x8123,
        sourceMapId: 12345,
    },
    transform: {
        localX: -257,
        localY: 8191,
        plane: 2,
        rotation: 1537,
        modelYOffset: -24,
    },
    animation: {
        sequenceId: 808,
        frameId: 4,
        overlaySequenceId: 123,
        overlayFrameId: 2,
        mode: "run",
    },
    colorOverride: {
        hue: 45,
        saturation: 63,
        luminance: 77,
        amount: 200,
    },
    geometryKey: "player:appearance:808:4",
};

const words = new Uint16Array(DYNAMIC_ACTOR_WEBGL_RECORD_WORDS);
writeDynamicActorWebGLRecord(words, 0, player);
assert.deepEqual(decodeDynamicActorWebGLRecord(words), {
    localX: -257,
    localY: 8191,
    plane: 2,
    rotation: 1537,
    interactionId: 0x8123,
    colorOverride: {
        hue: 45,
        saturation: 63,
        luminance: 77,
        amount: 200,
    },
});
assert.equal(words[6], 0);
assert.equal(words[7], 0);

// Preserve the existing bit-mask behavior rather than allowing out-of-range
// values to leak into adjacent packed fields.
const masked = new Uint16Array(DYNAMIC_ACTOR_WEBGL_RECORD_WORDS);
writeDynamicActorWebGLRecord(masked, 0, {
    identity: { kind: "npc", actorId: 1, interactionId: 0x12345 },
    transform: { localX: 0, localY: 0, plane: 7, rotation: 0x7fff },
    colorOverride: { hue: 0xff, saturation: 0xfe, luminance: 0xfd, amount: 0x1ff },
});
assert.deepEqual(decodeDynamicActorWebGLRecord(masked), {
    localX: 0,
    localY: 0,
    plane: 3,
    rotation: 0x3fff,
    interactionId: 0x2345,
    colorOverride: {
        hue: 0x7f,
        saturation: 0x7e,
        luminance: 0x7d,
        amount: 0xff,
    },
});

assert.throws(
    () => writeDynamicActorWebGLRecord(new Uint16Array(7), 0, player),
    RangeError,
);
assert.throws(
    () => decodeDynamicActorWebGLRecord(new Uint16Array(7)),
    RangeError,
);

const geometryA = createDynamicActorGeometry(
    "geometry-a",
    new Uint8Array(24),
    new Int32Array(6),
    new Uint8Array(12),
    new Int32Array(3),
);
assert.equal(geometryA.approxBytes, 24 + 24 + 12 + 12);
assert.equal(geometryA.opaque.vertices.byteLength, 24);
assert.equal(geometryA.opaque.indices.length, 6);
assert.equal(geometryA.alpha.indices.length, 3);

const geometryB = createDynamicActorGeometry(
    "geometry-b",
    new Uint8Array(12),
    new Int32Array(3),
    new Uint8Array(0),
    new Int32Array(0),
);
const npc: DynamicActorInstance = {
    identity: { kind: "npc", actorId: 55, serverId: 900, interactionId: 900 },
    transform: { localX: 128, localY: 256, plane: 0, rotation: 1024 },
    animation: { sequenceId: 1, frameId: 0, mode: "walk" },
    colorOverride: { hue: 0, saturation: 0, luminance: 0, amount: 0 },
    geometryKey: "geometry-b",
};
const hidden: DynamicActorInstance = {
    ...player,
    geometryKey: "geometry-a",
    hidden: true,
};
const secondA: DynamicActorInstance = {
    ...player,
    identity: { ...player.identity, actorId: 18, interactionId: 0x8124 },
    geometryKey: "geometry-a",
};
const missing: DynamicActorInstance = {
    ...npc,
    identity: { ...npc.identity, actorId: 56, interactionId: 901 },
    geometryKey: "not-ready-yet",
};

const batches = createDynamicActorBatches(
    [player, npc, hidden, secondA, missing],
    new Map([
        [geometryA.key, geometryA],
        [geometryB.key, geometryB],
    ]),
);
assert.equal(batches.length, 2);
assert.equal(batches[0].geometry.key, "geometry-a");
assert.deepEqual(
    batches[0].instances.map((instance) => instance.identity.actorId),
    [17, 18],
);
assert.equal(batches[1].geometry.key, "geometry-b");
assert.deepEqual(
    batches[1].instances.map((instance) => instance.identity.actorId),
    [55],
);

console.log("renderer-neutral dynamic actor contract checks passed");
