import * as assert from "node:assert/strict";
import { Location } from "../src/main/typescript/elvarg/game/model/Location";
import { Projectile } from "../src/main/typescript/elvarg/game/model/Projectile";

const mobile = (x: number, y: number, size: number): any => ({
    getLocation: () => new Location(x, y, 0),
    getSize: () => size,
});

// 1x1 mobiles (players, small npcs) keep firing from their own tile.
assert.deepEqual(Projectile.centreOf(mobile(3200, 3200, 1)), new Location(3200, 3200, 0));

// KBD is 5x5: its Location is the south-west corner, the body sits two tiles in.
assert.deepEqual(Projectile.centreOf(mobile(3200, 3200, 5)), new Location(3202, 3202, 0));

// Even sizes land on the south-west of the two centre tiles (tile grid has no halves).
assert.deepEqual(Projectile.centreOf(mobile(3200, 3200, 4)), new Location(3201, 3201, 0));

// Nonsense sizes must not drag the origin off the mobile.
assert.deepEqual(Projectile.centreOf(mobile(3200, 3200, 0)), new Location(3200, 3200, 0));

// Projectiles have to cross the gap, not teleport across it: a flat lifetime spent the
// same time on 8 tiles as on 1.
const kbd = mobile(3000, 3000, 5);
const player = mobile(3010, 3002, 1);

// The KBD's centre tile is (3002, 3002), so the flight is measured from its body.
assert.equal(Projectile.arrivalCycles(kbd, player), 40 + 8 * 10);
assert.equal(Projectile.arrivalTicks(kbd, player), 4);

// Closer target, shorter flight - the whole point of the change.
assert.ok(Projectile.arrivalCycles(kbd, mobile(3005, 3002, 1)) < Projectile.arrivalCycles(kbd, player));

// Vet'ion throws at bare tiles, so raw Locations have to work as endpoints too.
assert.equal(Projectile.arrivalCycles(kbd, new Location(3010, 3002, 0)), 120);
assert.equal(Projectile.arrivalCycles(new Location(3002, 3002, 0), new Location(3005, 3002, 0)), 70);

console.info("projectile origin smoke passed");
