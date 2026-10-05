import { LocModelType } from "../../rs/config/loctype/LocModelType";
import {
    OBJECT_GROUND_PULL,
    PLANE_DEPTH_BIAS,
    ROOF_DEPTH_PULL,
    WALL_BEHIND_PUSH,
    WALL_DECORATION_PULL,
} from "../loc/LocDepthOrdering";

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
    mapId: u32,
    _padding1: vec2<f32>,
    worldEntityTransform: mat4x4<f32>,
};`;

const LOC_MODEL_INFO_BINDINGS = `@group(4) @binding(0) var locHeightMap: texture_2d_array<i32>;
@group(4) @binding(1) var<storage, read> locModelInfos: LocModelInfoBuffer;`;

const VERTEX_OUTPUT_STRUCT = `struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) fogAmount: f32,
    @location(2) texCoord: vec2<f32>,
    @location(3) @interpolate(flat) textureId: u32,
    @location(4) @interpolate(flat) alphaCutOff: f32,
    @location(5) worldUv: vec2<f32>,
    @location(6) worldPos: vec3<f32>,
    @location(7) @interpolate(flat) plane: f32,
};`;

const PATCHED_VERTEX_OUTPUT_STRUCT = `struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) fogAmount: f32,
    @location(2) texCoord: vec2<f32>,
    @location(3) @interpolate(flat) textureId: u32,
    @location(4) @interpolate(flat) alphaCutOff: f32,
    @location(5) worldUv: vec2<f32>,
    @location(6) worldPos: vec3<f32>,
    @location(7) @interpolate(flat) plane: f32,
    @location(8) @interpolate(flat) pickData: vec4<u32>,
};`;

const STATIC_PICK_WGSL = /* wgsl */ `
fn staticPickPackedTile(worldUv: vec2<f32>, plane: u32) -> u32 {
    let tileX = u32(clamp(i32(floor(worldUv.x)), 0, 0x3fff));
    let tileY = u32(clamp(i32(floor(worldUv.y)), 0, 0x3fff));
    return tileX | (tileY << 14u) | ((plane & 0x3u) << 28u);
}

fn staticPickData(
    interactId: u32,
    mapId: u32,
    interactType: u32,
    worldUv: vec2<f32>,
    plane: u32,
) -> vec4<u32> {
    return vec4<u32>(
        interactId,
        mapId,
        interactType,
        staticPickPackedTile(worldUv, plane) + 1u,
    );
}
`;

const LOC_DEPTH_ORDERING_WGSL = /* wgsl */ `
const LOC_OBJECT_GROUND_PULL: f32 = ${OBJECT_GROUND_PULL};
const LOC_WALL_DECORATION_PULL: f32 = ${WALL_DECORATION_PULL};
const LOC_WALL_BEHIND_PUSH: f32 = ${WALL_BEHIND_PUSH};
const LOC_ROOF_DEPTH_PULL: f32 = ${ROOF_DEPTH_PULL};
const LOC_PLANE_DEPTH_BIAS: f32 = ${PLANE_DEPTH_BIAS};

const LOC_TYPE_WALL: u32 = ${LocModelType.WALL}u;
const LOC_TYPE_WALL_TRI_CORNER: u32 = ${LocModelType.WALL_TRI_CORNER}u;
const LOC_TYPE_WALL_CORNER: u32 = ${LocModelType.WALL_CORNER}u;
const LOC_TYPE_WALL_RECT_CORNER: u32 = ${LocModelType.WALL_RECT_CORNER}u;
const LOC_TYPE_WALL_DECORATION_INSIDE: u32 = ${LocModelType.WALL_DECORATION_INSIDE}u;
const LOC_TYPE_WALL_DECORATION_OUTSIDE: u32 = ${LocModelType.WALL_DECORATION_OUTSIDE}u;
const LOC_TYPE_WALL_DECORATION_DIAGONAL_OUTSIDE: u32 = ${LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE}u;
const LOC_TYPE_WALL_DECORATION_DIAGONAL_INSIDE: u32 = ${LocModelType.WALL_DECORATION_DIAGONAL_INSIDE}u;
const LOC_TYPE_WALL_DECORATION_DIAGONAL_DOUBLE: u32 = ${LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE}u;
const LOC_TYPE_WALL_DIAGONAL: u32 = ${LocModelType.WALL_DIAGONAL}u;
const LOC_TYPE_NORMAL: u32 = ${LocModelType.NORMAL}u;
const LOC_TYPE_NORMAL_DIAGONAL: u32 = ${LocModelType.NORMAL_DIAGIONAL}u;
const LOC_TYPE_ROOF_FIRST: u32 = ${LocModelType.ROOF_SLOPED}u;
const LOC_TYPE_ROOF_LAST: u32 = ${LocModelType.ROOF_SLOPED_OVERHANG_HARD_OUTER_CORNER}u;
const LOC_TYPE_FLOOR_DECORATION: u32 = ${LocModelType.FLOOR_DECORATION}u;

