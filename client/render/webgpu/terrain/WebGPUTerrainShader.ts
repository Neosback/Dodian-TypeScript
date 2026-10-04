export const WEBGPU_TERRAIN_SHADER = /* wgsl */ `
const TEXTURE_SIZE: u32 = 128u;
const TEXTURE_ANIM_UNIT: f32 = 1.0 / 128.0;
const MATERIAL_FLAG_WATER: i32 = 1;
const WATER_FLAG_HAS_FOAM: i32 = 1;
const WATER_FLAG_NORMAL_MAP_2: i32 = 2;
const WATER_NORMAL_1: i32 = 0;
const WATER_NORMAL_2: i32 = 1;
const WATER_FLOW: i32 = 2;
const WATER_FOAM: i32 = 3;
const WATER_CAUSTICS: i32 = 4;
const WATER_MAX_DEPTH: f32 = 759.0;

const WATER_LIGHT_DIR = vec3<f32>(-0.5044, -0.7880, -0.3531);
const WATER_AMBIENT_COLOR = vec3<f32>(0.5922, 0.7294, 1.0);
const WATER_COLOR_LIGHT = vec3<f32>(0.6562, 0.7598, 0.9063);
const WATER_COLOR_MID = vec3<f32>(0.5046, 0.5861, 0.7014);
const WATER_COLOR_DARK = vec3<f32>(0.1690, 0.2017, 0.2478);

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
    borderSize: f32,
    _padding: vec3<f32>,
};

struct Material {
    animU: i32,
    animV: i32,
    alphaCutOff: f32,
    frameCount: i32,
    animSpeed: i32,
    flags: i32,
    waterSurfaceColor: vec3<f32>,
    waterFoamColor: vec3<f32>,
    waterDepthColor: vec3<f32>,
    waterBaseOpacity: f32,
    waterFresnelAmount: f32,
    waterNormalStrength: f32,
    waterSpecularStrength: f32,
    waterSpecularGloss: f32,
    waterDuration: f32,
    waterHasFoam: f32,
    waterUseNormalMap2: bool,
};

struct WaterMaskSample {
    water: f32,
    shore: f32,
    depth: f32,
    bedColor: vec3<f32>,
};

@group(0) @binding(0) var<uniform> scene: SceneUniforms;
@group(1) @binding(0) var<uniform> map: MapUniforms;
@group(1) @binding(1) var waterMaskTexture: texture_2d_array<f32>;
@group(2) @binding(0) var terrainTextures: texture_2d<f32>;
@group(2) @binding(1) var terrainMaterials: texture_2d<i32>;
@group(3) @binding(0) var waterSampler: sampler;
@group(3) @binding(1) var waterTextures: texture_2d_array<f32>;

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
    @location(5) worldUv: vec2<f32>,
    @location(6) worldPos: vec3<f32>,
    @location(7) @interpolate(flat) plane: f32,
};

fn applyHslOverride(inputHsl: i32, value: vec4<f32>) -> i32 {
    if (value.w <= 0.0) {
        return inputHsl;
    }
    var hue = (inputHsl >> 10) & 63;
    var sat = (inputHsl >> 7) & 7;
    var lum = inputHsl & 127;
    let amount = i32(value.w);
    if (value.x >= 0.0) { hue += (amount * (i32(value.x) - hue)) >> 7; }
    if (value.y >= 0.0) { sat += (amount * (i32(value.y) - sat)) >> 7; }
    if (value.z >= 0.0) { lum += (amount * (i32(value.z) - lum)) >> 7; }
    return (hue << 10) | (sat << 7) | lum;
}

fn hslToRgb(inputHsl: i32, brightness: f32) -> vec3<f32> {
    let oneThird = 1.0 / 3.0;
    let twoThird = 2.0 / 3.0;
    let six = 6.0;
    let hue = f32(inputHsl >> 10) / 64.0 + 0.0078125;
    let sat = f32((inputHsl >> 7) & 7) / 8.0 + 0.0625;
    let lum = f32(inputHsl & 127) / 128.0;
    var xt = vec3<f32>(six * (hue - twoThird), 0.0, six * (1.0 - hue));
    if (hue < twoThird) {
        xt = vec3<f32>(0.0, six * (twoThird - hue), six * (hue - oneThird));
    }
    if (hue < oneThird) {
        xt = vec3<f32>(six * (oneThird - hue), six * hue, 0.0);
    }
    xt = min(xt, vec3<f32>(1.0));
    let ct = 2.0 * sat * xt + vec3<f32>(1.0 - sat);
    let rgb = select(
        lum * ct,
        (1.0 - lum) * ct + vec3<f32>(2.0 * lum - 1.0),
        lum >= 0.5,
    );
    return pow(max(rgb, vec3<f32>(0.0)), vec3<f32>(brightness));
}

fn unpackFloat11(value: u32) -> f32 {
    return 16.0 - f32(value) / 64.0;
}

fn getMaterial(textureId: u32) -> Material {
    let d0 = textureLoad(terrainMaterials, vec2<i32>(i32(textureId), 0), 0);
    let d1 = textureLoad(terrainMaterials, vec2<i32>(i32(textureId), 1), 0);
    let d2 = textureLoad(terrainMaterials, vec2<i32>(i32(textureId), 2), 0);
    let d3 = textureLoad(terrainMaterials, vec2<i32>(i32(textureId), 3), 0);
    let d4 = textureLoad(terrainMaterials, vec2<i32>(i32(textureId), 4), 0);
    let d5 = textureLoad(terrainMaterials, vec2<i32>(i32(textureId), 5), 0);

    var material: Material;
    material.animU = d0.r;
    material.animV = d0.g;
    material.alphaCutOff = f32(d0.b & 0xff) / 255.0;
    material.frameCount = max(d0.a & 0xff, 1);
    material.animSpeed = max(d1.r & 0xff, 1);
    material.flags = d1.g & 0xff;
    let waterFlags = d1.b & 0xff;
    material.waterHasFoam = f32(waterFlags & WATER_FLAG_HAS_FOAM);
    material.waterUseNormalMap2 = (waterFlags & WATER_FLAG_NORMAL_MAP_2) != 0;
    material.waterSurfaceColor = vec3<f32>(
        f32(d2.r & 0xff), f32(d2.g & 0xff), f32(d2.b & 0xff),
    ) / 255.0;
    material.waterBaseOpacity = f32(d2.a & 0xff) / 255.0;
    material.waterDepthColor = vec3<f32>(
        f32(d3.r & 0xff), f32(d3.g & 0xff), f32(d3.b & 0xff),
    ) / 255.0;
    material.waterFresnelAmount = f32(d3.a & 0xff) / 255.0;
    material.waterNormalStrength = f32(d4.r & 0xff) / 255.0 * 0.5;
    material.waterSpecularStrength = f32(d4.g & 0xff) / 255.0;
    material.waterSpecularGloss = max(f32(d4.b & 0xff) / 255.0 * 500.0, 1.0);
    material.waterDuration = f32(d4.a & 0xff) / 255.0 * 4.0;
    material.waterFoamColor = vec3<f32>(
        f32(d5.r & 0xff), f32(d5.g & 0xff), f32(d5.b & 0xff),
    ) / 255.0;
    return material;
}

fn decodeTextureId(rawHsl: i32, v1: u32, v2: u32) -> u32 {
    if (((v1 >> 31u) & 1u) == 0u) {
        return 0u;
    }
    return u32(rawHsl >> 7) | (((v2 >> 5u) & 1u) << 9u);
}

fn decodeTexCoord(v0: u32, v2: u32) -> vec2<f32> {
    let packedU = ((v0 >> 11u) & 0x3fu) | ((v2 & 0x1fu) << 6u);
    return vec2<f32>(unpackFloat11(packedU), unpackFloat11(v0 & 0x7ffu));
}

fn decodeVertexColor(rawHsl: i32, textureId: u32, v2: u32) -> vec4<f32> {
    var hsl = applyHslOverride(rawHsl, scene.sceneHslOverride);
    let alpha = f32((v2 >> 9u) & 0xffu) / 255.0;
    if (textureId != 0u) {
        return vec4<f32>(vec3<f32>(f32(hsl & 0x7f) / 127.0), alpha);
    }
    return vec4<f32>(hslToRgb(hsl, scene.brightness), alpha);
}

fn decodeVertexPosition(v0: u32, v1: u32, v2: u32) -> vec3<f32> {
    return vec3<f32>(
        f32(i32((v0 >> 17u) & 0x7fffu) - 0x4000),
        -f32(i32(v1 & 0x7fffu) - 0x4000),
        f32(i32((v2 >> 17u) & 0x7fffu) - 0x4000),
    );
}

fn wrap01(value: vec2<f32>) -> vec2<f32> {
    return value - floor(value);
}

fn animateTexCoord(texCoord: vec2<f32>, material: Material) -> vec2<f32> {
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

fn readWaterMaskTexel(texel: vec2<i32>, layer: i32) -> vec4<f32> {
    let size = textureDimensions(waterMaskTexture);
    let clamped = clamp(texel, vec2<i32>(0), vec2<i32>(size) - vec2<i32>(1));
    return textureLoad(waterMaskTexture, clamped, layer, 0);
}

fn waterMaskWaterBit(texel: vec4<f32>) -> f32 {
    return select(0.0, 1.0, texel.a >= 0.5);
}

fn waterMaskDepth(texel: vec4<f32>) -> f32 {
    return max(texel.a * 255.0 - 128.0, 0.0) / 127.0;
}

fn sampleWaterMask(worldUv: vec2<f32>, plane: f32) -> WaterMaskSample {
    let layers = i32(textureNumLayers(waterMaskTexture));
    let layer = clamp(i32(floor(plane + 0.5)), 0, max(layers - 1, 0));
    let maskPos = worldUv - map.mapPos * 64.0 + vec2<f32>(map.borderSize);
    let texel = vec2<i32>(floor(maskPos));
    let tileFract = fract(maskPos);
    let centerWater = waterMaskWaterBit(readWaterMaskTexel(texel, layer));

    let leftWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(-1, 0), layer));
    let rightWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(1, 0), layer));
    let downWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(0, -1), layer));
    let upWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(0, 1), layer));
    let downLeftWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(-1, -1), layer));
    let downRightWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(1, -1), layer));
    let upLeftWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(-1, 1), layer));
    let upRightWater = waterMaskWaterBit(readWaterMaskTexel(texel + vec2<i32>(1, 1), layer));

    var shoreFromLand = 0.0;
    shoreFromLand = max(shoreFromLand, (1.0 - leftWater) * (1.0 - tileFract.x));
    shoreFromLand = max(shoreFromLand, (1.0 - rightWater) * tileFract.x);
    shoreFromLand = max(shoreFromLand, (1.0 - downWater) * (1.0 - tileFract.y));
    shoreFromLand = max(shoreFromLand, (1.0 - upWater) * tileFract.y);
    shoreFromLand = max(shoreFromLand, (1.0 - downLeftWater) * (1.0 - tileFract.x) * (1.0 - tileFract.y));
    shoreFromLand = max(shoreFromLand, (1.0 - downRightWater) * tileFract.x * (1.0 - tileFract.y));
    shoreFromLand = max(shoreFromLand, (1.0 - upLeftWater) * (1.0 - tileFract.x) * tileFract.y);
    shoreFromLand = max(shoreFromLand, (1.0 - upRightWater) * tileFract.x * tileFract.y);
    shoreFromLand *= centerWater;

    let depthPos = maskPos - 0.5;
    let depthBase = vec2<i32>(floor(depthPos));
    let depthFract = fract(depthPos);
    let mask00 = readWaterMaskTexel(depthBase, layer);
    let mask10 = readWaterMaskTexel(depthBase + vec2<i32>(1, 0), layer);
    let mask01 = readWaterMaskTexel(depthBase + vec2<i32>(0, 1), layer);
    let mask11 = readWaterMaskTexel(depthBase + vec2<i32>(1, 1), layer);

    var result: WaterMaskSample;
    result.water = centerWater;
    result.shore = shoreFromLand;
    result.depth = mix(
        mix(waterMaskDepth(mask00), waterMaskDepth(mask10), depthFract.x),
        mix(waterMaskDepth(mask01), waterMaskDepth(mask11), depthFract.x),
        depthFract.y,
    );
    result.bedColor = mix(
        mix(mask00.rgb, mask10.rgb, depthFract.x),
        mix(mask01.rgb, mask11.rgb, depthFract.x),
        depthFract.y,
    );
    return result;
}

fn waterWorldUvs(worldUv: vec2<f32>, scale: f32) -> vec2<f32> {
    return -worldUv / scale;
}

fn waterAnimationFrame(duration: f32, time: f32) -> f32 {
    if (duration == 0.0) { return 0.0; }
    return (time - floor(time / duration) * duration) / duration;
}

fn waterSample(uv: vec2<f32>, layer: i32) -> vec4<f32> {
    return textureSample(waterTextures, waterSampler, uv, layer);
}

fn waterSpecular(viewDir: vec3<f32>, reflectDir: vec3<f32>, gloss: f32, strength: f32) -> f32 {
    return pow(clamp(dot(viewDir, reflectDir), 1e-10, 1.0), gloss) * strength;
}

fn sampleCausticsChannel(flow1: vec2<f32>, flow2: vec2<f32>, aberration: vec2<f32>) -> f32 {
    return min(
        waterSample(flow1 + aberration, WATER_CAUSTICS).r,
        waterSample(flow2 + aberration, WATER_CAUSTICS).r,
    );
}

fn sampleCaustics(flow1: vec2<f32>, flow2: vec2<f32>, aberration: f32) -> vec3<f32> {
    return vec3<f32>(
        sampleCausticsChannel(flow1, flow2, aberration * vec2<f32>(1.0, 1.0)),
        sampleCausticsChannel(flow1, flow2, aberration * vec2<f32>(1.0, -1.0)),
        sampleCausticsChannel(flow1, flow2, aberration * vec2<f32>(-1.0, -1.0)),
    );
}

fn cameraWorldPosition() -> vec3<f32> {
    let rotation = mat3x3<f32>(
        scene.viewMatrix[0].xyz,
        scene.viewMatrix[1].xyz,
        scene.viewMatrix[2].xyz,
    );
    return -(scene.viewMatrix[3].xyz * rotation);
}

fn shadeWater(
    worldUv: vec2<f32>,
    vanillaUv: vec2<f32>,
    worldPos: vec3<f32>,
    mat: Material,
    waterMask: WaterMaskSample,
    time: f32,
) -> vec3<f32> {
    let duration = mat.waterDuration;
    var uv1 = waterWorldUvs(worldUv, 3.0).yx - vec2<f32>(waterAnimationFrame(28.0 * duration, time));
    var uv2 = waterWorldUvs(worldUv, 3.0) + vec2<f32>(waterAnimationFrame(24.0 * duration, time));
    var uv3 = vanillaUv;

    let flowMapUv = waterWorldUvs(worldUv, 15.0) + vec2<f32>(waterAnimationFrame(50.0 * duration, time));
    let uvFlow = waterSample(flowMapUv, WATER_FLOW).xy;
    uv1 += uvFlow * 0.025;
    uv2 += uvFlow * 0.025;
    uv3 += uvFlow * 0.025;

    let normalLayer = select(WATER_NORMAL_1, WATER_NORMAL_2, mat.waterUseNormalMap2);
    let t1 = waterSample(uv1, normalLayer).xyz;
    let t2 = waterSample(uv2, normalLayer).xyz;
    let foamMask = waterSample(uv3, WATER_FOAM).r;

    let n1 = -vec3<f32>(
        (t1.x * 2.0 - 1.0) * mat.waterNormalStrength,
        t1.z,
        (t1.y * 2.0 - 1.0) * mat.waterNormalStrength,
    );
    let n2 = -vec3<f32>(
        (t2.x * 2.0 - 1.0) * mat.waterNormalStrength,
        t2.z,
        (t2.y * 2.0 - 1.0) * mat.waterNormalStrength,
    );
    let normals = normalize(n1 + n2);
    let viewDir = normalize(cameraWorldPosition() - worldPos);
    let lightDotNormals = dot(normals, WATER_LIGHT_DIR);
    let downDotNormals = -normals.y;
    let viewDotNormals = dot(viewDir, normals);

    let ambientLightOut = WATER_AMBIENT_COLOR;
    let dirLightColor = vec3<f32>(1.0);
    let lightOut = max(lightDotNormals, 0.0) * dirLightColor;
    let lightReflectDir = reflect(-WATER_LIGHT_DIR, normals);
    let lightSpecularOut = dirLightColor *
        waterSpecular(viewDir, lightReflectDir, mat.waterSpecularGloss, mat.waterSpecularStrength);
    let skyLightOut = max(downDotNormals, 0.0) * scene.skyColor.rgb * 0.5;

    var finalFresnel = clamp(
        mix(0.4, 1.0, (1.0 - clamp(viewDotNormals, 0.0, 1.0)) * 1.2),
        0.0,
        1.0,
    );
    var surfaceColor: vec3<f32>;
    if (finalFresnel < 0.5) {
        surfaceColor = mix(WATER_COLOR_DARK, WATER_COLOR_MID, finalFresnel * 2.0);
    } else {
        surfaceColor = mix(
            WATER_COLOR_MID,
            WATER_COLOR_LIGHT,
            (finalFresnel - 0.5) * 2.0,
        );
    }

    let surfaceColorOut = surfaceColor * max(mat.waterSpecularStrength, 0.2);
    let compositeLight =
        ambientLightOut + lightOut + lightSpecularOut + skyLightOut + surfaceColorOut;

    var baseColor = mat.waterSurfaceColor * compositeLight;
    baseColor = mix(baseColor, surfaceColor, mat.waterFresnelAmount);
    if (abs(mat.waterFresnelAmount - 0.85) < 0.01) {
        baseColor *= 0.75;
    }

    var foamAmount = min(waterMask.shore, 0.8);
    let foamColor = mat.waterFoamColor * foamMask * compositeLight;
    foamAmount = clamp(
        pow(max(1.0 - ((1.0 - foamAmount) / 0.7), 0.0), 3.0),
        0.0,
        1.0,
    ) * mat.waterHasFoam;
    foamAmount *= foamColor.r;
    baseColor = mix(baseColor, foamColor, foamAmount);

    let specularComposite = mix(lightSpecularOut, vec3<f32>(0.0), foamAmount);
    let flatFresnel = 1.0 - dot(viewDir, vec3<f32>(0.0, -1.0, 0.0));
    finalFresnel = max(finalFresnel, flatFresnel);
    baseColor += lightSpecularOut / 3.0;

    let alpha = max(
        mat.waterBaseOpacity,
        max(foamAmount, max(finalFresnel, length(specularComposite / 3.0))),
    );

    let depth = waterMask.depth * WATER_MAX_DEPTH;
    var underwater = waterMask.bedColor;
    if (depth < 150.0) {
        underwater *= mix(vec3<f32>(1.0), mat.waterDepthColor, depth / 150.0);
    } else if (depth < 500.0) {
        underwater *= mix(
            mat.waterDepthColor,
            vec3<f32>(0.0),
            (depth - 150.0) / 350.0,
        );
    } else {
        underwater = vec3<f32>(0.0);
    }

    let causticsUv = waterWorldUvs(worldUv, 1.75) * 0.75;
    let causticsDir = vec2<f32>(1.0, -2.0);
    let causticsFlow1 = causticsUv + waterAnimationFrame(17.0, time) * causticsDir;
    let causticsFlow2 = causticsUv * 1.5 - waterAnimationFrame(23.0, time) * causticsDir;
    let caustics = sampleCaustics(causticsFlow1, causticsFlow2, 0.005);
    var causticsDepthMultiplier = (depth - 512.0) / -512.0;
    causticsDepthMultiplier *= causticsDepthMultiplier;
    underwater *= 1.0 +
        caustics * causticsDepthMultiplier * max(-WATER_LIGHT_DIR.y, 0.0);

    return clamp(mix(underwater, baseColor, alpha), vec3<f32>(0.0), vec3<f32>(1.0));
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
    if (priority > 0u) { viewPos.z += f32(priority) * 0.001; }

    output.position = scene.projectionMatrix * viewPos;
    output.color = decodeVertexColor(rawHsl, textureId, input.packed.z);
    output.texCoord = animateTexCoord(decodeTexCoord(input.packed.x, input.packed.z), material);
    output.textureId = textureId;
    output.alphaCutOff = material.alphaCutOff;
    output.worldUv = worldPos.xz;
    output.worldPos = worldPos;
    output.plane = map.plane;

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
        textureColor = mix(
            sampleTextureAtlas(input.textureId + u32(frame0), input.texCoord),
            sampleTextureAtlas(input.textureId + u32(frame1), input.texCoord),
            mixAmount,
        );
    }

    let banding = max(scene.colorBanding, 1.0);
    let palette = round(input.color.rgb * banding) / banding;
    var surface = textureColor.rgb * palette * scene.brightness;

    if ((material.flags & MATERIAL_FLAG_WATER) != 0) {
        let mask = sampleWaterMask(input.worldUv, input.plane);
        if (mask.water > 0.5) {
            surface = shadeWater(
                input.worldUv,
                input.texCoord,
                input.worldPos,
                material,
                mask,
                scene.currentTime,
            ) * scene.brightness;
        }
    }

    let fog = smoothstep(0.0, 1.0, clamp(input.fogAmount, 0.0, 1.0));
    let finalRgb = mix(surface, scene.skyColor.rgb, fog);
    let alpha = textureColor.a * input.color.a;
    return vec4<f32>(
        clamp(finalRgb, vec3<f32>(0.0), vec3<f32>(1.0)),
        alpha,
    );
}
`;
