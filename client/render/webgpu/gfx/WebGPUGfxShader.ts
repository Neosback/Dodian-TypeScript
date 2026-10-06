import { WEBGPU_NPC_ALPHA_SHADER } from "../npc/WebGPUNpcAlphaShader";

const NPC_LOAD_FADE = `
    let baseFogAmount = fogFactor(worldPos.xz - scene.playerPos);
    let loadAlpha = smoothstep(0.0, 1.0, min(scene.currentTime - map.loadTime, 1.0));
    if (loadAlpha < 1.0) {
        output.fogAmount = max(1.0 - loadAlpha, baseFogAmount);
    } else {
        output.fogAmount = baseFogAmount;
    }`;

const GFX_FOG = "output.fogAmount = fogFactor(worldPos.xz - scene.playerPos);";

function replaceEvery(source: string, search: string, replacement: string): string {
    return source.split(search).join(replacement);
}

/**
 * Spot animations are rendered with the NPC program in WebGL, but intentionally
 * bypass map load fade by setting u_timeLoaded = -1. Derive from the NPC shader
 * so plane/priority depth behavior matches NPC/GFX WebGL semantics rather than
 * player equipment-layer semantics.
 */
let gfxShader = WEBGPU_NPC_ALPHA_SHADER;
gfxShader = replaceEvery(gfxShader, "NpcVertexInput", "GfxVertexInput");
gfxShader = replaceEvery(gfxShader, "NpcVertexOutput", "GfxVertexOutput");
gfxShader = replaceEvery(gfxShader, "npcHeightMap", "gfxHeightMap");
gfxShader = replaceEvery(gfxShader, "getNpcTileHeight", "getGfxTileHeight");
gfxShader = replaceEvery(gfxShader, "getNpcHeightInterp", "getGfxHeightInterp");
gfxShader = gfxShader
    .replace("fn vsNpcOpaque", "fn vsGfx")
    .replace("fn fsNpcOpaque", "fn fsGfxOpaque")
    .replace("fn fsNpcAlpha", "fn fsGfxAlpha")
    .replace(NPC_LOAD_FADE, GFX_FOG);

export const WEBGPU_GFX_SHADER = gfxShader;

if (!WEBGPU_GFX_SHADER.includes("fn vsGfx")) {
    throw new Error("Failed to derive WebGPU GFX vertex shader");
}
if (!WEBGPU_GFX_SHADER.includes("fn fsGfxOpaque")) {
    throw new Error("Failed to derive WebGPU GFX opaque fragment shader");
}
if (!WEBGPU_GFX_SHADER.includes("fn fsGfxAlpha")) {
    throw new Error("Failed to derive WebGPU GFX alpha fragment shader");
}
if (WEBGPU_GFX_SHADER.includes("map.loadTime")) {
    throw new Error("WebGPU GFX shader must not apply map load fade");
}
