import assert from "node:assert/strict";

import { LocModelType } from "../rs/config/loctype/LocModelType";
import {
    LOC_PLACEMENT_NONE,
    LocPlacementClassFlag,
    getLocPlacementClassFlags,
    hasLocPlacementClass,
    packLocPlacementMetadata,
    unpackLocPlacementMetadata,
} from "../render/loc/LocPlacementMetadata";

for (let type = LocModelType.WALL; type <= LocModelType.FLOOR_DECORATION; type++) {
    for (let rotation = 0; rotation < 4; rotation++) {
        for (const secondaryPart of [false, true]) {
            const packed = packLocPlacementMetadata(type, rotation, secondaryPart);
            assert.notEqual(packed, LOC_PLACEMENT_NONE);
            assert.ok(packed >= 0 && packed <= 0xffff);
            assert.deepEqual(unpackLocPlacementMetadata(packed), {
                type,
                rotation,
                secondaryPart,
            });
        }
    }
}

assert.equal(unpackLocPlacementMetadata(LOC_PLACEMENT_NONE), undefined);

const wall = packLocPlacementMetadata(LocModelType.WALL, 2);
assert.equal(getLocPlacementClassFlags(wall), LocPlacementClassFlag.WALL_PIECE);
assert.equal(hasLocPlacementClass(wall, LocPlacementClassFlag.WALL_PIECE), true);
assert.equal(hasLocPlacementClass(wall, LocPlacementClassFlag.WALL_DECORATION), false);

const cornerSecondary = packLocPlacementMetadata(LocModelType.WALL_CORNER, 3, true);
assert.deepEqual(unpackLocPlacementMetadata(cornerSecondary), {
    type: LocModelType.WALL_CORNER,
    rotation: 3,
    secondaryPart: true,
});
assert.equal(
    hasLocPlacementClass(cornerSecondary, LocPlacementClassFlag.WALL_PIECE),
    true,
);

for (let type = LocModelType.WALL_DECORATION_INSIDE; type <= LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE; type++) {
    const metadata = packLocPlacementMetadata(type, 1);
    assert.equal(
        getLocPlacementClassFlags(metadata),
        LocPlacementClassFlag.WALL_DECORATION,
        `wall decoration type ${type}`,
    );
}

for (let type = LocModelType.ROOF_SLOPED; type <= LocModelType.ROOF_SLOPED_OVERHANG_HARD_OUTER_CORNER; type++) {
    const metadata = packLocPlacementMetadata(type, 0);
    assert.equal(
        getLocPlacementClassFlags(metadata),
        LocPlacementClassFlag.ROOF,
        `roof type ${type}`,
    );
}

const floorDecoration = packLocPlacementMetadata(LocModelType.FLOOR_DECORATION, 0);
assert.equal(
    getLocPlacementClassFlags(floorDecoration),
    LocPlacementClassFlag.FLOOR_DECORATION,
);

for (const type of [LocModelType.WALL_DIAGONAL, LocModelType.NORMAL, LocModelType.NORMAL_DIAGIONAL]) {
    const metadata = packLocPlacementMetadata(type, 0);
    assert.equal(
        getLocPlacementClassFlags(metadata),
        LocPlacementClassFlag.NONE,
        `ordinary loc type ${type} must not acquire a cardinal wall/decor rule prematurely`,
    );
}

assert.equal(getLocPlacementClassFlags(LOC_PLACEMENT_NONE), LocPlacementClassFlag.NONE);

console.log("loc placement metadata round-trip and classification checks passed");
