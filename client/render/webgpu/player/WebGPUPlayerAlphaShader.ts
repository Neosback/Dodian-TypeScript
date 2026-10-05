import { WEBGPU_PLAYER_OPAQUE_SHADER } from "./WebGPUPlayerOpaqueShader";

/**
 * Extends the opaque player module with the WebGL DISCARD_ALPHA-compatible
 * transparent fragment entry point. Keeping the shared vertex path guarantees
 * opaque and alpha players use the same placement, HSL, height, priority, fog,
 * texture-animation, and world-entity transform math.
 */
export const WEBGPU_PLAYER_ALPHA_SHADER = /* wgsl */ `${WEBGPU_PLAYER_OPAQUE_SHADER}

@fragment
fn fsPlayerAlpha(input: PlayerVertexOutput) -> @location(0) vec4<f32> {
    let material = getMaterial(input.textureId);

    // Match player.frag.glsl with DISCARD_ALPHA: test the unanimated/base
    // texture sample before animated-frame sampling and the remaining shading.
    var textureColor = sampleTextureAtlas(input.textureId, input.texCoord);
    let baseAlpha = textureColor.a * input.color.a;
    if (
        (input.textureId == 0u && baseAlpha < 0.01) ||
        textureColor.a < input.alphaCutOff
    ) {
        discard;
    }

    if (input.textureId != 0u && material.frameCount > 1) {
        let frameCount = f32(material.frameCount);
        let frameT = scene.currentTime * f32(material.animSpeed);
        let frame0 = floor(frameT - floor(frameT / frameCount) * frameCount);
        let frame1 = f32((i32(frame0) + 1) % material.frameCount);
        let mixAmount = fract(frameT);
        textureColor = mix(
            sampleTextureAtlas(input.textureId + u32(frame0), input.texCoord),
            sampleTextureAtlas(input.textureId + u32(frame1), input.texCoord),
            mixAmount,
        );
    }

    let banding = max(scene.colorBanding, 1.0);
    let palette = round(input.color.rgb * banding) / banding;
    let surface = textureColor.rgb * palette * scene.brightness;
    let fog = smoothstep(0.0, 1.0, clamp(input.fogAmount, 0.0, 1.0));
    let finalRgb = mix(surface, scene.skyColor.rgb, fog);
    let alpha = textureColor.a * input.color.a;
    return vec4<f32>(clamp(finalRgb, vec3<f32>(0.0), vec3<f32>(1.0)), alpha);
}
`;
