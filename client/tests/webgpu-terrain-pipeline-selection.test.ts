import assert from "node:assert/strict";

import { getWebGPUTerrainPipelineVariant } from "../render/webgpu/WebGPUStaticSceneRenderer";

assert.equal(getWebGPUTerrainPipelineVariant(false, true), "opaque-cull");
assert.equal(getWebGPUTerrainPipelineVariant(false, false), "opaque-no-cull");
assert.equal(getWebGPUTerrainPipelineVariant(true, true), "alpha-cull");
assert.equal(getWebGPUTerrainPipelineVariant(true, false), "alpha-no-cull");

console.log("webgpu terrain pipeline selection checks passed");