const LOC_EDGE_X_NEG: u32 = 1u;
const LOC_EDGE_Y_POS: u32 = 2u;
const LOC_EDGE_X_POS: u32 = 4u;
const LOC_EDGE_Y_NEG: u32 = 8u;

fn locPlacementType(metadata: u32) -> u32 {
    return metadata & 0x3fu;
}

fn locPlacementRotation(metadata: u32) -> u32 {
    return (metadata >> 6u) & 0x3u;
}

fn locPlacementSecondary(metadata: u32) -> bool {
    return ((metadata >> 8u) & 0x1u) != 0u;
}

fn locCardinalEdgeMask(metadata: u32) -> u32 {
    let modelType = locPlacementType(metadata);
    let rotation = locPlacementRotation(metadata);
    if (modelType == LOC_TYPE_WALL) {
        return 1u << rotation;
    }
    if (modelType == LOC_TYPE_WALL_CORNER) {
        let secondary = select(0u, 1u, locPlacementSecondary(metadata));
        return 1u << ((rotation + secondary) & 0x3u);
    }
    if (
        modelType == LOC_TYPE_WALL_DECORATION_INSIDE ||
        modelType == LOC_TYPE_WALL_DECORATION_OUTSIDE
    ) {
        return 1u << rotation;
    }
    return 0u;
}

fn locCameraOutsideCardinalEdge(
    edgeMask: u32,
    locTile: vec2<i32>,
    cameraTile: vec2<i32>,
) -> bool {
    if ((edgeMask & LOC_EDGE_X_NEG) != 0u && cameraTile.x < locTile.x) {
        return true;
    }
    if ((edgeMask & LOC_EDGE_X_POS) != 0u && cameraTile.x > locTile.x) {
        return true;
    }
    if ((edgeMask & LOC_EDGE_Y_NEG) != 0u && cameraTile.y < locTile.y) {
        return true;
    }
    if ((edgeMask & LOC_EDGE_Y_POS) != 0u && cameraTile.y > locTile.y) {
        return true;
    }
    return false;
}

fn locPrimaryDiagonalDecorationFacingCamera(
    orientation2: u32,
    delta: vec2<f32>,
) -> bool {
    let rotation = orientation2 & 0x3u;
    var compareX = delta.x;
    var compareY = delta.y;
    if (rotation == 1u || rotation == 2u) {
        compareX = -compareX;
    }
    if (rotation == 2u || rotation == 3u) {
        compareY = -compareY;
    }
    return compareY < compareX;
}

fn locPlacementPartVisible(
    metadata: u32,
    locCenterTiles: vec2<f32>,
    cameraTiles: vec2<f32>,
) -> bool {
    let modelType = locPlacementType(metadata);
    let rotation = locPlacementRotation(metadata);
    let secondary = locPlacementSecondary(metadata);
    let delta = locCenterTiles - cameraTiles;

    if (modelType == LOC_TYPE_WALL_DECORATION_DIAGONAL_OUTSIDE) {
        if (secondary) {
            return false;
        }
        return locPrimaryDiagonalDecorationFacingCamera(rotation, delta);
    }
    if (modelType == LOC_TYPE_WALL_DECORATION_DIAGONAL_INSIDE) {
        if (secondary) {
            return false;
        }
        return locPrimaryDiagonalDecorationFacingCamera((rotation + 2u) & 0x3u, delta);
    }
    if (modelType == LOC_TYPE_WALL_DECORATION_DIAGONAL_DOUBLE) {
        let primaryVisible = locPrimaryDiagonalDecorationFacingCamera(rotation, delta);
        return select(primaryVisible, !primaryVisible, secondary);
    }
    return true;
}

