"use strict";

const WILDERNESS_ROAMING_BOUNDS = Object.freeze([
  Object.freeze({
    id: "wilderness_surface",
    minX: 2941,
    maxX: 3392,
    minY: 3518,
    maxY: 3966,
    z: 0,
  }),
]);

function listWildernessRoamingBounds() {
  return WILDERNESS_ROAMING_BOUNDS;
}

function getWildernessRoamingBoundsById(id) {
  return WILDERNESS_ROAMING_BOUNDS.find((bounds) => bounds.id === id) ?? null;
}

module.exports = {
  WILDERNESS_ROAMING_BOUNDS,
  getWildernessRoamingBoundsById,
  listWildernessRoamingBounds,
};
