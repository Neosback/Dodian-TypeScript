import type { Renderer } from "../../../game/render/Renderer";
import type { WebGLMapSquare } from "../../WebGLMapSquare";
import type { WebGLOsrsRenderer } from "../../WebGLOsrsRenderer";

function comparisonRequested(): boolean {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location?.search ?? "");
    const value = params.get("webgpuTerrain")?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "compare" || value === "split";
}

/**
 * `PlayerRenderer.renderOpaqueForMap` clears its reusable batch map only after
 * several early-return checks. The comparison captures that map immediately
 * after the authoritative WebGL2 call, so an early return must not expose the
 * preceding map's batches. Clear the reusable map at entry while comparison
 * mode is active. Valid WebGL2 draws rebuild the same groups immediately.
 */
export function installWebGPUPlayerOpaqueCaptureBoundary(renderer: Renderer): () => void {
    if (!comparisonRequested()) return () => {};

    const host = renderer as WebGLOsrsRenderer;
    const playerRenderer = (host as any).playerRenderer as any;
    const previous = playerRenderer?.renderOpaqueForMap;
    if (typeof previous !== "function") return () => {};

    const wrapper = function (this: unknown, map: WebGLMapSquare, ...args: unknown[]) {
        (playerRenderer.batchGroups as Map<unknown, unknown> | undefined)?.clear();
        return previous.call(this, map, ...args);
    };
    playerRenderer.renderOpaqueForMap = wrapper;

    return () => {
        if (playerRenderer.renderOpaqueForMap === wrapper) {
            playerRenderer.renderOpaqueForMap = previous;
        }
    };
}
