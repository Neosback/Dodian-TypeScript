import type { GraphicsBackendKind } from "./GraphicsBackend";
import { getBrowserWebGPUApi } from "./WebGPUPlatform";

export type GraphicsBackendPreference = "auto" | "webgpu" | "webgl2";

export interface GraphicsBackendCapabilities {
    webgpu: boolean;
    webgl2: boolean;
}

export function parseGraphicsBackendPreference(search: string): GraphicsBackendPreference {
    const params = new URLSearchParams(search);
    const requested = params.get("renderer")?.trim().toLowerCase();
    if (requested === "webgpu") {
        return "webgpu";
    }
    if (requested === "webgl2" || requested === "webgl") {
        return "webgl2";
    }
    return "auto";
}

export function getRequestedGraphicsBackendPreference(): GraphicsBackendPreference {
    if (typeof window === "undefined") {
        return "auto";
    }
    return parseGraphicsBackendPreference(window.location?.search ?? "");
}

export function hasWebGPUApi(): boolean {
    return getBrowserWebGPUApi() !== undefined;
}

export function resolveGraphicsBackendOrder(
    preference: GraphicsBackendPreference,
    capabilities: GraphicsBackendCapabilities,
): GraphicsBackendKind[] {
    if (preference === "webgl2") {
        return capabilities.webgl2 ? ["webgl2"] : [];
    }

    if (preference === "webgpu") {
        const order: GraphicsBackendKind[] = [];
        if (capabilities.webgpu) order.push("webgpu");
        if (capabilities.webgl2) order.push("webgl2");
        return order;
    }

    const order: GraphicsBackendKind[] = [];
    if (capabilities.webgpu) order.push("webgpu");
    if (capabilities.webgl2) order.push("webgl2");
    return order;
}