fn locBaseCameraPullTiles(
    metadata: u32,
    locCenterTiles: vec2<f32>,
    cameraTiles: vec2<f32>,
) -> f32 {
    let modelType = locPlacementType(metadata);

    if (modelType >= LOC_TYPE_ROOF_FIRST && modelType <= LOC_TYPE_ROOF_LAST) {
        return LOC_ROOF_DEPTH_PULL;
    }

    if (modelType <= LOC_TYPE_WALL_RECT_CORNER) {
        let edgeMask = locCardinalEdgeMask(metadata);
        if (edgeMask == 0u) {
            return 0.0;
        }
        let outside = locCameraOutsideCardinalEdge(
            edgeMask,
            vec2<i32>(floor(locCenterTiles)),
            vec2<i32>(floor(cameraTiles)),
        );
        return select(-LOC_WALL_BEHIND_PUSH, 0.0, outside);
    }

    if (
        modelType >= LOC_TYPE_WALL_DECORATION_INSIDE &&
        modelType <= LOC_TYPE_WALL_DECORATION_DIAGONAL_DOUBLE
    ) {
        if (
            modelType == LOC_TYPE_WALL_DECORATION_INSIDE ||
            modelType == LOC_TYPE_WALL_DECORATION_OUTSIDE
        ) {
            let outside = locCameraOutsideCardinalEdge(
                locCardinalEdgeMask(metadata),
                vec2<i32>(floor(locCenterTiles)),
                vec2<i32>(floor(cameraTiles)),
            );
            return select(LOC_WALL_DECORATION_PULL, -LOC_WALL_DECORATION_PULL, outside);
        }
        return select(
            0.0,
            LOC_WALL_DECORATION_PULL,
            locPlacementPartVisible(metadata, locCenterTiles, cameraTiles),
        );
    }

    if (
        modelType == LOC_TYPE_WALL_DIAGONAL ||
        modelType == LOC_TYPE_NORMAL ||
        modelType == LOC_TYPE_NORMAL_DIAGONAL ||
        modelType == LOC_TYPE_FLOOR_DECORATION
    ) {
        return LOC_OBJECT_GROUND_PULL;
    }

    return 0.0;
}

