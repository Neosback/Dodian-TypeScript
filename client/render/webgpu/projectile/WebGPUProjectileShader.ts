import { WEBGPU_GFX_SHADER } from "../gfx/WebGPUGfxShader";

/**
 * Projectile rendering shares the packed model/material/fragment path with GFX,
 * but owns a distinct vertex transform: quantized roll -> pitch -> yaw rotation,
 * fractional sub-tile placement, terrain grounding, then a CPU-provided vertical
 * offset. WebGL intentionally uses no map load fade and no world-entity transform.
 */
export const WEBGPU_PROJECTILE_SHADER = /* wgsl */ `${WEBGPU_GFX_SHADER}

struct ProjectileVertexInput {
    @location(0) packed: vec3<u32>,
    // localX, localY, plane, yaw
    @location(1) projectileTransform: vec4<f32>,
    // pitch, roll, subOffsetX, subOffsetY
    @location(2) projectileRotation: vec4<f32>,
    // modelYOffset, projectileId, debugId, reserved
    @location(3) projectileMisc: vec4<f32>,
};

@vertex
fn vsProjectile(input: ProjectileVertexInput) -> GfxVertexOutput {
    var output: GfxVertexOutput;
    let rawHsl = i32((input.packed.y >> 15u) & 0xffffu);
    let textureId = decodeTextureId(rawHsl, input.packed.y, input.packed.z);
    let material = getMaterial(textureId);
    let plane = u32(clamp(input.projectileTransform.z, 0.0, 3.0));

    var localPos = decodeVertexPosition(input.packed.x, input.packed.y, input.packed.z);

    // Match projectile.vert.glsl row-vector order exactly:
    // localPos * rotationZ(roll) * rotationX(pitch) * rotationY(yaw).
    let rollAngle = input.projectileRotation.y * RS_TO_RADIANS;
    let rollC = cos(rollAngle);
    let rollS = sin(rollAngle);
    let rollRotated = vec3<f32>(
        localPos.x * rollC - localPos.y * rollS,
        localPos.x * rollS + localPos.y * rollC,
        localPos.z,
    );

    let pitchAngle = input.projectileRotation.x * RS_TO_RADIANS;
    let pitchC = cos(pitchAngle);
    let pitchS = sin(pitchAngle);
    let pitchRotated = vec3<f32>(
        rollRotated.x,
        rollRotated.y * pitchC - rollRotated.z * pitchS,
        rollRotated.y * pitchS + rollRotated.z * pitchC,
    );

    let yawAngle = input.projectileTransform.w * RS_TO_RADIANS;
    let yawC = cos(yawAngle);
    let yawS = sin(yawAngle);
    localPos = vec3<f32>(
        pitchRotated.x * yawC - pitchRotated.z * yawS,
        pitchRotated.y,
        pitchRotated.x * yawS + pitchRotated.z * yawC,
    );

    let tilePos = input.projectileTransform.xy + input.projectileRotation.zw;
    localPos.x += tilePos.x;
    localPos.z += tilePos.y;

    // Match projectile.vert.glsl: ground against the map first, then subtract
    // the CPU-provided ground-relative vertical offset.
    localPos.y -= getGfxHeightInterp(tilePos, plane);
    localPos.y -= input.projectileMisc.x;

    let worldPos = localPos / 128.0 + vec3<f32>(map.mapPos.x * 64.0, 0.0, map.mapPos.y * 64.0);
    var viewPos = scene.viewMatrix * vec4<f32>(worldPos, 1.0);

    // Projectiles use the cache face-priority path, not player equipment depth,
    // and projectile.vert.glsl does not add plane separation.
    let priority = (input.packed.z >> 6u) & 0x7u;
    if (priority > 0u) {
        var layer = f32(priority);
        if (priority == 7u) {
            layer += TOP_PRIORITY_EXTRA_BIAS / PRIORITY_LAYER_EPSILON;
        }
        viewPos.z += layer * PRIORITY_LAYER_EPSILON;
    }

    output.position = scene.projectionMatrix * viewPos;
    output.color = decodeVertexColor(
        rawHsl,
        textureId,
        input.packed.z,
        vec4<f32>(-1.0, -1.0, -1.0, 0.0),
    );
    output.texCoord = animateTexCoord(
        decodeTexCoord(input.packed.x, input.packed.z),
        material,
    );
    output.textureId = textureId;
    output.alphaCutOff = material.alphaCutOff;
    output.fogAmount = fogFactor(worldPos.xz - scene.playerPos);
    return output;
}
`;

if (!WEBGPU_PROJECTILE_SHADER.includes("fn vsProjectile")) {
    throw new Error("Failed to append WebGPU projectile vertex shader");
}
if (WEBGPU_PROJECTILE_SHADER.includes("projectileLoadTime")) {
    throw new Error("WebGPU projectile shader must not apply map load fade");
}
