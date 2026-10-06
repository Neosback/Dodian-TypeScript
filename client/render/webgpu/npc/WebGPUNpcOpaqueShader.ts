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

const PLAYER_PRIORITY_DEPTH = `
    let priority = (input.packed.z >> 6u) & 0x7u;
    var depthLayerPos = viewPos;
    if (priority > 0u) {
        var layer = f32(priority);
        if (priority == 7u) {
            layer += TOP_PRIORITY_EXTRA_BIAS / PRIORITY_LAYER_EPSILON;
        }
        depthLayerPos.z += layer * PRIORITY_LAYER_EPSILON;
    }
    let depthLayerClip = scene.projectionMatrix * depthLayerPos;
    var clip = scene.projectionMatrix * viewPos;
    if (abs(depthLayerClip.w) > 0.000001) {
        clip.z = depthLayerClip.z * clip.w / depthLayerClip.w;
    }
`;

const NPC_PRIORITY_DEPTH = `
    // Match npc.vert.glsl: plane separation and face-priority bias are applied
    // directly in view space before projection. Unlike player equipment layers,
    // this intentionally changes projected perspective together with depth.
    viewPos.z += f32(plane) * 0.01;
    let priority = (input.packed.z >> 6u) & 0x7u;
    if (priority > 0u) {
        var layer = f32(priority);
        if (priority == 7u) {
            layer += TOP_PRIORITY_EXTRA_BIAS / PRIORITY_LAYER_EPSILON;
        }
        viewPos.z += layer * PRIORITY_LAYER_EPSILON;
    }
    let clip = scene.projectionMatrix * viewPos;
`;

function replaceEvery(source: string, search: string, replacement: string): string {
    return source.split(search).join(replacement);
}

/**
 * NPCs share the packed model/material vertex contract with players, but not
 * the player's equipment-layer projection rule. WebGL NPCs add plane and face
 * priority bias in view space before projection, and also apply map load fade.
 */
let npcShader = WEBGPU_PLAYER_OPAQUE_SHADER;
npcShader = replaceEvery(npcShader, "PlayerVertexInput", "NpcVertexInput");
npcShader = replaceEvery(npcShader, "PlayerVertexOutput", "NpcVertexOutput");
npcShader = replaceEvery(npcShader, "playerHeightMap", "npcHeightMap");
npcShader = replaceEvery(npcShader, "getPlayerTileHeight", "getNpcTileHeight");
npcShader = replaceEvery(npcShader, "getPlayerHeightInterp", "getNpcHeightInterp");
npcShader = npcShader
    .replace("fn vsPlayerOpaque", "fn vsNpcOpaque")
    .replace("fn fsPlayerOpaque", "fn fsNpcOpaque")
    .replace(PLAYER_PRIORITY_DEPTH, NPC_PRIORITY_DEPTH)
    .replace(PLAYER_FOG_ASSIGNMENT, NPC_FOG_ASSIGNMENT);

export const WEBGPU_NPC_OPAQUE_SHADER = npcShader;

if (!WEBGPU_NPC_OPAQUE_SHADER.includes("fn vsNpcOpaque")) {
    throw new Error("Failed to derive WebGPU NPC opaque vertex shader");
}
if (!WEBGPU_NPC_OPAQUE_SHADER.includes("map.loadTime")) {
    throw new Error("Failed to inject WebGPU NPC map load fade");
}
if (!WEBGPU_NPC_OPAQUE_SHADER.includes("viewPos.z += f32(plane) * 0.01")) {
    throw new Error("Failed to inject WebGPU NPC plane separation");
}
if (WEBGPU_NPC_OPAQUE_SHADER.includes("depthLayerClip")) {
    throw new Error("WebGPU NPC shader must not use player equipment depth projection");
}
