import type { GraphicsBackendKind } from "./GraphicsBackend";
import {
    type GraphicsBackendCapabilities,
    type GraphicsBackendPreference,
    resolveGraphicsBackendOrder,
} from "./GraphicsBackendSelection";
import {
    type WebGPUBackendOptions,
    WebGPUGraphicsBackend,
} from "./WebGPUGraphicsBackend";

export interface GraphicsBackendBootstrapResult {
    kind: GraphicsBackendKind;
    webgpuBackend?: WebGPUGraphicsBackend;
    fallbackReason?: string;
}

export interface GraphicsBackendBootstrapOptions {
    preference: GraphicsBackendPreference;
    capabilities: GraphicsBackendCapabilities;
    webgpuOptions?: WebGPUBackendOptions;
    createWebGPUBackend?: () => WebGPUGraphicsBackend;
    onBackendFailure?: (kind: GraphicsBackendKind, error: unknown) => void;
}

/**
 * Chooses and initializes the graphics API at the device level.
 *
 * WebGL2 is returned as a selection rather than initialized here because canvas
 * context ownership belongs to the concrete renderer. That also guarantees a
 * failed WebGPU canvas configuration can fall back by replacing the renderer
 * and canvas instead of attempting a second context type on the same canvas.
 */
export async function bootstrapGraphicsBackend(
    options: GraphicsBackendBootstrapOptions,
): Promise<GraphicsBackendBootstrapResult> {
    const order = resolveGraphicsBackendOrder(options.preference, options.capabilities);
    if (order.length === 0) {
        throw new Error("No supported graphics backend is available");
    }

    let webgpuFailure: unknown;

    for (const kind of order) {
        if (kind === "webgpu") {
            const backend = options.createWebGPUBackend?.() ?? new WebGPUGraphicsBackend();
            try {
                await backend.init(options.webgpuOptions);
                return {
                    kind: "webgpu",
                    webgpuBackend: backend,
                };
            } catch (error) {
                backend.dispose();
                webgpuFailure = error;
                options.onBackendFailure?.("webgpu", error);
                continue;
            }
        }

        return {
            kind: "webgl2",
            fallbackReason:
                webgpuFailure instanceof Error
                    ? webgpuFailure.message
                    : webgpuFailure !== undefined
                      ? String(webgpuFailure)
                      : undefined,
        };
    }

    const reason =
        webgpuFailure instanceof Error
            ? webgpuFailure.message
            : webgpuFailure !== undefined
              ? String(webgpuFailure)
              : "No graphics backend could be initialized";
    throw new Error(reason);
}
