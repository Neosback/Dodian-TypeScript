const MAP_UNIFORM_STRUCT = `struct MapUniforms {
    mapPos: vec2<f32>,
    plane: f32,
    loadTime: f32,
    borderSize: f32,
    _padding0: f32,
    _padding1: vec2<f32>,
};`;

const PATCHED_MAP_UNIFORM_STRUCT = `struct MapUniforms {
    mapPos: vec2<f32>,
    plane: f32,
    loadTime: f32,
    borderSize: f32,
    _padding0: f32,
    _padding1: vec2<f32>,
    worldEntityTransform: mat4x4<f32>,
};`;

const VIEW_POSITION_LINE =
    "var viewPos = scene.viewMatrix * vec4<f32>(worldPos, 1.0);";
const PATCHED_VIEW_POSITION_LINE =
    "var viewPos = map.worldEntityTransform * (scene.viewMatrix * vec4<f32>(worldPos, 1.0));";

/**
 * Extend the shared static-scene WGSL with the per-map world-entity transform.
 *
 * WebGL applies u_worldEntityTransform after the camera/view transform and before
 * projection. Keeping the matrix in the map uniform preserves that exact order
 * for terrain, locs, and doors while world-space fog/water inputs stay unchanged.
 */
export function patchWebGPUStaticSceneShaderForWorldEntities(code: string): string {
    if (!code.includes(MAP_UNIFORM_STRUCT)) {
        throw new Error("WebGPU static-scene shader MapUniforms contract changed");
    }

    const viewPositionMatches = code.split(VIEW_POSITION_LINE).length - 1;
    if (viewPositionMatches !== 2) {
        throw new Error(
            `Expected two static-scene view-position sites, found ${viewPositionMatches}`,
        );
    }

    return code
        .replace(MAP_UNIFORM_STRUCT, PATCHED_MAP_UNIFORM_STRUCT)
        .split(VIEW_POSITION_LINE)
        .join(PATCHED_VIEW_POSITION_LINE);
}
