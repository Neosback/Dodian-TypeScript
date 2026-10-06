import type { SceneRaycastHit } from "../../../game/scene/SceneRaycaster";
import type { WebGLOsrsRenderer } from "../../WebGLOsrsRenderer";
import type { WebGPUCombinedPickResult } from "./WebGPUCombinedPickingController";

export type WebGPUPickingParityClassification =
    | "match-front"
    | "match-deeper-cpu-hit"
    | "both-miss"
    | "cpu-hit-gpu-miss"
    | "gpu-hit-cpu-miss"
    | "gpu-hit-absent-from-cpu-stack";

export type WebGPUPickingParityIdentity =
    | {
          domain: "static";
          mapId: number;
          interactionId: number;
          interactType: number;
          tileX?: number;
          tileY?: number;
      }
    | {
          domain: "player" | "npc";
          mapId: number;
          interactionId: number;
          actorId: number;
          serverId: number;
      };

export interface WebGPUPickingParityResult {
    classification: WebGPUPickingParityClassification;
    cpuFront?: WebGPUPickingParityIdentity;
    cpuMatchIndex: number;
    gpu?: WebGPUPickingParityIdentity;
}

function resolveCpuDynamicIdentity(
    host: WebGLOsrsRenderer,
    hit: SceneRaycastHit,
): WebGPUPickingParityIdentity | undefined {
    if (typeof hit.playerEcsIndex === "number") {
        const actorId = hit.playerEcsIndex | 0;
        let serverId = -1;
        try {
            serverId = host.osrsClient.playerEcs.getServerIdForIndex(actorId) | 0;
        } catch {}
        return {
            domain: "player",
            mapId: hit.mapId >>> 0,
            interactionId: hit.interactId >>> 0,
            actorId,
            serverId,
        };
    }

    if (typeof hit.npcEcsId === "number" || typeof hit.npcServerId === "number") {
        const actorId = typeof hit.npcEcsId === "number" ? hit.npcEcsId | 0 : -1;
        let serverId = typeof hit.npcServerId === "number" ? hit.npcServerId | 0 : -1;
        if (serverId < 0 && actorId >= 0) {
            try {
                serverId = host.osrsClient.npcEcs.getServerId(actorId) | 0;
            } catch {}
        }
        return {
            domain: "npc",
            mapId: hit.mapId >>> 0,
            interactionId: hit.interactId >>> 0,
            actorId,
            serverId,
        };
    }

    return undefined;
}

export function snapshotWebGPUCpuPickStack(
    host: WebGLOsrsRenderer,
    hits: readonly SceneRaycastHit[],
): WebGPUPickingParityIdentity[] {
    const snapshot: WebGPUPickingParityIdentity[] = [];
    for (const hit of hits) {
        const dynamic = resolveCpuDynamicIdentity(host, hit);
        if (dynamic) {
            snapshot.push(dynamic);
            continue;
        }
        snapshot.push({
            domain: "static",
            mapId: hit.mapId >>> 0,
            interactionId: hit.interactId >>> 0,
            interactType: hit.interactType | 0,
            tileX: typeof hit.tileX === "number" ? hit.tileX | 0 : undefined,
            tileY: typeof hit.tileY === "number" ? hit.tileY | 0 : undefined,
        });
    }
    return snapshot;
}

export function snapshotWebGPUPick(
    pick: WebGPUCombinedPickResult | undefined,
): WebGPUPickingParityIdentity | undefined {
    if (!pick) return undefined;
    if (pick.source === "static") {
        return {
            domain: "static",
            mapId: pick.result.mapId >>> 0,
            interactionId: pick.result.interactId >>> 0,
            interactType: pick.result.interactType | 0,
            tileX: pick.result.tileX | 0,
            tileY: pick.result.tileY | 0,
        };
    }
    return {
        domain: pick.result.kind,
        mapId: pick.result.mapId >>> 0,
        interactionId: pick.result.interactionId >>> 0,
        actorId: pick.result.actorId | 0,
        serverId: pick.result.serverId | 0,
    };
}

export function isWebGPUPickingParityIdentityEqual(
    cpu: WebGPUPickingParityIdentity,
    gpu: WebGPUPickingParityIdentity,
): boolean {
    if (cpu.domain !== gpu.domain || (cpu.mapId >>> 0) !== (gpu.mapId >>> 0)) {
        return false;
    }

    if (cpu.domain === "player" && gpu.domain === "player") {
        return (cpu.actorId | 0) === (gpu.actorId | 0);
    }
    if (cpu.domain === "npc" && gpu.domain === "npc") {
        if ((cpu.serverId | 0) >= 0 && (gpu.serverId | 0) >= 0) {
            return (cpu.serverId | 0) === (gpu.serverId | 0);
        }
        return (cpu.actorId | 0) === (gpu.actorId | 0);
    }
    if (cpu.domain === "static" && gpu.domain === "static") {
        return (
            (cpu.interactType | 0) === (gpu.interactType | 0) &&
            (cpu.interactionId >>> 0) === (gpu.interactionId >>> 0) &&
            cpu.tileX === gpu.tileX &&
            cpu.tileY === gpu.tileY
        );
    }
    return false;
}

export function classifyWebGPUPickingParity(
    cpuStack: readonly WebGPUPickingParityIdentity[],
    gpuPick: WebGPUPickingParityIdentity | undefined,
): WebGPUPickingParityResult {
    const cpuFront = cpuStack[0];
    if (!cpuFront && !gpuPick) {
        return { classification: "both-miss", cpuMatchIndex: -1 };
    }
    if (cpuFront && !gpuPick) {
        return {
            classification: "cpu-hit-gpu-miss",
            cpuFront,
            cpuMatchIndex: -1,
        };
    }
    if (!cpuFront && gpuPick) {
        return {
            classification: "gpu-hit-cpu-miss",
            cpuMatchIndex: -1,
            gpu: gpuPick,
        };
    }

    for (let i = 0; i < cpuStack.length; i++) {
        if (gpuPick && isWebGPUPickingParityIdentityEqual(cpuStack[i], gpuPick)) {
            return {
                classification: i === 0 ? "match-front" : "match-deeper-cpu-hit",
                cpuFront,
                cpuMatchIndex: i,
                gpu: gpuPick,
            };
        }
    }

    return {
        classification: "gpu-hit-absent-from-cpu-stack",
        cpuFront,
        cpuMatchIndex: -1,
        gpu: gpuPick,
    };
}
