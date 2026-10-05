import assert from "node:assert/strict";

import {
    LocCardinalEdgeMask,
    OBJECT_GROUND_PULL,
    PLANE_DEPTH_BIAS,
    ROOF_DEPTH_PULL,
    WALL_BEHIND_PUSH,
    WALL_DECORATION_PULL,
    getCardinalEdgeMaskForRotation,
    getLocBaseCameraPullTiles,
    getLocCameraPullTiles,
    getLocCardinalEdgeMask,
    getPlaneDepthPullTiles,
    isCameraOutsideCardinalEdge,
    isLocPlacementPartVisible,
    isPrimaryDiagonalWallDecorationFacingCamera,
} from "../render/loc/LocDepthOrdering";
import { packLocPlacementMetadata } from "../render/loc/LocPlacementMetadata";
import { LocModelType } from "../rs/config/loctype/LocModelType";

assert.equal(OBJECT_GROUND_PULL, 3 / 128);
assert.equal(WALL_DECORATION_PULL, 2 / 128);
assert.equal(WALL_BEHIND_PUSH, 10 / 128);
assert.equal(ROOF_DEPTH_PULL, 8 / 128);
assert.equal(PLANE_DEPTH_BIAS, 2 / 128);

assert.deepEqual(
    [0, 1, 2, 3].map(getCardinalEdgeMaskForRotation),
    [
        LocCardinalEdgeMask.X_NEG,
        LocCardinalEdgeMask.Y_POS,
        LocCardinalEdgeMask.X_POS,
        LocCardinalEdgeMask.Y_NEG,
    ],
);

for (let rotation = 0; rotation < 4; rotation++) {
    const wall = packLocPlacementMetadata(LocModelType.WALL, rotation);
    assert.equal(getLocCardinalEdgeMask(wall), 1 << rotation);

    const cornerPrimary = packLocPlacementMetadata(LocModelType.WALL_CORNER, rotation, false);
    const cornerSecondary = packLocPlacementMetadata(LocModelType.WALL_CORNER, rotation, true);
    assert.equal(getLocCardinalEdgeMask(cornerPrimary), 1 << rotation);
    assert.equal(getLocCardinalEdgeMask(cornerSecondary), 1 << ((rotation + 1) & 3));

    const decorInside = packLocPlacementMetadata(
        LocModelType.WALL_DECORATION_INSIDE,
        rotation,
    );
    const decorOutside = packLocPlacementMetadata(
        LocModelType.WALL_DECORATION_OUTSIDE,
        rotation,
    );
    assert.equal(getLocCardinalEdgeMask(decorInside), 1 << rotation);
    assert.equal(getLocCardinalEdgeMask(decorOutside), 1 << rotation);
}

// The original client uses 16/32/64/128 for boundary types 1/3 and the
// orientation=256 comparison for decoration types 6..8. They must not be
// accidentally treated as cardinal 1/2/4/8 edges.
for (const type of [
    LocModelType.WALL_TRI_CORNER,
    LocModelType.WALL_RECT_CORNER,
    LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE,
    LocModelType.WALL_DECORATION_DIAGONAL_INSIDE,
    LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
]) {
    assert.equal(getLocCardinalEdgeMask(packLocPlacementMetadata(type, 0)), 0);
}

const locTileX = 10;
const locTileY = 20;
assert.equal(
    isCameraOutsideCardinalEdge(LocCardinalEdgeMask.X_NEG, locTileX, locTileY, 9, 20),
    true,
);
assert.equal(
    isCameraOutsideCardinalEdge(LocCardinalEdgeMask.X_NEG, locTileX, locTileY, 10, 20),
    false,
);
assert.equal(
    isCameraOutsideCardinalEdge(LocCardinalEdgeMask.X_POS, locTileX, locTileY, 11, 20),
    true,
);
assert.equal(
    isCameraOutsideCardinalEdge(LocCardinalEdgeMask.Y_NEG, locTileX, locTileY, 10, 19),
    true,
);
assert.equal(
    isCameraOutsideCardinalEdge(LocCardinalEdgeMask.Y_POS, locTileX, locTileY, 10, 21),
    true,
);
assert.equal(
    isCameraOutsideCardinalEdge(
        LocCardinalEdgeMask.X_NEG | LocCardinalEdgeMask.Y_POS,
        locTileX,
        locTileY,
        9,
        21,
    ),
    true,
);

const sameTileContext = {
    locTileX,
    locTileY,
    cameraTileX: locTileX,
    cameraTileY: locTileY,
    locCenterX: locTileX * 128 + 64,
    locCenterY: locTileY * 128 + 64,
    cameraX: locTileX * 128 + 64,
    cameraY: locTileY * 128 + 64,
};

// Cardinal wall: push behind objects only while the camera is not outside the
// wall edge. Rotation 0 is the negative-X edge.
const westWall = packLocPlacementMetadata(LocModelType.WALL, 0);
assert.equal(getLocBaseCameraPullTiles(westWall, sameTileContext), -WALL_BEHIND_PUSH);
assert.equal(
    getLocBaseCameraPullTiles(westWall, {
        ...sameTileContext,
        cameraTileX: locTileX - 1,
        cameraX: (locTileX - 1) * 128 + 64,
    }),
    0,
);

