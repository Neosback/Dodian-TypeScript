const fs = require("fs");
const path = require("path");
const { MapObjects } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");

function regionBounds(regionId) {
  return {
    absX: (regionId >> 8) * 64,
    absY: (regionId & 0xff) * 64,
  };
}

function regionIdsForBounds(regionManager, minX, maxX, minY, maxY) {
  const startRegionX = minX >> 6;
  const endRegionX = maxX >> 6;
  const startRegionY = minY >> 6;
  const endRegionY = maxY >> 6;
  const ids = [];
  for (let regionX = startRegionX; regionX <= endRegionX; regionX++) {
    for (let regionY = startRegionY; regionY <= endRegionY; regionY++) {
      ids.push(regionManager.regionIdForTile(regionX << 6, regionY << 6));
    }
  }
  return ids;
}

function distanceSquared(aX, aY, bX, bY) {
  const dx = aX - bX;
  const dy = aY - bY;
  return dx * dx + dy * dy;
}

function createTraversalAssist(api, options = {}) {
  const RegionManager = api.getRegionManager();
  const trackedObjectIds = new Set(options.objectIds ?? []);
  const objectsByRegion = new Map();
  let indexInitialized = false;
  let nextInitAttemptAtMs = 0;
  const INIT_RETRY_BACKOFF_MS = 5000;
  const persistentIndexPath =
    options.cachePath ??
    path.join(process.cwd(), "plugins", "bots", "data", "object-index.json");

  function parseNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Math.floor(parsed);
  }

  function ensureRegionMap(regionId) {
    let byId = objectsByRegion.get(regionId);
    if (!byId) {
      byId = new Map();
      objectsByRegion.set(regionId, byId);
    }
    return byId;
  }

  function addIndexedLocation(regionId, objectId, x, y, z) {
    const byId = ensureRegionMap(regionId);
    let locations = byId.get(objectId);
    if (!locations) {
      locations = [];
      byId.set(objectId, locations);
    }
    locations.push({ lx: x, ly: y, z });
  }

  function serializeIndexData() {
    // Store the index as region -> objectId -> [localX,localY,z][], so runtime lookups can
    // scope to nearby regions without any full map scans.
    const regions = {};

    for (const [regionId, byId] of objectsByRegion.entries()) {
      const regionData = {};
      for (const [objectId, locations] of byId.entries()) {
        if (!Array.isArray(locations) || locations.length === 0) {
          continue;
        }
        const key = String(objectId);
        regionData[key] = locations.map((entry) => [entry.lx, entry.ly, entry.z]);
      }
      if (Object.keys(regionData).length > 0) {
        regions[String(regionId)] = regionData;
      }
    }

    return {
      t: Date.now(),
      r: regions,
    };
  }

  function loadIndexData(data) {
    objectsByRegion.clear();
    if (!data || typeof data !== "object") {
      return {
        regionCount: 0,
        objectCount: 0,
      };
    }

    const regions = data.r ?? data.regions;
    if (!regions || typeof regions !== "object") {
      return {
        regionCount: 0,
        objectCount: 0,
      };
    }

    let objectCount = 0;
    for (const [rawRegionId, byId] of Object.entries(regions)) {
      const regionId = parseNumber(rawRegionId);
      if (!Number.isFinite(regionId) || !byId || typeof byId !== "object") {
        continue;
      }
      for (const [rawObjectId, entries] of Object.entries(byId)) {
        const objectId = parseNumber(rawObjectId);
        if (
          !Number.isFinite(objectId) ||
          !trackedObjectIds.has(objectId) ||
          !Array.isArray(entries)
        ) {
          continue;
        }
        for (const entry of entries) {
          if (!Array.isArray(entry) || entry.length < 3) {
            continue;
          }
          const x = parseNumber(entry[0]);
          const y = parseNumber(entry[1]);
          const z = parseNumber(entry[2]);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            continue;
          }
          let localX = x;
          let localY = y;
          if (x > 63 || y > 63) {
            // Backward-compat: old cache used absolute world x/y.
            const { absX, absY } = regionBounds(regionId);
            localX = x - absX;
            localY = y - absY;
          }
          if (localX < 0 || localX > 63 || localY < 0 || localY > 63) {
            continue;
          }
          addIndexedLocation(regionId, objectId, localX, localY, z);
          objectCount++;
        }
      }
    }

    return {
      regionCount: objectsByRegion.size,
      objectCount,
    };
  }

  function loadPersistentIndexFromFile() {
    if (!fs.existsSync(persistentIndexPath)) {
      return null;
    }
    const raw = fs.readFileSync(persistentIndexPath, "utf8");
    const parsed = JSON.parse(raw);
    return loadIndexData(parsed);
  }

  function scanRegion(regionId) {
    const region = RegionManager.getRegionid(regionId);
    if (!region) {
      return 0;
    }
    const { absX, absY } = regionBounds(regionId);
    RegionManager.loadMapFiles(absX, absY);

    const loadedRegion = RegionManager.getRegionid(regionId);
    if (!loadedRegion?.isLoaded?.()) {
      return 0;
    }

    let matches = 0;
    for (let z = 0; z < 4; z++) {
      for (let localX = 0; localX < 64; localX++) {
        for (let localY = 0; localY < 64; localY++) {
          const x = absX + localX;
          const y = absY + localY;
          const hash = MapObjects.getHash(x, y, z);
          const objects = MapObjects.mapObjects.get(hash);
          if (!objects || objects.length === 0) {
            continue;
          }
          for (const object of objects) {
            const objectId = object?.getId?.();
            if (!trackedObjectIds.has(objectId)) {
              continue;
            }
            const loc = object.getLocation?.();
            if (!loc) {
              continue;
            }
            const localXFromLoc = loc.getX() - absX;
            const localYFromLoc = loc.getY() - absY;
            if (
              localXFromLoc < 0 ||
              localXFromLoc > 63 ||
              localYFromLoc < 0 ||
              localYFromLoc > 63
            ) {
              continue;
            }
            addIndexedLocation(
              regionId,
              objectId,
              localXFromLoc,
              localYFromLoc,
              loc.getZ()
            );
            matches++;
          }
        }
      }
    }
    return matches;
  }

  function buildPersistentIndexByScanningMap() {
    objectsByRegion.clear();
    const regionIds = [...RegionManager.regions.keys()].sort((a, b) => a - b);
    let objectCount = 0;
    for (const regionId of regionIds) {
      objectCount += scanRegion(regionId);
    }

    const payload = serializeIndexData();
    fs.mkdirSync(path.dirname(persistentIndexPath), { recursive: true });
    const tempPath = `${persistentIndexPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload));
    fs.renameSync(tempPath, persistentIndexPath);
    return {
      regionCount: objectsByRegion.size,
      objectCount,
    };
  }

  function initializePersistentIndex(options = {}) {
    const forceRescan = options.forceRescan === true;
    const nowMs = Date.now();
    if (indexInitialized && !forceRescan) {
      return true;
    }
    if (!forceRescan && nowMs < nextInitAttemptAtMs) {
      return false;
    }

    if (RegionManager.regions.size === 0) {
      nextInitAttemptAtMs = nowMs + INIT_RETRY_BACKOFF_MS;
      api?.log?.("object_index_init_deferred", {
        reason: "regions_not_initialized",
        retryAfterMs: INIT_RETRY_BACKOFF_MS,
      });
      return false;
    }

    const startedAt = Date.now();

    if (!forceRescan) {
      try {
        // Startup fast-path: use cached object coordinates if the file exists.
        const loaded = loadPersistentIndexFromFile();
        if (loaded) {
          if (trackedObjectIds.size > 0 && loaded.objectCount === 0) {
            api?.log?.("object_index_cache_invalid", {
              path: persistentIndexPath,
              reason: "zero_coordinates",
            });
          } else {
            indexInitialized = true;
            nextInitAttemptAtMs = 0;
            api?.log?.("object_index_loaded", {
              source: "cache",
              path: persistentIndexPath,
              regionCount: loaded.regionCount,
              objectCount: loaded.objectCount,
              trackedObjectIds: trackedObjectIds.size,
              durationMs: Date.now() - startedAt,
            });
            return true;
          }
        }
      } catch (error) {
        api?.log?.("object_index_load_failed", {
          path: persistentIndexPath,
          message: error?.message ?? String(error),
        });
      }
    }

    try {
      const scanned = buildPersistentIndexByScanningMap();
      indexInitialized = true;
      nextInitAttemptAtMs = 0;
      api?.log?.("object_index_built", {
        source: "scan",
        path: persistentIndexPath,
        regionCount: scanned.regionCount,
        objectCount: scanned.objectCount,
        trackedObjectIds: trackedObjectIds.size,
        durationMs: Date.now() - startedAt,
      });
      return true;
    } catch (error) {
      nextInitAttemptAtMs = Date.now() + INIT_RETRY_BACKOFF_MS;
      api?.log?.("object_index_build_failed", {
        path: persistentIndexPath,
        message: error?.message ?? String(error),
        retryAfterMs: INIT_RETRY_BACKOFF_MS,
      });
      return false;
    }
  }

  function ensurePersistentIndex() {
    if (indexInitialized) {
      return true;
    }
    return initializePersistentIndex();
  }

  function schedulePersistentIndexInitialization(delayMs = 0) {
    const normalizedDelay = Number.isFinite(delayMs)
      ? Math.max(0, Math.floor(delayMs))
      : 0;
    setTimeout(() => {
      try {
        initializePersistentIndex();
      } catch (error) {
        api?.log?.("object_index_schedule_init_failed", {
          path: persistentIndexPath,
          message: error?.message ?? String(error),
        });
      }
    }, normalizedDelay);
  }

  function ensureRegionsLoaded(regionIds) {
    for (const regionId of regionIds) {
      const region = RegionManager.getRegionid(regionId);
      if (!region || region.isLoaded()) {
        continue;
      }
      const { absX, absY } = regionBounds(regionId);
      RegionManager.loadMapFiles(absX, absY);
    }
  }

  function resolveWorldObjectAt(objectId, x, y, z, privateArea = null) {
    if (privateArea) {
      const objects = privateArea.getObjects?.() ?? [];
      for (const object of objects) {
        if (object?.getId?.() !== objectId) {
          continue;
        }
        const loc = object.getLocation?.();
        if (!loc) {
          continue;
        }
        if (loc.getX() === x && loc.getY() === y && loc.getZ() === z) {
          return object;
        }
      }
      return null;
    }

    const hash = MapObjects.getHash(x, y, z);
    const bucket = MapObjects.mapObjects.get(hash);
    if (!bucket || bucket.length === 0) {
      return null;
    }
    for (const object of bucket) {
      if (object?.getId?.() !== objectId) {
        continue;
      }
      const loc = object.getLocation?.();
      if (!loc) {
        continue;
      }
      if (loc.getX() === x && loc.getY() === y && loc.getZ() === z) {
        return object;
      }
    }
    return null;
  }

  function trackObjectId(objectId) {
    if (!Number.isFinite(objectId) || objectId < 0 || trackedObjectIds.has(objectId)) {
      return;
    }
    trackedObjectIds.add(objectId);
  }

  function trackObjectIds(objectIds = []) {
    for (const objectId of objectIds) {
      trackObjectId(objectId);
    }
  }

  function findNearestInPrivateArea(
    player,
    privateArea,
    objectId,
    minX,
    maxX,
    minY,
    maxY,
    z
  ) {
    const objects = privateArea?.getObjects?.() ?? [];
    const playerX = player.getLocation().getX();
    const playerY = player.getLocation().getY();
    let closest = null;
    let closestDistance = Number.MAX_SAFE_INTEGER;

    for (const object of objects) {
      if (object?.getId?.() !== objectId) {
        continue;
      }
      const loc = object.getLocation?.();
      if (!loc || loc.getZ() !== z) {
        continue;
      }
      const x = loc.getX();
      const y = loc.getY();
      if (x < minX || x > maxX || y < minY || y > maxY) {
        continue;
      }
      const dist = distanceSquared(playerX, playerY, x, y);
      if (dist < closestDistance) {
        closestDistance = dist;
        closest = object;
      }
    }

    return closest;
  }

  function indexedFindInBounds(player, objectId, minX, maxX, minY, maxY, z) {
    ensurePersistentIndex();

    const playerX = player.getLocation().getX();
    const playerY = player.getLocation().getY();
    let closest = null;
    let closestDistance = Number.MAX_SAFE_INTEGER;
    const regionIds = regionIdsForBounds(RegionManager, minX, maxX, minY, maxY);
    ensureRegionsLoaded(regionIds);
    const privateArea = player.getPrivateArea?.() ?? null;

    for (const regionId of regionIds) {
      const byId = objectsByRegion.get(regionId);
      if (!byId) {
        continue;
      }
      const { absX, absY } = regionBounds(regionId);
      const locations = byId.get(objectId);
      if (!locations || locations.length === 0) {
        continue;
      }
      for (const entry of locations) {
        if (entry.z !== z) {
          continue;
        }
        const x = absX + entry.lx;
        const y = absY + entry.ly;
        if (x < minX || x > maxX || y < minY || y > maxY) {
          continue;
        }
        const object = resolveWorldObjectAt(objectId, x, y, z, privateArea);
        if (!object) {
          continue;
        }
        const dist = distanceSquared(playerX, playerY, x, y);
        if (dist < closestDistance) {
          closestDistance = dist;
          closest = object;
        }
      }
    }

    return closest;
  }

  function findNearestObject(player, objectId, radius = 10) {
    if (!player) {
      return null;
    }
    trackObjectId(objectId);

    const loc = player.getLocation();
    const baseX = loc.getX();
    const baseY = loc.getY();
    const z = loc.getZ();
    const minX = baseX - radius;
    const maxX = baseX + radius;
    const minY = baseY - radius;
    const maxY = baseY + radius;

    const privateArea = player.getPrivateArea();
    if (privateArea) {
      return findNearestInPrivateArea(
        player,
        privateArea,
        objectId,
        minX,
        maxX,
        minY,
        maxY,
        z
      );
    }

    return indexedFindInBounds(player, objectId, minX, maxX, minY, maxY, z);
  }

  function findObjectOnRoute(player, from, to, objectId, margin = 1) {
    if (!player || !from || !to) {
      return null;
    }
    trackObjectId(objectId);

    const z = from.z ?? player.getLocation().getZ();
    const minX = Math.min(from.x, to.x) - margin;
    const maxX = Math.max(from.x, to.x) + margin;
    const minY = Math.min(from.y, to.y) - margin;
    const maxY = Math.max(from.y, to.y) + margin;

    const privateArea = player.getPrivateArea();
    if (privateArea) {
      return findNearestInPrivateArea(
        player,
        privateArea,
        objectId,
        minX,
        maxX,
        minY,
        maxY,
        z
      );
    }

    return indexedFindInBounds(player, objectId, minX, maxX, minY, maxY, z);
  }

  function regionIdsAroundPlayer(player, regionRadius = 1) {
    if (!player) {
      return [];
    }
    const loc = player.getLocation?.();
    if (!loc) {
      return [];
    }
    const radius = Math.max(0, Math.floor(regionRadius));
    const minX = loc.getX() - radius * 64;
    const maxX = loc.getX() + radius * 64;
    const minY = loc.getY() - radius * 64;
    const maxY = loc.getY() + radius * 64;
    return regionIdsForBounds(RegionManager, minX, maxX, minY, maxY);
  }

  function findCandidatesByIds(player, objectIds, options = {}) {
    if (!player || !Array.isArray(objectIds) || objectIds.length === 0) {
      return [];
    }
    const loc = player.getLocation?.();
    if (!loc) {
      return [];
    }

    const privateArea = options.privateArea ?? player.getPrivateArea?.() ?? null;
    const targetZ = Number.isFinite(options.z) ? Math.floor(options.z) : loc.getZ();
    const regionRadius = Number.isFinite(options.regionRadius)
      ? Math.max(0, Math.floor(options.regionRadius))
      : 1;

    const uniqueIds = [...new Set(objectIds.filter((id) => Number.isFinite(id)))];
    if (uniqueIds.length === 0) {
      return [];
    }

    for (const objectId of uniqueIds) {
      trackObjectId(objectId);
    }
    const hasIndex = ensurePersistentIndex();

    if (privateArea) {
      const objects = privateArea.getObjects?.() ?? [];
      const regionX = loc.getX() >> 6;
      const regionY = loc.getY() >> 6;
      const result = [];
      for (const object of objects) {
        const objectId = object?.getId?.();
        if (!uniqueIds.includes(objectId)) {
          continue;
        }
        const objectLoc = object.getLocation?.();
        if (!objectLoc || objectLoc.getZ() !== targetZ) {
          continue;
        }
        const objectRegionX = objectLoc.getX() >> 6;
        const objectRegionY = objectLoc.getY() >> 6;
        if (
          Math.abs(objectRegionX - regionX) > regionRadius ||
          Math.abs(objectRegionY - regionY) > regionRadius
        ) {
          continue;
        }
        result.push(object);
      }
      return result;
    }

    const regionIds = regionIdsAroundPlayer(player, regionRadius);
    ensureRegionsLoaded(regionIds);
    const candidates = [];
    const privateAreaRef = player.getPrivateArea?.() ?? null;

    if (!hasIndex) {
      return [];
    }

    for (const regionId of regionIds) {
      const byId = objectsByRegion.get(regionId);
      if (!byId) {
        continue;
      }
      const { absX, absY } = regionBounds(regionId);
      for (const objectId of uniqueIds) {
        const objects = byId.get(objectId);
        if (!objects || objects.length === 0) {
          continue;
        }
        for (const entry of objects) {
          if (entry.z !== targetZ) {
            continue;
          }
          const object = resolveWorldObjectAt(
            objectId,
            absX + entry.lx,
            absY + entry.ly,
            entry.z,
            privateAreaRef
          );
          if (!object) {
            continue;
          }
          candidates.push(object);
        }
      }
    }

    return candidates;
  }

  return {
    regionIdForTile: RegionManager.regionIdForTile,
    findNearestObject,
    findObjectOnRoute,
    findCandidatesByIds,
    trackObjectId,
    trackObjectIds,
    initializePersistentIndex,
    schedulePersistentIndexInitialization,
  };
}

module.exports = {
  createTraversalAssist,
};