fn locCameraPullTiles(
    metadata: u32,
    plane: u32,
    locCenterTiles: vec2<f32>,
    cameraTiles: vec2<f32>,
) -> f32 {
    return f32(plane) * LOC_PLANE_DEPTH_BIAS +
        locBaseCameraPullTiles(metadata, locCenterTiles, cameraTiles);
}
`;

const PATCHED_LOC_MODEL_INFO_BINDINGS =
    `${LOC_MODEL_INFO_BINDINGS}\n${STATIC_PICK_WGSL}\n${LOC_DEPTH_ORDERING_WGSL}`;

const TERRAIN_PLANE_BIAS_LINE = "viewPos.z += map.plane * 0.001;";
const PATCHED_TERRAIN_PLANE_BIAS_LINE =
    "viewPos.z += map.plane * LOC_PLANE_DEPTH_BIAS;";

const TERRAIN_PICK_SITE = `    output.worldUv = worldPos.xz;
    output.worldPos = worldPos;
    output.plane = map.plane;`;
const PATCHED_TERRAIN_PICK_SITE = `${TERRAIN_PICK_SITE}
    output.pickData = staticPickData(0xffffu, map.mapId, 0u, worldPos.xz, u32(max(map.plane, 0.0)));`;

const LOC_PICK_SITE = `    output.worldUv = worldPos.xz;
    output.worldPos = worldPos;

    let loadAlpha`;
const PATCHED_LOC_PICK_SITE = `    output.worldUv = worldPos.xz;
    output.worldPos = worldPos;
    let interactId = (info.w & 0xffffu) | (((info.z >> 3u) & 0x1u) << 16u);
    let interactType = (info.z >> 4u) & 0x3u;
    output.pickData = staticPickData(interactId, map.mapId, interactType, worldPos.xz, plane);

    let loadAlpha`;

const ROOF_CULL_RETURN_SITE = `        output.worldUv = vec2<f32>(0.0);
        output.worldPos = vec3<f32>(0.0);
        return output;`;
const PATCHED_ROOF_CULL_RETURN_SITE = `        output.worldUv = vec2<f32>(0.0);
        output.worldPos = vec3<f32>(0.0);
        output.pickData = vec4<u32>(0u);
        return output;`;

const LOC_DEPTH_BLOCK = `    var viewPos = scene.viewMatrix * vec4<f32>(worldPos, 1.0);
    viewPos.z += f32(plane) * 0.001;
    if (modelPriority > 0u) {
        viewPos.z += f32(modelPriority) * 0.001;
    }`;

const PATCHED_LOC_DEPTH_BLOCK = `    var viewPos = scene.viewMatrix * vec4<f32>(worldPos, 1.0);
    let placementEncoded = info.w >> 16u;
    if (placementEncoded != 0u) {
        let placementMetadata = placementEncoded - 1u;
        let locCenterTiles =
            tilePos / 128.0 + vec2<f32>(map.mapPos.x * 64.0, map.mapPos.y * 64.0);
        if (!locPlacementPartVisible(placementMetadata, locCenterTiles, scene.cameraPos)) {
            output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
            output.color = vec4<f32>(0.0);
            output.pickData = vec4<u32>(0u);
            return output;
        }
        viewPos.z += locCameraPullTiles(
            placementMetadata,
            plane,
            locCenterTiles,
            scene.cameraPos,
        );
    } else {
        viewPos.z += f32(plane) * LOC_PLANE_DEPTH_BIAS;
        if (modelPriority > 0u) {
            viewPos.z += f32(modelPriority) * 0.001;
        }
    }`;

const LOC_FACE_PRIORITY_BIAS_BLOCK = `    let facePriority = (input.packed.z >> 6u) & 0x7u;
    if (facePriority > 0u) {
        viewPos.z += f32(facePriority) * 0.001;
    }`;

const PATCHED_LOC_FACE_PRIORITY_BIAS_BLOCK = `    // Exact 0..11 face priority is expressed by triangle/index order.
    // Do not perturb depth with the legacy compressed 3-bit approximation.`;

const VIEW_POSITION_LINE =
    "var viewPos = scene.viewMatrix * vec4<f32>(worldPos, 1.0);";
const PATCHED_VIEW_POSITION_LINE =
    "var viewPos = map.worldEntityTransform * (scene.viewMatrix * vec4<f32>(worldPos, 1.0));";

const ALPHA_FRAGMENT_BLOCK = `@fragment
fn fsMainAlpha(input: VertexOutput) -> @location(0) vec4<f32> {
    // Match the WebGL DISCARD_ALPHA program: test the base texture sample
    // before the animated-frame sampling and the rest of the water/fog work.
    let textureColor = sampleTextureAtlas(input.textureId, input.texCoord);
    let alpha = textureColor.a * input.color.a;
    if (
        (input.textureId == 0u && alpha < 0.01) ||
        textureColor.a < input.alphaCutOff
    ) {
        discard;
    }
    return shadeFragment(input);
}`;

const PATCHED_ALPHA_FRAGMENT_BLOCK = `${ALPHA_FRAGMENT_BLOCK}

@fragment
fn fsPick(input: VertexOutput) -> @location(0) vec4<u32> {
    if (input.pickData.w == 0u || input.fogAmount >= 1.0) {
        discard;
    }
    let textureColor = sampleTextureAtlas(input.textureId, input.texCoord);
    let alpha = textureColor.a * input.color.a;
    if (
        (input.textureId == 0u && alpha < 0.01) ||
        textureColor.a < input.alphaCutOff
    ) {
        discard;
    }
    return input.pickData;
}`;

