import assert from "node:assert/strict";

import {
    parseGraphicsBackendPreference,
    resolveGraphicsBackendOrder,
} from "../render/backend/GraphicsBackendSelection";
import { WebGPUGraphicsBackend } from "../render/backend/WebGPUGraphicsBackend";
import type {
    WebGPUAdapterLike,
    WebGPUApiLike,
    WebGPUDeviceLike,
    WebGPUShaderModuleLike,
} from "../render/backend/WebGPUPlatform";

assert.equal(parseGraphicsBackendPreference("?renderer=webgpu"), "webgpu");
assert.equal(parseGraphicsBackendPreference("?renderer=webgl2"), "webgl2");
assert.equal(parseGraphicsBackendPreference("?renderer=webgl"), "webgl2");
assert.equal(parseGraphicsBackendPreference("?renderer=unknown"), "auto");

assert.deepEqual(
    resolveGraphicsBackendOrder("auto", { webgpu: true, webgl2: true }),
    ["webgpu", "webgl2"],
);
assert.deepEqual(
    resolveGraphicsBackendOrder("auto", { webgpu: false, webgl2: true }),
    ["webgl2"],
);
assert.deepEqual(
    resolveGraphicsBackendOrder("webgpu", { webgpu: false, webgl2: true }),
    ["webgl2"],
);
assert.deepEqual(
    resolveGraphicsBackendOrder("webgl2", { webgpu: true, webgl2: true }),
    ["webgl2"],
);

let requestedPowerPreference: string | undefined;
let destroyed = false;
let lostResolve!: (info: { reason?: string; message?: string }) => void;
const lost = new Promise<{ reason?: string; message?: string }>((resolve) => {
    lostResolve = resolve;
});

const shaderModule: WebGPUShaderModuleLike = {
    async getCompilationInfo() {
        return { messages: [] };
    },
};

const device: WebGPUDeviceLike = {
    lost,
    createShaderModule() {
        return shaderModule;
    },
    destroy() {
        destroyed = true;
    },
};

const adapter: WebGPUAdapterLike = {
    async requestDevice() {
        return device;
    },
};

const api: WebGPUApiLike = {
    async requestAdapter(options) {
        requestedPowerPreference = options?.powerPreference;
        return adapter;
    },
    getPreferredCanvasFormat() {
        return "bgra8unorm";
    },
};

const backend = new WebGPUGraphicsBackend(api);
const resources = await backend.init();
assert.equal(backend.initialized, true);
assert.equal(resources.device, device);
assert.equal(resources.format, "bgra8unorm");
assert.equal(requestedPowerPreference, "high-performance");

await backend.compileShaderModule("@vertex fn main() {}");
backend.dispose();
assert.equal(backend.initialized, false);
assert.equal(destroyed, true);

// Resolve after disposal to ensure intentional teardown does not behave as a
// runtime device-loss notification.
lostResolve({ reason: "destroyed", message: "test teardown" });

console.log("webgpu backend bootstrap checks passed");
