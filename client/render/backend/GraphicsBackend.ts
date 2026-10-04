export type GraphicsBackendKind = "webgl2" | "webgpu";

export interface GraphicsBackend {
    readonly kind: GraphicsBackendKind;
    readonly label: string;
    readonly initialized: boolean;

    dispose(): void;
}
