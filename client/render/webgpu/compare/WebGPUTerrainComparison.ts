import type { Renderer } from "../../../game/render/Renderer";
import type { SdMapData } from "../../loader/SdMapData";
import type { WebGLOsrsRenderer } from "../../WebGLOsrsRenderer";
import { WebGPUGraphicsBackend } from "../../backend/WebGPUGraphicsBackend";
import { buildMaterialTable } from "../../texture/MaterialTable";
import { WebGPUStaticSceneRenderer } from "../WebGPUStaticSceneRenderer";
import { createFallbackWaterTextureData } from "../terrain/WebGPUWaterResources";

interface TerrainComparisonState {
    canvas: HTMLCanvasElement;
    backend: WebGPUGraphicsBackend;
    renderer: WebGPUStaticSceneRenderer;
    previousOnMapRemoved?: (mapX: number, mapY: number) => void;
    mapRemovedWrapper?: (mapX: number, mapY: number) => void;
    ready: boolean;
    failed: boolean;
    pendingTextures: Map<number, Int32Array>;
    pendingMaps: Map<string, { mapData: SdMapData; loadTime: number }>;
}

const states = new WeakMap<object, TerrainComparisonState>();

export function isWebGPUTerrainComparisonRequested(search: string): boolean {
    const params = new URLSearchParams(search);
    const value = params.get("webgpuTerrain")?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "compare" || value === "split";
}

function isRequestedInBrowser(): boolean {
    if (typeof window === "undefined") return false;
    return isWebGPUTerrainComparisonRequested(window.location?.search ?? "");
}

function configureComparisonCanvas(canvas: HTMLCanvasElement): void {
    canvas.dataset.webgpuTerrainComparison = "true";
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "2";
    canvas.style.clipPath = "inset(0 0 0 50%)";
}

function disableComparison(host: WebGLOsrsRenderer, reason: unknown): void {
    const state = states.get(host);
    if (!state || state.failed) return;
    state.failed = true;
    state.ready = false;
    state.pendingTextures.clear();
    state.pendingMaps.clear();
    state.canvas.style.display = "none";
    try { state.renderer.dispose(); } catch {}
    try { state.backend.dispose(); } catch {}
    const message = reason instanceof Error ? reason.message : String(reason);
    console.warn(
        `[WebGPU terrain comparison] Disabled; WebGL2 remains authoritative: ${message}`,
    );
}

export async function initWebGPUTerrainComparison(
    host: WebGLOsrsRenderer,
): Promise<boolean> {
    if (!isRequestedInBrowser()) return false;
    if (!WebGPUGraphicsBackend.isSupported()) {
        console.warn(
            "[WebGPU terrain comparison] WebGPU unavailable; continuing with WebGL2 only.",
        );
        return false;
    }

    const existing = states.get(host);
    if (existing && !existing.failed) return true;

    const canvas = document.createElement("canvas");
    configureComparisonCanvas(canvas);
    canvas.width = Math.max(1, host.canvas.width | 0);
    canvas.height = Math.max(1, host.canvas.height | 0);

    const backend = new WebGPUGraphicsBackend();
    const renderer = new WebGPUStaticSceneRenderer(backend);
    const state: TerrainComparisonState = {
        canvas,
        backend,
        renderer,
        previousOnMapRemoved: host.mapManager.onMapRemoved,
        ready: false,
        failed: false,
        pendingTextures: new Map(),
        pendingMaps: new Map(),
    };
    states.set(host, state);

    try {
        await backend.init({
            powerPreference: "high-performance",
            onDeviceLost: ({ reason, message }) => {
                disableComparison(
                    host,
                    new Error(`WebGPU device lost (${reason}): ${message}`),
                );
            },
            onUncapturedError: (message) => {
                console.warn(`[WebGPU terrain comparison] validation: ${message}`);
            },
        });
        await renderer.init(canvas);

        const materialData = buildMaterialTable({
            textureIds: host.textureIds,
            layerCount: Math.max(1, host.textureLayerCount),
            idToLayer: host.textureIdIndexMap,
            frameCounts: host.textureFrameCounts,
            getMaterial: (textureId) => host.osrsClient.textureLoader.getMaterial(textureId),
            waterTextureIds: host.collectWaterTextureIds(),
            getWaterMaterialParams: (textureId) => host.getWaterMaterialParams(textureId),
        });
        renderer.configureTerrainTextures({
            layerCount: Math.max(1, host.textureLayerCount),
            idToLayer: host.textureIdIndexMap,
            frameCounts: host.textureFrameCounts,
            materialData,
        });

        try {
            renderer.configureWaterTextures(await host.loadWaterTextureData());
        } catch (error) {
            console.warn(
                "[WebGPU terrain comparison] Water assets unavailable; using deterministic fallback.",
                error,
            );
            renderer.configureWaterTextures(createFallbackWaterTextureData());
        }

        const previous = state.previousOnMapRemoved;
        const wrapper = (mapX: number, mapY: number) => {
            try {
                previous?.(mapX, mapY);
            } finally {
                if (!state.failed) state.renderer.removeTerrain(mapX, mapY);
            }
        };
        state.mapRemovedWrapper = wrapper;
        host.mapManager.onMapRemoved = wrapper;

        state.ready = true;

        if (state.pendingTextures.size > 0) {
            renderer.updateTerrainTextures(state.pendingTextures);
            state.pendingTextures.clear();
        }
        if (state.pendingMaps.size > 0) {
            for (const pending of state.pendingMaps.values()) {
                const { mapData, loadTime } = pending;
                if (!host.mapManager.getMap(mapData.mapX, mapData.mapY)) continue;
                renderer.updateTerrainTextures(mapData.loadedTextures);
                renderer.uploadTerrain(mapData, loadTime);
            }
            state.pendingMaps.clear();
        }

        if (host.canvas.parentElement && canvas.parentNode !== host.canvas.parentElement) {
            host.canvas.parentElement.appendChild(canvas);
        }

        console.info(
            "[WebGPU terrain comparison] Active: WebGL2 left half, WebGPU terrain right half.",
        );
        return true;
    } catch (error) {
        disableComparison(host, error);
        return false;
    }
}

