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
    _padding0: f32,
    _padding1: vec2<f32>,
    worldEntityTransform: mat4x4<f32>,
};`;

const LOC_MODEL_INFO_BINDINGS = `@group(4) @binding(0) var locHeightMap: texture_2d_array<i32>;
@group(4) @binding(1) var<storage, read> locModelInfos: LocModelInfoBuffer;`;

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
            // Types 1/3 use the software client's separate diagonal
            // 16/32/64/128 delayed-wall ordering. Do not fake a cardinal edge.
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

const PATCHED_LOC_MODEL_INFO_BINDINGS = `${LOC_MODEL_INFO_BINDINGS}\n${LOC_DEPTH_ORDERING_WGSL}`;

const TERRAIN_PLANE_BIAS_LINE = "viewPos.z += map.plane * 0.001;";
const PATCHED_TERRAIN_PLANE_BIAS_LINE =
    "viewPos.z += map.plane * LOC_PLANE_DEPTH_BIAS;";

const LOC_DEPTH_BLOCK = `    var viewPos = scene.viewMatrix * vec4<f32>(worldPos, 1.0);
    viewPos.z += f32(plane) * 0.001;
    if (modelPriority > 0u) {
        viewPos.z += f32(modelPriority) * 0.001;
    }
    let facePriority = (input.packed.z >> 6u) & 0x7u;`;

const PATCHED_LOC_DEPTH_BLOCK = `    var viewPos = scene.viewMatrix * vec4<f32>(worldPos, 1.0);
    let placementEncoded = info.w >> 16u;
    if (placementEncoded != 0u) {
        let placementMetadata = placementEncoded - 1u;
        let locCenterTiles =
            tilePos / 128.0 + vec2<f32>(map.mapPos.x * 64.0, map.mapPos.y * 64.0);
        if (!locPlacementPartVisible(placementMetadata, locCenterTiles, scene.cameraPos)) {
            output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
            output.color = vec4<f32>(0.0);
            return output;
        }
        viewPos.z += locCameraPullTiles(
            placementMetadata,
            plane,
            locCenterTiles,
            scene.cameraPos,
        );
    } else {
        // Legacy packets and non-loc geometry do not carry placement metadata.
        // Keep their temporary model-priority bias until the face-priority pass.
        viewPos.z += f32(plane) * LOC_PLANE_DEPTH_BIAS;
        if (modelPriority > 0u) {
            viewPos.z += f32(modelPriority) * 0.001;
        }
    }
    let facePriority = (input.packed.z >> 6u) & 0x7u;`;

const VIEW_POSITION_LINE =
    "var viewPos = scene.viewMatrix * vec4<f32>(worldPos, 1.0);";
const PATCHED_VIEW_POSITION_LINE =
    "var viewPos = map.worldEntityTransform * (scene.viewMatrix * vec4<f32>(worldPos, 1.0));";

/**
 * Extend the shared static-scene WGSL with renderer-parity behavior that is
 * intentionally kept outside the terrain-foundation source while the port is
 * staged:
 *
 * - per-map world-entity transforms in the same view->transform->projection
 *   order used by WebGL2;
 * - exact placement metadata decoding for wall/decor/roof/ground ordering;
 * - camera-relative cardinal wall and wall-decoration depth rules;
 * - the software client's orientation=256 selection for decoration types 6..8;
 * - the documented 2/128 per-plane depth separation for terrain and locs.
 *
 * The temporary 3-bit face-priority bias remains until the dedicated full
 * 0..11 face-priority sorting checkpoint.
 */
export function patchWebGPUStaticSceneShaderForWorldEntities(code: string): string {
    if (!code.includes(MAP_UNIFORM_STRUCT)) {
        throw new Error("WebGPU static-scene shader MapUniforms contract changed");
    }
    if (!code.includes(LOC_MODEL_INFO_BINDINGS)) {
        throw new Error("WebGPU static-scene shader loc model-info contract changed");
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

    return code
        .replace(LOC_MODEL_INFO_BINDINGS, PATCHED_LOC_MODEL_INFO_BINDINGS)
        .replace(TERRAIN_PLANE_BIAS_LINE, PATCHED_TERRAIN_PLANE_BIAS_LINE)
        .replace(LOC_DEPTH_BLOCK, PATCHED_LOC_DEPTH_BLOCK)
        .replace(MAP_UNIFORM_STRUCT, PATCHED_MAP_UNIFORM_STRUCT)
        .split(VIEW_POSITION_LINE)
        .join(PATCHED_VIEW_POSITION_LINE);
}