/**
 * Extend the shared static-scene WGSL with renderer-parity behavior that is
 * intentionally kept outside the terrain-foundation source while the port is
 * staged. In addition to world-entity/order parity, the patch exposes a static
 * integer pick payload and fragment entry point without changing the legacy
 * WebGL model-info ABI.
 */
export function patchWebGPUStaticSceneShaderForWorldEntities(code: string): string {
    if (!code.includes(MAP_UNIFORM_STRUCT)) {
        throw new Error("WebGPU static-scene shader MapUniforms contract changed");
    }
    if (!code.includes(LOC_MODEL_INFO_BINDINGS)) {
        throw new Error("WebGPU static-scene shader loc model-info contract changed");
    }
    if (!code.includes(VERTEX_OUTPUT_STRUCT)) {
        throw new Error("WebGPU static-scene shader VertexOutput contract changed");
    }
    if (!code.includes(TERRAIN_PICK_SITE) || !code.includes(LOC_PICK_SITE)) {
        throw new Error("WebGPU static-scene shader pick vertex contract changed");
    }
    if (!code.includes(ROOF_CULL_RETURN_SITE)) {
        throw new Error("WebGPU static-scene shader roof-cull return contract changed");
    }
    if (!code.includes(ALPHA_FRAGMENT_BLOCK)) {
        throw new Error("WebGPU static-scene shader alpha fragment contract changed");
    }

    const viewPositionMatches = code.split(VIEW_POSITION_LINE).length - 1;
    if (viewPositionMatches !== 2) {
        throw new Error(
            `Expected two static-scene view-position sites, found ${viewPositionMatches}`,
        );
    }

    const terrainPlaneBiasMatches = code.split(TERRAIN_PLANE_BIAS_LINE).length - 1;
    if (terrainPlaneBiasMatches !== 1) {
        throw new Error(
            `Expected one terrain plane-bias site, found ${terrainPlaneBiasMatches}`,
        );
    }
    if (!code.includes(LOC_DEPTH_BLOCK)) {
        throw new Error("WebGPU static-scene loc depth-ordering contract changed");
    }
    const facePriorityBiasMatches = code.split(LOC_FACE_PRIORITY_BIAS_BLOCK).length - 1;
    if (facePriorityBiasMatches !== 1) {
        throw new Error(
            `Expected one temporary face-priority bias site, found ${facePriorityBiasMatches}`,
        );
    }

    return code
        .replace(VERTEX_OUTPUT_STRUCT, PATCHED_VERTEX_OUTPUT_STRUCT)
        .replace(LOC_MODEL_INFO_BINDINGS, PATCHED_LOC_MODEL_INFO_BINDINGS)
        .replace(TERRAIN_PICK_SITE, PATCHED_TERRAIN_PICK_SITE)
        .replace(LOC_PICK_SITE, PATCHED_LOC_PICK_SITE)
        .replace(ROOF_CULL_RETURN_SITE, PATCHED_ROOF_CULL_RETURN_SITE)
        .replace(TERRAIN_PLANE_BIAS_LINE, PATCHED_TERRAIN_PLANE_BIAS_LINE)
        .replace(LOC_DEPTH_BLOCK, PATCHED_LOC_DEPTH_BLOCK)
        .replace(LOC_FACE_PRIORITY_BIAS_BLOCK, PATCHED_LOC_FACE_PRIORITY_BIAS_BLOCK)
        .replace(MAP_UNIFORM_STRUCT, PATCHED_MAP_UNIFORM_STRUCT)
        .replace(ALPHA_FRAGMENT_BLOCK, PATCHED_ALPHA_FRAGMENT_BLOCK)
        .split(VIEW_POSITION_LINE)
        .join(PATCHED_VIEW_POSITION_LINE);
}