export function getWebGPUTerrainComparisonCanvas(
    renderer: Renderer,
): HTMLCanvasElement | undefined {
    const state = states.get(renderer);
    return state && !state.failed ? state.canvas : undefined;
}

export function syncWebGPUTerrainTextures(
    host: WebGLOsrsRenderer,
    textures: ReadonlyMap<number, Int32Array>,
): void {
    const state = states.get(host);
    if (!state || state.failed) return;
    if (!state.ready) {
        for (const [textureId, pixels] of textures) {
            state.pendingTextures.set(textureId, pixels);
        }
        return;
    }
    try {
        state.renderer.updateTerrainTextures(textures);
    } catch (error) {
        disableComparison(host, error);
    }
}

export function syncWebGPUTerrainMap(
    host: WebGLOsrsRenderer,
    mapData: SdMapData,
    loadTime: number,
): void {
    const state = states.get(host);
    if (
        !state ||
        state.failed ||
        mapData.doorOnly ||
        mapData.locOnly ||
        mapData.mapX >= 200
    ) return;
    if (!state.ready) {
        for (const [textureId, pixels] of mapData.loadedTextures) {
            state.pendingTextures.set(textureId, pixels);
        }
        state.pendingMaps.set(
            `${mapData.mapX | 0}:${mapData.mapY | 0}`,
            { mapData, loadTime },
        );
        return;
    }
    try {
        state.renderer.updateTerrainTextures(mapData.loadedTextures);
        state.renderer.uploadTerrain(mapData, loadTime);
    } catch (error) {
        disableComparison(host, error);
    }
}

export function clearWebGPUTerrainComparisonMaps(host: WebGLOsrsRenderer): void {
    const state = states.get(host);
    if (!state || state.failed) return;
    state.pendingMaps.clear();
    if (!state.ready) return;
    try {
        state.renderer.clearTerrain();
    } catch (error) {
        disableComparison(host, error);
    }
}

export function renderWebGPUTerrainComparison(host: WebGLOsrsRenderer): void {
    const state = states.get(host);
    if (!state || state.failed || !state.ready) return;
    try {
        const width = Math.max(1, host.canvas.width | 0);
        const height = Math.max(1, host.canvas.height | 0);
        if (state.canvas.width !== width) state.canvas.width = width;
        if (state.canvas.height !== height) state.canvas.height = height;
        state.renderer.setVisibleTerrainMaps(
            host.mapManager.visibleMaps,
            host.mapManager.visibleMapCount,
        );
        state.renderer.render(host.sceneFrameDescription);
    } catch (error) {
        disableComparison(host, error);
    }
}

export function disposeWebGPUTerrainComparison(host: WebGLOsrsRenderer): void {
    const state = states.get(host);
    if (!state) return;

    if (
        state.mapRemovedWrapper &&
        host.mapManager.onMapRemoved === state.mapRemovedWrapper
    ) {
        host.mapManager.onMapRemoved = state.previousOnMapRemoved;
    }

    try { state.renderer.dispose(); } catch {}
    try { state.backend.dispose(); } catch {}
    state.canvas.remove();
    states.delete(host);
}
