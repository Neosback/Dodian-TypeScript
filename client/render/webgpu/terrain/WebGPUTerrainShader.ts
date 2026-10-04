export const WEBGPU_TERRAIN_SHADER = /* wgsl */ `
const TEXTURE_SIZE: u32 = 128u;
const TEXTURE_ANIM_UNIT: f32 = 1.0 / 128.0;

struct SceneUniforms {
    viewProjMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    projectionMatrix: mat4x4<f32>,
    skyColor: vec4<f32>,
    sceneHslOverride: vec4<f32>,
    cameraPos: vec2<f32>,
    playerPos: vec2<f32>,
    renderDistance: f32,
    fogDepth: f32,
    currentTime: f32,
    brightness: f32,
    colorBanding: f32,
    isNewTextureAnim: f32,
    roofPlaneLimit: f32,
    maxLevel: f32,
    cullBackFace: f32,
    scenePreview: f32,
    _padding: vec2<f32>,
};

struct MapUniforms {
    mapPos: vec2<f32>,
    plane: f32,
    loadTime: f32,
};

struct Material {
    animU: i32,
    animV: i32,
    alphaCutOff: f32,
    frameCount: i32,
    animSpeed: i32,
    flags: i32,
};

@group(0) @binding(0) var<uniform> scene: SceneUniforms;
@group(1) @binding(0) var<uniform> map: MapUniforms;
@group(2) @binding(0) var terrainTextures: texture_2d<f32>;
@group(2) @binding(1) var terrainMaterials: texture_2d<i32>;

struct VertexInput {
    @location(0) packed: vec3<u32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) fogAmount: f32,
    @location(2) texCoord: vec2<f32>,
    @location(3) @interpolate(flat) textureId: u32,
    @location(4) @interpolate(flat) alphaCutOff: f32,
};

fn applyHslOverride(inputHsl: i32, value: vec4<f32>) -> i32 {
    if (value.w <= 0.0) {
        return inputHsl;
    }

    var hue = (inputHsl >> 10) & 63;
    var sat = (inputHsl >> 7) & 7;
    var lum = inputHsl & 127;
    let amount = i32(value.w);

    if (value.x >= 0.0) {
        hue += (amount * (i32(value.x) - hue)) >> 7;
    }
    if (value.y >= 0.0) {
        sat += (amount * (i32(value.y) - sat)) >> 7;
    }
    if (value.z >= 0.0) {
        lum += (amount * (i32(value.z) - lum)) >> 7;
    }

    return (hue << 10) | (sat << 7) | lum;
}

fn hslToRgb(inputHsl: i32, brightness: f32) -> vec3<f32> {
    let oneThird = 1.0 / 3.0;
    let twoThird = 2.0 / 3.0;
    let six = 6.0;

    let hue = f32(inputHsl >> 10) / 64.0 + 0.0078125;
    let sat = f32((inputHsl >> 7) & 7) / 8.0 + 0.0625;
    let lum = f32(inputHsl & 127) / 128.0;

    var xt = vec3<f32>(
        six * (hue - twoThird),
        0.0,
        six * (1.0 - hue),
    );

    if (hue < twoThird) {
        xt = vec3<f32>(
            0.0,
            six * (twoThird - hue),
            six * (hue - oneThird),
        );
    }
    if (hue < oneThird) {
        xt = vec3<f32>(
            six * (oneThird - hue),
            six * hue,
            0.0,
        );
    }

    xt = min(xt, vec3<f32>(1.0));
    let sat2 = 2.0 * sat;
    let satInv = 1.0 - sat;
    let lumInv = 1.0 - lum;
    let lum2m1 = 2.0 * lum - 1.0;
    let ct = sat2 * xt + vec3<f32>(satInv);
    let rgb = select(lum * ct, lumInv * ct + vec3<f32>(lum2m1), lum >= 0.5);

    return pow(max(rgb, vec3<f32>(0.0)), vec3<f32>(brightness));
}

fn unpackFloat11(value: u32) -> f32 {
    return 16.0 - f32(value) / 64.0;
}

fn getMaterial(textureId: u32) -> Material {
    let row0 = textureLoad(terrainMaterials, vec2<i32>(i32(textureId), 0), 0);
    let row1 = textureLoad(terrainMaterials, vec2<i32>(i32(textureId), 1), 0);

    var material: Material;
    material.animU = row0.r;
    material.animV = row0.g;
    material.alphaCutOff = f32(row0.b & 0xff) / 255.0;
    material.frameCount = max(row0.a & 0xff, 1);
    material.animSpeed = max(row1.r & 0xff, 1);
    material.flags = row1.g & 0xff;
    return material;
}

fn decodeTextureId(rawHsl: i32, v1: u32, v2: u32) -> u32 {
    let isTextured = ((v1 >> 31u) & 1u) != 0u;
    if (!isTextured) {
        return 0u;
    }
    return u32(rawHsl >> 7) | (((v2 >> 5u) & 1u) << 9u);
}

fn decodeTexCoord(v0: u32, v2: u32) -> vec2<f32> {
    let packedU = ((v0 >> 11u) & 0x3fu) | ((v2 & 0x1fu) << 6u);
    let packedV = v0 & 0x7ffu;
    return vec2<f32>(unpackFloat11(packedU), unpackFloat11(packedV));
}

fn decodeVertexColor(rawHsl: i32, textureId: u32, v2: u32) -> vec4<f32> {
    var hsl = applyHslOverride(rawHsl, scene.sceneHslOverride);
    let alpha = f32((v2 >> 9u) & 0xffu) / 255.0;

    if (textureId != 0u) {
        let light = f32(hsl & 0x7f) / 127.0;
        return vec4<f32>(vec3<f32>(light), alpha);
    }

    return vec4<f32>(hslToRgb(hsl, scene.brightness), alpha);
}

fn decodeVertexPosition(v0: u32, v1: u32, v2: u32) -> vec3<f32> {
    let x = f32(i32((v0 >> 17u) & 0x7fffu) - 0x4000);
    let y = -f32(i32(v1 & 0x7fffu) - 0x4000);
    let z = f32(i32((v2 >> 17u) & 0x7fffu) - 0x4000);
    return vec3<f32>(x, y, z);
}

fn wrap01(value: vec2<f32>) -> vec2<f32> {
    return value - floor(value);
}

fn animateTexCoord(
    texCoord: vec2<f32>,
    material: Material,
) -> vec2<f32> {
    let animation = vec2<f32>(f32(material.animU), f32(material.animV));
    if (scene.isNewTextureAnim > 0.5) {
        let time128 = scene.currentTime - floor(scene.currentTime / 128.0) * 128.0;
        return texCoord + wrap01(time128 * animation / 64.0);
    }
    return texCoord + (scene.currentTime / 0.02) * animation * TEXTURE_ANIM_UNIT;
}

fn sampleTextureAtlas(textureId: u32, texCoord: vec2<f32>) -> vec4<f32> {
    if (textureId == 0u) {
        return vec4<f32>(1.0);
    }

    let dimensions = textureDimensions(terrainTextures);
    let columns = max(u32(dimensions.x) / TEXTURE_SIZE, 1u);
    let cellX = textureId % columns;
    let cellY = textureId / columns;
    let wrapped = wrap01(texCoord);
    let localX = min(u32(floor(wrapped.x * f32(TEXTURE_SIZE))), TEXTURE_SIZE - 1u);
    let localY = min(u32(floor(wrapped.y * f32(TEXTURE_SIZE))), TEXTURE_SIZE - 1u);
    let pixel = vec2<i32>(
        i32(cellX * TEXTURE_SIZE + localX),
        i32(cellY * TEXTURE_SIZE + localY),
    );

    // Cache ARGB pixels are uploaded as their little-endian byte representation,
    // matching the WebGL2 RGBA upload. Swizzle BGRA exactly like main.frag.glsl.
    return textureLoad(terrainTextures, pixel, 0).bgra;
}

fn roundedSquareDistance(p: vec2<f32>, bounds: vec2<f32>) -> f32 {
    let q = abs(p) - bounds;
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0)));
}

fn fogFactor(playerOffset: vec2<f32>) -> f32 {
    let fogStart = min(scene.fogDepth, scene.renderDistance);
    let fogEnd = max(scene.renderDistance, fogStart + 0.0001);
    let d = roundedSquareDistance(playerOffset, vec2<f32>(fogEnd));
    return clamp(d / (fogEnd - fogStart) + 1.0, 0.0, 1.0);
}

@vertex
fn vsMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let rawHsl = i32((input.packed.y >> 15u) & 0xffffu);
    let textureId = decodeTextureId(rawHsl, input.packed.y, input.packed.z);
    let material = getMaterial(textureId);

    let localRune = decodeVertexPosition(input.packed.x, input.packed.y, input.packed.z);
    let localTiles = localRune / 128.0;
    let worldPos = localTiles + vec3<f32>(map.mapPos.x * 64.0, 0.0, map.mapPos.y * 64.0);

    var viewPos = scene.viewMatrix * vec4<f32>(worldPos, 1.0);
    viewPos.z += map.plane * 0.001;

    let priority = (input.packed.z >> 6u) & 0x7u;
    if (priority > 0u) {
        viewPos.z += f32(priority) * 0.001;
    }

    output.position = scene.projectionMatrix * viewPos;
    output.color = decodeVertexColor(rawHsl, textureId, input.packed.z);
    output.texCoord = animateTexCoord(decodeTexCoord(input.packed.x, input.packed.z), material);
    output.textureId = textureId;
    output.alphaCutOff = material.alphaCutOff;

    let loadAlpha = smoothstep(0.0, 1.0, min(scene.currentTime - map.loadTime, 1.0));
    let baseFog = fogFactor(worldPos.xz - scene.playerPos);
    output.fogAmount = select(max(1.0 - loadAlpha, baseFog), baseFog, loadAlpha >= 1.0);
    return output;
}

@fragment
fn fsMain(input: VertexOutput) -> @location(0) vec4<f32> {
    let material = getMaterial(input.textureId);
    var textureColor = sampleTextureAtlas(input.textureId, input.texCoord);

    if (input.textureId != 0u && material.frameCount > 1) {
        let frameCount = f32(material.frameCount);
        let frameT = scene.currentTime * f32(material.animSpeed);
        let frame0 = floor(frameT - floor(frameT / frameCount) * frameCount);
        let frame1 = f32((i32(frame0) + 1) % material.frameCount);
        let mixAmount = fract(frameT);
        let tex0 = sampleTextureAtlas(input.textureId + u32(frame0), input.texCoord);
        let tex1 = sampleTextureAtlas(input.textureId + u32(frame1), input.texCoord);
        textureColor = mix(tex0, tex1, mixAmount);
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