// Cardinal wall decoration flips from in front to behind across the edge.
const westDecoration = packLocPlacementMetadata(LocModelType.WALL_DECORATION_OUTSIDE, 0);
assert.equal(
    getLocBaseCameraPullTiles(westDecoration, sameTileContext),
    WALL_DECORATION_PULL,
);
assert.equal(
    getLocBaseCameraPullTiles(westDecoration, {
        ...sameTileContext,
        cameraTileX: locTileX - 1,
        cameraX: (locTileX - 1) * 128 + 64,
    }),
    -WALL_DECORATION_PULL,
);

// The deob's orientation=256 comparison is based on centre-minus-camera deltas.
// For orientation2=0, primary wins when deltaY < deltaX.
assert.equal(isPrimaryDiagonalWallDecorationFacingCamera(0, 64, 0), true);
assert.equal(isPrimaryDiagonalWallDecorationFacingCamera(0, -64, 0), false);
// Rotation 1 negates X; rotation 2 negates both; rotation 3 negates Y.
assert.equal(isPrimaryDiagonalWallDecorationFacingCamera(1, -64, 0), true);
assert.equal(isPrimaryDiagonalWallDecorationFacingCamera(2, -64, 0), false);
assert.equal(isPrimaryDiagonalWallDecorationFacingCamera(3, 64, 0), true);

const centerX = sameTileContext.locCenterX;
const centerY = sameTileContext.locCenterY;
const cameraWestX = centerX - 128;
const cameraEastX = centerX + 128;

const diagonalOutside = packLocPlacementMetadata(
    LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE,
    0,
);
assert.equal(
    isLocPlacementPartVisible(diagonalOutside, centerX, centerY, cameraWestX, centerY),
    true,
);
assert.equal(
    isLocPlacementPartVisible(diagonalOutside, centerX, centerY, cameraEastX, centerY),
    false,
);

// Type 7 uses orientation2=(source rotation+2)&3, so it faces the opposite side.
const diagonalInside = packLocPlacementMetadata(
    LocModelType.WALL_DECORATION_DIAGONAL_INSIDE,
    0,
);
assert.equal(
    isLocPlacementPartVisible(diagonalInside, centerX, centerY, cameraWestX, centerY),
    false,
);
assert.equal(
    isLocPlacementPartVisible(diagonalInside, centerX, centerY, cameraEastX, centerY),
    true,
);

// Type 8 has two renderables. Exactly one part must win on either camera side.
const diagonalDoublePrimary = packLocPlacementMetadata(
    LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
    0,
    false,
);
const diagonalDoubleSecondary = packLocPlacementMetadata(
    LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
    0,
    true,
);
for (const cameraX of [cameraWestX, cameraEastX]) {
    const primary = isLocPlacementPartVisible(
        diagonalDoublePrimary,
        centerX,
        centerY,
        cameraX,
        centerY,
    );
    const secondary = isLocPlacementPartVisible(
        diagonalDoubleSecondary,
        centerX,
        centerY,
        cameraX,
        centerY,
    );
    assert.notEqual(primary, secondary);
}

assert.equal(
    getLocBaseCameraPullTiles(diagonalOutside, {
        ...sameTileContext,
        cameraX: cameraWestX,
    }),
    WALL_DECORATION_PULL,
);
assert.equal(
    getLocBaseCameraPullTiles(diagonalOutside, {
        ...sameTileContext,
        cameraX: cameraEastX,
    }),
    0,
    "a diagonal decoration part hidden by the software painter must not receive a depth pull",
);

// Ground/game-object shapes receive the guide's terrain pull; diagonal boundary
// types 1/3 remain on their dedicated delayed-wall path instead of guessing.
for (const type of [
    LocModelType.WALL_DIAGONAL,
    LocModelType.NORMAL,
    LocModelType.NORMAL_DIAGIONAL,
    LocModelType.FLOOR_DECORATION,
]) {
    assert.equal(
        getLocBaseCameraPullTiles(packLocPlacementMetadata(type, 0), sameTileContext),
        OBJECT_GROUND_PULL,
        `ground/game-object type ${type}`,
    );
}
assert.equal(
    getLocBaseCameraPullTiles(
        packLocPlacementMetadata(LocModelType.WALL_TRI_CORNER, 0),
        sameTileContext,
    ),
    0,
);
assert.equal(
    getLocBaseCameraPullTiles(
        packLocPlacementMetadata(LocModelType.WALL_RECT_CORNER, 0),
        sameTileContext,
    ),
    0,
);

const roof = packLocPlacementMetadata(LocModelType.ROOF_SLOPED, 0);
assert.equal(getLocBaseCameraPullTiles(roof, sameTileContext), ROOF_DEPTH_PULL);
assert.equal(getPlaneDepthPullTiles(0), 0);
assert.equal(getPlaneDepthPullTiles(1), PLANE_DEPTH_BIAS);
assert.equal(getPlaneDepthPullTiles(3), 3 * PLANE_DEPTH_BIAS);
assert.equal(getPlaneDepthPullTiles(-1), 0);
assert.equal(
    getLocCameraPullTiles(roof, { ...sameTileContext, plane: 2 }),
    ROOF_DEPTH_PULL + 2 * PLANE_DEPTH_BIAS,
);

console.log("loc wall/decor depth-ordering semantic checks passed");
