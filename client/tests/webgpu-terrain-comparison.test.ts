import assert from "node:assert/strict";

import { isWebGPUTerrainComparisonRequested } from "../render/webgpu/compare/WebGPUTerrainComparison";

assert.equal(isWebGPUTerrainComparisonRequested("?webgpuTerrain=1"), true);
assert.equal(isWebGPUTerrainComparisonRequested("?webgpuTerrain=true"), true);
assert.equal(isWebGPUTerrainComparisonRequested("?webgpuTerrain=compare"), true);
assert.equal(isWebGPUTerrainComparisonRequested("?webgpuTerrain=split"), true);
assert.equal(isWebGPUTerrainComparisonRequested("?webgpuTerrain=0"), false);
assert.equal(isWebGPUTerrainComparisonRequested("?renderer=webgpu"), false);
assert.equal(isWebGPUTerrainComparisonRequested(""), false);

console.log("webgpu terrain comparison preference checks passed");
