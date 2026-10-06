import { decodeDynamicActorSignedU16 } from "../dynamic/DynamicActorRenderData";

export const PROJECTILE_WEBGL_RECORD_WORDS = 8;
export const PROJECTILE_WEBGL_RECORD_BYTES = PROJECTILE_WEBGL_RECORD_WORDS * 2;

export interface ProjectileRenderTransform {
    localX: number;
    localY: number;
    plane: number;
    yaw: number;
    pitch: number;
    roll: number;
    subOffsetX: number;
    subOffsetY: number;
    /** WebGL's positive u_modelYOffset value. The projectile shader subtracts it. */
    modelYOffset: number;
}

export interface ProjectileRenderInstance {
    projectileId: number;
    debugId: number;
    frameId: number;
    sourceMapId: number;
    transform: ProjectileRenderTransform;
}

export interface DecodedProjectileWebGLRecord {
    localX: number;
    localY: number;
    plane: number;
    yaw: number;
    pitch: number;
    roll: number;
    /** Low 9 bits preserved by the legacy record for diagnostics only. */
    packedProjectileId: number;
}

/**
 * Decode the legacy WebGL projectile record into renderer-neutral transform fields.
 *
 * Pitch and roll intentionally reflect the precision WebGL actually renders:
 * pitch is quantized to 16 OSRS angle units and roll to 256 units. WebGPU comparison
 * must consume these decoded values rather than the higher-precision Projectile state
 * or the two backends would disagree on orientation.
 */
export function decodeProjectileWebGLRecord(
    source: Uint16Array,
    wordOffset: number,
): DecodedProjectileWebGLRecord {
    const offset = wordOffset | 0;
    if (
        offset < 0 ||
        offset + PROJECTILE_WEBGL_RECORD_WORDS > source.length
    ) {
        throw new RangeError(
            `Projectile WebGL record [${offset}, ${offset + PROJECTILE_WEBGL_RECORD_WORDS}) exceeds ${source.length} words`,
        );
    }

    const packedRotation = source[offset + 2] | 0;
    const packedMeta = source[offset + 3] | 0;
    const pitchHi = (packedRotation >> 13) & 0x7;
    const pitchLo = (packedMeta >> 9) & 0xf;
    const pitchPacked = (pitchHi << 4) | pitchLo;
    const rollPacked = (packedMeta >> 13) & 0x7;

    return {
        localX: decodeDynamicActorSignedU16(source[offset + 0] | 0),
        localY: decodeDynamicActorSignedU16(source[offset + 1] | 0),
        plane: packedRotation & 0x3,
        yaw: (packedRotation >> 2) & 0x7ff,
        pitch: (pitchPacked << 4) & 0x7ff,
        roll: (rollPacked << 8) & 0x7ff,
        packedProjectileId: packedMeta & 0x1ff,
    };
}

export function quantizeProjectilePitchForWebGL(pitch: number): number {
    return ((pitch | 0) & 0x7ff) & ~0xf;
}

export function quantizeProjectileRollForWebGL(roll: number): number {
    return ((roll | 0) & 0x7ff) & ~0xff;
}
