import { WEBGPU_PLAYER_OPAQUE_SHADER } from "../player/WebGPUPlayerOpaqueShader";

const PLAYER_FOG_ASSIGNMENT =
    "output.fogAmount = fogFactor(worldPos.xz - scene.playerPos);";

const NPC_FOG_ASSIGNMENT = `
    let baseFogAmount = fogFactor(worldPos.xz - scene.playerPos);
    let loadAlpha = smoothstep(0.0, 1.0, min(scene.currentTime - map.loadTime, 1.0));
    if (loadAlpha < 1.0) {
        output.fogAmount = max(1.0 - loadAlpha, baseFogAmount);
    } else {
        output.fogAmount = baseFogAmount;
    }`;

/**
 * NPCs share the packed model/material vertex contract with players. The only
 * shader-level behavior added here is map load-fade fog, which the WebGL NPC
 * vertex shader applies and the player shader intentionally does not.
 */
export const WEBGPU_NPC_OPAQUE_SHADER = WEBGPU_PLAYER_OPAQUE_SHADER
    .replaceAll("PlayerVertexInput", "NpcVertexInput")
    .replaceAll("PlayerVertexOutput", "NpcVertexOutput")
    .replaceAll("playerHeightMap", "npcHeightMap")
    .replaceAll("getPlayerTileHeight", "getNpcTileHeight")
    .replaceAll("getPlayerHeightInterp", "getNpcHeightInterp")
    .replace("fn vsPlayerOpaque", "fn vsNpcOpaque")
    .replace("fn fsPlayerOpaque", "fn fsNpcOpaque")
    .replace(PLAYER_FOG_ASSIGNMENT, NPC_FOG_ASSIGNMENT);

if (!WEBGPU_NPC_OPAQUE_SHADER.includes("fn vsNpcOpaque")) {
    throw new Error("Failed to derive WebGPU NPC opaque vertex shader");
}
if (!WEBGPU_NPC_OPAQUE_SHADER.includes("map.loadTime")) {
    throw new Error("Failed to inject WebGPU NPC map load fade");
}
