import type { GraphicsBackend } from "./GraphicsBackend";
import {
    getBrowserWebGPUApi,
    getWebGPUCanvasContext,
    type WebGPUAdapterLike,
    type WebGPUApiLike,
    type WebGPUCanvasAlphaMode,
    type WebGPUCanvasContextLike,
    type WebGPUCompilationMessageLike,
    type WebGPUDeviceLike,
    type WebGPUPowerPreference,
    type WebGPUShaderModuleLike,
} from "./WebGPUPlatform";

export interface WebGPUBackendOptions {
    powerPreference?: WebGPUPowerPreference;
    alphaMode?: WebGPUCanvasAlphaMode;
    onDeviceLost?: (info: { reason: string; message: string }) => void;
    onUncapturedError?: (message: string) => void;
    shaderSourceTransform?: (code: string, label?: string) => string;
}

export interface WebGPUBackendResources {
    api: WebGPUApiLike;
    adapter: WebGPUAdapterLike;
    device: WebGPUDeviceLike;
    format: string;
}

export interface WebGPUCanvasResources {
    context: WebGPUCanvasContextLike;
    format: string;
    alphaMode: WebGPUCanvasAlphaMode;
}

function formatCompilationMessage(message: WebGPUCompilationMessageLike): string {
    const location =
        message.lineNum !== undefined
            ? ` line ${message.lineNum}${message.linePos !== undefined ? `:${message.linePos}` : ""}`
            : "";
    return `[${message.type}]${location} ${message.message}`;
}

/**
 * Owns WebGPU adapter/device lifetime and canvas configuration.
 *
 * Device creation is intentionally separate from canvas configuration. If a
 * WebGPU canvas configuration fails, the app can replace the renderer/canvas
 * before falling back to WebGL2 instead of trying to acquire two context types
 * from the same HTMLCanvasElement.
 */
export class WebGPUGraphicsBackend implements GraphicsBackend {
    readonly kind = "webgpu" as const;
    readonly label = "WebGPU";

    private resources?: WebGPUBackendResources;
    private canvasResources?: WebGPUCanvasResources;
    private disposed = false;
    private deviceGeneration = 0;
    private uncapturedErrorListener?: (event: { error?: { message?: string } }) => void;
    private options: WebGPUBackendOptions = {};

    constructor(private readonly apiOverride?: WebGPUApiLike) {}

    static isSupported(): boolean {
        return getBrowserWebGPUApi() !== undefined;
    }

    get initialized(): boolean {
        return this.resources !== undefined;
    }

    get configured(): boolean {
        return this.canvasResources !== undefined;
    }

    get device(): WebGPUDeviceLike | undefined {
        return this.resources?.device;
    }

    get format(): string | undefined {
        return this.resources?.format;
    }

    get canvasContext(): WebGPUCanvasContextLike | undefined {
        return this.canvasResources?.context;
    }

    async init(options: WebGPUBackendOptions = {}): Promise<WebGPUBackendResources> {
        this.dispose();
        this.disposed = false;
        this.options = options;
        const generation = this.deviceGeneration;

        const api = this.apiOverride ?? getBrowserWebGPUApi();
        if (!api) {
            throw new Error("WebGPU is not available in this browser");
        }

        const adapter = await api.requestAdapter({
            powerPreference: options.powerPreference ?? "high-performance",
        });
        if (generation !== this.deviceGeneration || this.disposed) {
            throw new Error("WebGPU initialization was cancelled");
        }
        if (!adapter) {
            throw new Error("WebGPU did not provide a compatible GPU adapter");
        }

        const device = await adapter.requestDevice();
        if (generation !== this.deviceGeneration || this.disposed) {
            try {
                device.destroy?.();
            } catch {}
            throw new Error("WebGPU initialization was cancelled");
        }
        const format = api.getPreferredCanvasFormat();

        this.uncapturedErrorListener = (event) => {
            const message = event.error?.message || "Unknown WebGPU validation error";
            console.error(`[WebGPU] Uncaptured error: ${message}`);
            this.options.onUncapturedError?.(message);
        };
        device.addEventListener?.("uncapturederror", this.uncapturedErrorListener);

        void device.lost.then((info) => {
            if (
                this.disposed ||
                generation !== this.deviceGeneration ||
                this.resources?.device !== device
            ) {
                return;
            }
            const reason = info.reason || "unknown";
            const message = info.message || "WebGPU device was lost";
            console.error(`[WebGPU] Device lost (${reason}): ${message}`);
            this.options.onDeviceLost?.({ reason, message });
        });

        const resources: WebGPUBackendResources = {
            api,
            adapter,
            device,
            format,
        };
        this.resources = resources;
        return resources;
    }

    configureCanvas(
        canvas: HTMLCanvasElement,
        alphaMode: WebGPUCanvasAlphaMode = this.options.alphaMode ?? "opaque",
    ): WebGPUCanvasResources {
        const resources = this.resources;
        if (!resources) {
            throw new Error("WebGPU device must be initialized before configuring the canvas");
        }

        this.canvasResources?.context.unconfigure?.();
        const context = getWebGPUCanvasContext(canvas);
        if (!context) {
            throw new Error("Canvas does not expose a WebGPU context");
        }

        context.configure({
            device: resources.device,
            format: resources.format,
            alphaMode,
        });

        const canvasResources: WebGPUCanvasResources = {
            context,
            format: resources.format,
            alphaMode,
        };
        this.canvasResources = canvasResources;
        return canvasResources;
    }

    async compileShaderModule(code: string, label?: string): Promise<WebGPUShaderModuleLike> {
        const device = this.resources?.device;
        if (!device) {
            throw new Error("WebGPU device is not initialized");
        }

        const transformedCode = this.options.shaderSourceTransform?.(code, label) ?? code;
        const module = device.createShaderModule({ code: transformedCode, label });
        const info = await module.getCompilationInfo?.();
        if (!info) {
            return module;
        }

        const messages = info.messages;
        for (const message of messages) {
            const formatted = formatCompilationMessage(message);
            if (message.type === "error") {
                console.error(`[WebGPU shader] ${label ?? "unnamed"}: ${formatted}`);
            } else if (message.type === "warning") {
                console.warn(`[WebGPU shader] ${label ?? "unnamed"}: ${formatted}`);
            }
        }

        const errors = messages.filter((message) => message.type === "error");
        if (errors.length > 0) {
            throw new Error(
                `WGSL compilation failed for ${label ?? "unnamed shader"}:\n${errors
                    .map(formatCompilationMessage)
                    .join("\n")}`,
            );
        }

        return module;
    }

    dispose(): void {
        this.disposed = true;
        this.deviceGeneration++;

        const device = this.resources?.device;
        if (device && this.uncapturedErrorListener) {
            device.removeEventListener?.("uncapturederror", this.uncapturedErrorListener);
        }
        this.uncapturedErrorListener = undefined;

        try {
            this.canvasResources?.context.unconfigure?.();
        } catch {}
        this.canvasResources = undefined;

        try {
            device?.destroy?.();
        } catch {}
        this.resources = undefined;
        this.options = {};
    }
}
