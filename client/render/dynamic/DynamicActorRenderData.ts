export type DynamicActorKind = "player" | "npc";

/**
 * CPU-owned actor colour override after cycle/window resolution.
 *
 * These values intentionally match the client shader ranges rather than any
 * particular GPU packing: hue/saturation/luminance are 7-bit values and
 * amount is an 8-bit blend amount.
 */
export interface DynamicActorColorOverride {
    hue: number;
    saturation: number;
    luminance: number;
    amount: number;
}

/** Renderer-neutral placement consumed by either graphics backend. */
export interface DynamicActorTransform {
    /** Map-local X in client units (128 units per tile). */
    localX: number;
    /** Map-local Y/Z-ground axis in client units (128 units per tile). */
    localY: number;
    /** Resolved render plane after bridge/height-plane rules. */
    plane: number;
    /** OSRS rotation units, where 2048 is one full turn. */
    rotation: number;
    /**
     * Additive client-space model Y offset before the 1/128 world scale.
     * Positive/negative sign is already resolved by the producer.
     */
    modelYOffset?: number;
}

/** Animation selection already resolved by the CPU game/animation system. */
export interface DynamicActorAnimationState {
    sequenceId: number;
    frameId: number;
    overlaySequenceId?: number;
    overlayFrameId?: number;
    skeletal?: boolean;
    mode?: "base" | "idle" | "walk" | "run" | "action";
}

/**
 * Stable identity used for interaction, world-view routing, and debugging.
 * `actorId` is the ECS/client-local actor id. `serverId` is optional because
 * not every locally rendered actor is necessarily server-linked.
 */
export interface DynamicActorIdentity {
    kind: DynamicActorKind;
    actorId: number;
    serverId?: number;
    worldViewId?: number;
    /** Existing backend-neutral interaction payload/id for this actor. */
    interactionId: number;
    /** Optional source map-square id when render placement differs from source identity. */
    sourceMapId?: number;
}

export interface DynamicActorGeometryPass {
    vertices: Uint8Array;
    indices: Int32Array;
}

/**
 * Packed current-pose geometry. The 12-byte packed vertex representation is
 * intentionally retained because it is already shared by the existing scene
 * builders and does not belong to WebGL2 or WebGPU specifically.
 */
export interface DynamicActorGeometry {
    key: string;
    opaque: DynamicActorGeometryPass;
    alpha: DynamicActorGeometryPass;
    approxBytes: number;
}

export interface DynamicActorInstance {
    identity: DynamicActorIdentity;
    transform: DynamicActorTransform;
    animation: DynamicActorAnimationState;
    colorOverride: DynamicActorColorOverride;
    geometryKey: string;
    /** Hidden actors may retain a stable slot while contributing no visible draw. */
    hidden?: boolean;
}

export interface DynamicActorBatch {
    geometry: DynamicActorGeometry;
    instances: readonly DynamicActorInstance[];
}

/** Current WebGL actor-data compatibility layout: two RGBA16UI texels. */
export const DYNAMIC_ACTOR_WEBGL_RECORD_WORDS = 8;
export const DYNAMIC_ACTOR_WEBGL_RECORD_BYTES = DYNAMIC_ACTOR_WEBGL_RECORD_WORDS * 2;

const DYNAMIC_ACTOR_PLANE_MASK = 0x3;
const DYNAMIC_ACTOR_ROTATION_MASK = 0x3fff;

export const EMPTY_DYNAMIC_ACTOR_COLOR_OVERRIDE: Readonly<DynamicActorColorOverride> = Object.freeze({
    hue: 0,
    saturation: 0,
    luminance: 0,
    amount: 0,
});

export function createDynamicActorGeometry(
    key: string,
    opaqueVertices: Uint8Array,
    opaqueIndices: Int32Array,
    alphaVertices: Uint8Array,
    alphaIndices: Int32Array,
): DynamicActorGeometry {
    return {
        key,
        opaque: {
            vertices: opaqueVertices,
            indices: opaqueIndices,
        },
        alpha: {
            vertices: alphaVertices,
            indices: alphaIndices,
        },
        approxBytes:
            opaqueVertices.byteLength +
            opaqueIndices.byteLength +
            alphaVertices.byteLength +
            alphaIndices.byteLength,
    };
}

