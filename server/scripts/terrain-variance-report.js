/* eslint-disable no-console */

const REGION_SIZE = 64;
const REGION_PLANES = 4;

function tileNoise(x, y, seed) {
  let n =
    (Math.imul(x | 0, 374761393) +
      Math.imul(y | 0, 668265263) +
      Math.imul(seed | 0, 2147483647)) |
    0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = n ^ (n >>> 16);
  return n & 0xff;
}

function smoothedNoise(x, y, seed) {
  const corners =
    tileNoise(x - 1, y - 1, seed) +
    tileNoise(x + 1, y - 1, seed) +
    tileNoise(x - 1, y + 1, seed) +
    tileNoise(x + 1, y + 1, seed);
  const sides =
    tileNoise(x - 1, y, seed) +
    tileNoise(x + 1, y, seed) +
    tileNoise(x, y - 1, seed) +
    tileNoise(x, y + 1, seed);
  const center = tileNoise(x, y, seed);
  return ((corners >> 4) + (sides >> 3) + (center >> 2)) & 0xff;
}

function legacyNoise(x, y) {
  let n = x + y * 57;
  n = (n << 13) ^ n;
  const nn = Math.imul(n, Math.imul(Math.imul(n, n), 15731) + 789221) + 1376312589;
  const raw = nn & 0x7fffffff;
  return (raw >> 19) & 0xff;
}

function legacySmoothNoise(x, y) {
  const corners =
    legacyNoise(x - 1, y - 1) +
    legacyNoise(x + 1, y - 1) +
    legacyNoise(x - 1, y + 1) +
    legacyNoise(x + 1, y + 1);
  const sides =
    legacyNoise(x - 1, y) +
    legacyNoise(x + 1, y) +
    legacyNoise(x, y - 1) +
    legacyNoise(x, y + 1);
  const center = legacyNoise(x, y);
  return ((corners >> 4) + (sides >> 3) + (center >> 2)) | 0;
}

function cosineInterpolate(a, b, angle, frequencyReciprocal) {
  const theta = (angle * Math.PI) / frequencyReciprocal;
  const cosine = (65536 - ((Math.cos(theta) * 65536) | 0)) >> 1;
  return ((a * (65536 - cosine)) >> 16) + ((b * cosine) >> 16);
}

function legacyInterpolatedNoise(x, y, f) {
  const lx = Math.floor(x / f);
  const rx = x & (f - 1);
  const ly = Math.floor(y / f);
  const ry = y & (f - 1);
  const a = legacySmoothNoise(lx, ly);
  const b = legacySmoothNoise(lx + 1, ly);
  const c = legacySmoothNoise(lx, ly + 1);
  const d = legacySmoothNoise(lx + 1, ly + 1);
  const ab = cosineInterpolate(a, b, rx, f);
  const cd = cosineInterpolate(c, d, rx, f);
  return cosineInterpolate(ab, cd, ry, f);
}

function legacyVertexHeight(worldX, worldY) {
  let mapHeight =
    legacyInterpolatedNoise(worldX + 45365, worldY + 91923, 4) -
    128 +
    ((legacyInterpolatedNoise(worldX + 10294, worldY + 37821, 2) - 128) >> 1) +
    ((legacyInterpolatedNoise(worldX, worldY, 1) - 128) >> 2);
  mapHeight = (mapHeight * 0.3 + 35) | 0;
  if (mapHeight < 10) mapHeight = 10;
  if (mapHeight > 60) mapHeight = 60;
  return mapHeight;
}

function proceduralTerrainHeight(worldX, worldY, plane, seed) {
  const seedShiftX = ((seed >>> 8) & 0x3ff) - 512;
  const seedShiftY = ((seed >>> 18) & 0x3ff) - 512;
  const baseHeight = legacyVertexHeight(worldX + seedShiftX, worldY + seedShiftY);
  const detailNoise = smoothedNoise(worldX, worldY, seed) - 128;
  const detailed = baseHeight + Math.round(detailNoise / 24);
  const planePenalty = plane * 30;
  return Math.max(4, Math.min(120, detailed - planePenalty));
}

function stats(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { min, max, mean: Number(mean.toFixed(2)), stdDev: Number(Math.sqrt(variance).toFixed(2)) };
}

function slopeStats(grid) {
  const deltas = [];
  for (let x = 0; x < REGION_SIZE; x++) {
    for (let y = 0; y < REGION_SIZE; y++) {
      const h = grid[x][y];
      if (x + 1 < REGION_SIZE) deltas.push(Math.abs(h - grid[x + 1][y]));
      if (y + 1 < REGION_SIZE) deltas.push(Math.abs(h - grid[x][y + 1]));
    }
  }
  return stats(deltas);
}

function analyzeRegion(regionX, regionY, seed) {
  const heights = [];
  const grid = Array.from({ length: REGION_SIZE }, () => Array(REGION_SIZE).fill(0));

  for (let x = 0; x < REGION_SIZE; x++) {
    for (let y = 0; y < REGION_SIZE; y++) {
      const worldX = regionX * REGION_SIZE + x;
      const worldY = regionY * REGION_SIZE + y;
      const h = proceduralTerrainHeight(worldX, worldY, 0, seed);
      heights.push(h);
      grid[x][y] = h;
    }
  }

  const ref = [];
  for (let x = 0; x < REGION_SIZE; x++) {
    for (let y = 0; y < REGION_SIZE; y++) {
      const worldX = regionX * REGION_SIZE + x;
      const worldY = regionY * REGION_SIZE + y;
      ref.push(legacyVertexHeight(worldX, worldY));
    }
  }

  return {
    regionX,
    regionY,
    seed,
    procedural: stats(heights),
    proceduralSlope: slopeStats(grid),
    referenceLegacy: stats(ref),
  };
}

function main() {
  const tests = [
    { regionX: 49, regionY: 55, seed: 724182022 },
    { regionX: 50, regionY: 55, seed: 724182022 },
    { regionX: 48, regionY: 54, seed: 724182022 },
    { regionX: 49, regionY: 55, seed: 1337 },
  ];

  for (const t of tests) {
    console.log(JSON.stringify(analyzeRegion(t.regionX, t.regionY, t.seed), null, 2));
  }

  console.log(`Planes configured: ${REGION_PLANES}, size: ${REGION_SIZE}x${REGION_SIZE}`);
}

main();
