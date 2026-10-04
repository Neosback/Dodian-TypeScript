export type WebGPUPowerPreference = "low-power" | "high-performance";
export type WebGPUCanvasAlphaMode = "opaque" | "premultiplied";
export type WebGPUCompilationMessageType = "error" | "warning" | "info";

export interface WebGPUCompilationMessageLike {
    readonly message: string;
    readonly type: WebGPUCompilationMessageType;
    readonly lineNum?: number;
    readonly linePos?: number;
    readonly offset?: number;
    readonly length?: number;
}

export interface WebGPUCompilationInfoLike {
    readonly messages: ReadonlyArray<WebGPUCompilationMessageLike>;
}

export interface WebGPUShaderModuleLike {
    getCompilationInfo?(): Promise<WebGPUCompilationInfoLike>;
}

export interface WebGPUDeviceLostInfoLike {
    readonly reason?: string;
    readonly message?: string;
}

export interface WebGPUDeviceLike {
    readonly lost: Promise<WebGPUDeviceLostInfoLike>;
    createShaderModule(descriptor: { code: string; label?: string }): WebGPUShaderModuleLike;
    addEventListener?(
        type: "uncapturederror",
        listener: (event: { error?: { message?: string } }) => void,
    ): void;
    removeEventListener?(
        type: "uncapturederror",
        listener: (event: { error?: { message?: string } }) => void,
    ): void;
    destroy?(): void;
}

export interface WebGPUAdapterLike {
    requestDevice(): Promise<WebGPUDeviceLike>;
}

export interface WebGPUApiLike {
    requestAdapter(options?: {
        powerPreference?: WebGPUPowerPreference;
    }): Promise<WebGPUAdapterLike | null>;
    getPreferredCanvasFormat(): string;
}

export interface WebGPUCanvasContextLike {
    configure(descriptor: {
        device: WebGPUDeviceLike;
        format: string;
        alphaMode?: WebGPUCanvasAlphaMode;
    }): void;
    unconfigure?(): void;
}

export interface WebGPUCanvasLike {
    getContext(contextId: "webgpu"): WebGPUCanvasContextLike | null;
}

type NavigatorWithWebGPU = Navigator & {
    gpu?: WebGPUApiLike;
};

export function getBrowserWebGPUApi(): WebGPUApiLike | undefined {
    if (typeof navigator === "undefined") {
        return undefined;
    }
    return (navigator as NavigatorWithWebGPU).gpu;
}

export function getWebGPUCanvasContext(
    canvas: HTMLCanvasElement,
): WebGPUCanvasContextLike | null {
    return (canvas as unknown as WebGPUCanvasLike).getContext("webgpu");
}