/** Preserve JavaScript Uint16 assignment/two's-complement behaviour explicitly. */
export function encodeDynamicActorSignedU16(value: number): number {
    return (value | 0) & 0xffff;
}

export function decodeDynamicActorSignedU16(value: number): number {
    const word = value & 0xffff;
    return (word & 0x8000) !== 0 ? word - 0x10000 : word;
}

/**
 * Encode the renderer-neutral actor state into the legacy WebGL2 actor texture
 * record. WebGPU must consume the neutral fields directly rather than treating
 * this compatibility packing as its native ABI.
 */
export function writeDynamicActorWebGLRecord(
    target: Uint16Array,
    wordOffset: number,
    instance: Pick<DynamicActorInstance, "identity" | "transform" | "colorOverride">,
): void {
    if (wordOffset < 0 || wordOffset + DYNAMIC_ACTOR_WEBGL_RECORD_WORDS > target.length) {
        throw new RangeError("Dynamic actor WebGL record exceeds target buffer");
    }

    const transform = instance.transform;
    const color = instance.colorOverride;

    target[wordOffset + 0] = encodeDynamicActorSignedU16(transform.localX);
    target[wordOffset + 1] = encodeDynamicActorSignedU16(transform.localY);
    target[wordOffset + 2] =
        (transform.plane & DYNAMIC_ACTOR_PLANE_MASK) |
        ((transform.rotation & DYNAMIC_ACTOR_ROTATION_MASK) << 2);
    target[wordOffset + 3] = instance.identity.interactionId & 0xffff;
    target[wordOffset + 4] = (color.hue & 0x7f) | ((color.saturation & 0x7f) << 7);
    target[wordOffset + 5] = (color.luminance & 0x7f) | ((color.amount & 0xff) << 7);
    target[wordOffset + 6] = 0;
    target[wordOffset + 7] = 0;
}

export interface DecodedDynamicActorWebGLRecord {
    localX: number;
    localY: number;
    plane: number;
    rotation: number;
    interactionId: number;
    colorOverride: DynamicActorColorOverride;
}

/** Test/debug decoder for the compatibility record. */
export function decodeDynamicActorWebGLRecord(
    source: Uint16Array,
    wordOffset: number = 0,
): DecodedDynamicActorWebGLRecord {
    if (wordOffset < 0 || wordOffset + DYNAMIC_ACTOR_WEBGL_RECORD_WORDS > source.length) {
        throw new RangeError("Dynamic actor WebGL record exceeds source buffer");
    }

    const packedTransform = source[wordOffset + 2] & 0xffff;
    const packedHueSat = source[wordOffset + 4] & 0xffff;
    const packedLumAmount = source[wordOffset + 5] & 0xffff;

    return {
        localX: decodeDynamicActorSignedU16(source[wordOffset + 0]),
        localY: decodeDynamicActorSignedU16(source[wordOffset + 1]),
        plane: packedTransform & DYNAMIC_ACTOR_PLANE_MASK,
        rotation: (packedTransform >>> 2) & DYNAMIC_ACTOR_ROTATION_MASK,
        interactionId: source[wordOffset + 3] & 0xffff,
        colorOverride: {
            hue: packedHueSat & 0x7f,
            saturation: (packedHueSat >>> 7) & 0x7f,
            luminance: packedLumAmount & 0x7f,
            amount: (packedLumAmount >>> 7) & 0xff,
        },
    };
}

/**
 * Stable first-seen grouping for backend upload/draw planning. Missing geometry
 * is skipped so a not-yet-ready animated frame cannot poison the frame plan.
 */
export function createDynamicActorBatches(
    instances: readonly DynamicActorInstance[],
    geometryByKey: ReadonlyMap<string, DynamicActorGeometry>,
): DynamicActorBatch[] {
    const batchesByKey = new Map<string, { geometry: DynamicActorGeometry; instances: DynamicActorInstance[] }>();

    for (const instance of instances) {
        if (instance.hidden) continue;
        const geometry = geometryByKey.get(instance.geometryKey);
        if (!geometry) continue;

        let batch = batchesByKey.get(instance.geometryKey);
        if (!batch) {
            batch = { geometry, instances: [] };
            batchesByKey.set(instance.geometryKey, batch);
        }
        batch.instances.push(instance);
    }

    return Array.from(batchesByKey.values());
}
