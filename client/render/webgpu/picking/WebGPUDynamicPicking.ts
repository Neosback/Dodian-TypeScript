import type { DynamicActorInstance, DynamicActorKind } from "../../dynamic/DynamicActorRenderData";

export const WEBGPU_DYNAMIC_PICK_FORMAT = "rgba32uint";
export const WEBGPU_DYNAMIC_PICK_BYTES_PER_PIXEL = 16;
export const WEBGPU_DYNAMIC_PICK_BYTES_PER_ROW = 256;

export const WEBGPU_DYNAMIC_PICK_KIND_PLAYER = 1;
export const WEBGPU_DYNAMIC_PICK_KIND_NPC = 2;

export interface WebGPUDynamicPickResult {
    kind: DynamicActorKind;
    /** Raw client interaction identity. Players use 0x8000 + slot; NPCs use server id. */
    interactionId: number;
    /** Source map identity carried by the renderer-neutral actor snapshot. */
    mapId: number;
}

export function encodeWebGPUDynamicPickKind(kind: DynamicActorKind): number {
    return kind === "player" ? WEBGPU_DYNAMIC_PICK_KIND_PLAYER : WEBGPU_DYNAMIC_PICK_KIND_NPC;
}

export function decodeWebGPUDynamicPickKind(value: number): DynamicActorKind | undefined {
    const encoded = value >>> 0;
    if (encoded === WEBGPU_DYNAMIC_PICK_KIND_PLAYER) return "player";
    if (encoded === WEBGPU_DYNAMIC_PICK_KIND_NPC) return "npc";
    return undefined;
}

/**
 * Integer payload used by the one-pixel dynamic pick target.
 *
 * This deliberately does not reuse InteractType. That enum describes static
 * scene interaction categories and has no PLAYER member, while actor picking
 * must preserve the client's raw player/NPC interaction identity.
 */
export function createWebGPUDynamicPickWords(
    instance: DynamicActorInstance,
): Uint32Array {
    return new Uint32Array([
        instance.identity.interactionId >>> 0,
        instance.identity.sourceMapId >>> 0,
        encodeWebGPUDynamicPickKind(instance.identity.kind),
        1,
    ]);
}

export function decodeWebGPUDynamicPickWords(
    words: ArrayLike<number>,
): WebGPUDynamicPickResult | undefined {
    if ((words[3] >>> 0) === 0) return undefined;
    const kind = decodeWebGPUDynamicPickKind(words[2] >>> 0);
    if (!kind) return undefined;
    return {
        kind,
        interactionId: words[0] >>> 0,
        mapId: words[1] >>> 0,
    };
}

/**
 * Resolve the GPU identity back to the current renderer-neutral actor snapshot.
 * This keeps actorId/serverId on the CPU instead of expanding the GPU instance ABI.
 */
export function resolveWebGPUDynamicPickInstance(
    result: WebGPUDynamicPickResult,
    instances: Iterable<DynamicActorInstance>,
): DynamicActorInstance | undefined {
    for (const instance of instances) {
        const identity = instance.identity;
        if (
            identity.kind === result.kind &&
            (identity.interactionId >>> 0) === (result.interactionId >>> 0) &&
            (identity.sourceMapId >>> 0) === (result.mapId >>> 0)
        ) {
            return instance;
        }
    }
    return undefined;
}

/** Current interact-highlight plugin supports LOC and NPC only; players are not halo targets. */
export function isWebGPUDynamicPickHighlightable(
    result: WebGPUDynamicPickResult,
): boolean {
    return result.kind === "npc";
}
