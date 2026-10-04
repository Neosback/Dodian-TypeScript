export const WORLD_MAP_GROUP_ID = 595;
export const WORLD_MAP_TARGET_UID = (161 << 16) | 18;
export const WORLD_MAP_CLOSE_WIDGET_ID = (WORLD_MAP_GROUP_ID << 16) | 38;
export const WORLD_MAP_ORB_WIDGET_IDS = [
  (160 << 16) | 55,
  (895 << 16) | 53,
];

export function packWorldMapCoord(x: number, y: number, level: number): number {
  const safeLevel = Math.max(0, Math.min(3, level | 0));
  return (safeLevel << 28) | ((x & 0x3fff) << 14) | (y & 0x3fff);
}
