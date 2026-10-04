export type WebGPUPowerPreference = "low-power" | "high-performance";
export type WebGPUCanvasAlphaMode = "opaque" | "premultiplied";
export type WebGPUCompilationMessageType = "error" | "warning" | "info";

export const WEBGPU_BUFFER_USAGE = {
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
} as const;

export const WEBGPU_TEXTURE_USAGE = {
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    RENDER_ATTACHMENT: 0x10,
} as const;

export const WEBGPU_SHADER_STAGE = {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4,
} as const;

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

export interface WebGPUBufferLike {
    destroy?(): void;
}

export interface WebGPUTextureViewLike {}

export interface WebGPUTextureLike {
    createView(descriptor?: Record<string, unknown>): WebGPUTextureViewLike;
    destroy?(): void;
}

export interface WebGPUBindGroupLayoutLike {}
export interface WebGPUPipelineLayoutLike {}
export interface WebGPUBindGroupLike {}
export interface WebGPUSamplerLike {}
export interface WebGPURenderPipelineLike {}
export interface WebGPUCommandBufferLike {}

export interface WebGPURenderPassEncoderLike {
    setPipeline(pipeline: WebGPURenderPipelineLike): void;
    setBindGroup(index: number, bindGroup: WebGPUBindGroupLike): void;
    setVertexBuffer(slot: number, buffer: WebGPUBufferLike, offset?: number, size?: number): void;
    setIndexBuffer(
        buffer: WebGPUBufferLike,
        indexFormat: "uint16" | "uint32",
        offset?: number,
        size?: number,
    ): void;
    setViewport?(
        x: number,
        y: number,
        width: number,
        height: number,
        minDepth: number,
        maxDepth: number,
    ): void;
    setScissorRect?(x: number, y: number, width: number, height: number): void;
    drawIndexed(
        indexCount: number,
        instanceCount?: number,
        firstIndex?: number,
        baseVertex?: number,
        firstInstance?: number,
    ): void;
    end(): void;
}

export interface WebGPUCommandEncoderLike {
    beginRenderPass(descriptor: Record<string, unknown>): WebGPURenderPassEncoderLike;
    finish(): WebGPUCommandBufferLike;
}

export interface WebGPUImageCopyTextureLike {
    texture: WebGPUTextureLike;
    mipLevel?: number;
    origin?: { x?: number; y?: number; z?: number };
}

export interface WebGPUImageDataLayoutLike {
    offset?: number;
    bytesPerRow?: number;
    rowsPerImage?: number;
}

export interface WebGPUExtent3DLike {
    width: number;
    height: number;
    depthOrArrayLayers?: number;
}

export interface WebGPUQueueLike {
    writeBuffer(
        buffer: WebGPUBufferLike,
        bufferOffset: number,
        data: ArrayBuffer | ArrayBufferView,
        dataOffset?: number,
        size?: number,
    ): void;
    writeTexture(
        destination: WebGPUImageCopyTextureLike,
        data: ArrayBuffer | ArrayBufferView,
        dataLayout: WebGPUImageDataLayoutLike,
        size: WebGPUExtent3DLike,
    ): void;
    submit(commandBuffers: WebGPUCommandBufferLike[]): void;
}

export interface WebGPUDeviceLike {
    readonly lost: Promise<WebGPUDeviceLostInfoLike>;
    readonly queue: WebGPUQueueLike;
    createShaderModule(descriptor: { code: string; label?: string }): WebGPUShaderModuleLike;
    createBuffer(descriptor: Record<string, unknown>): WebGPUBufferLike;
    createTexture(descriptor: Record<string, unknown>): WebGPUTextureLike;
    createBindGroupLayout(descriptor: Record<string, unknown>): WebGPUBindGroupLayoutLike;
    createPipelineLayout(descriptor: Record<string, unknown>): WebGPUPipelineLayoutLike;
    createBindGroup(descriptor: Record<string, unknown>): WebGPUBindGroupLike;
    createSampler(descriptor?: Record<string, unknown>): WebGPUSamplerLike;
    createRenderPipeline(descriptor: Record<string, unknown>): WebGPURenderPipelineLike;
    createCommandEncoder(descriptor?: Record<string, unknown>): WebGPUCommandEncoderLike;
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
    getCurrentTexture(): WebGPUTextureLike;
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
