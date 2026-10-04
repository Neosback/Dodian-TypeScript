export const WEBGPU_TERRAIN_SHADER = /* wgsl */ `
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

@group(0) @binding(0) var<uniform> scene: SceneUniforms;
@group(1) @binding(0) var<uniform> map: MapUniforms;

struct VertexInput {
    @location(0) packed: vec3<u32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) fogAmount: f32,
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

fn decodeVertexColor(v1: u32, v2: u32) -> vec4<f32> {
    var hsl = i32((v1 >> 15u) & 0xffffu);
    hsl = applyHslOverride(hsl, scene.sceneHslOverride);

    let textured = ((v1 >> 31u) & 1u) != 0u;
    let alpha = f32((v2 >> 9u) & 0xffu) / 255.0;

    if (textured) {
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
    output.color = decodeVertexColor(input.packed.y, input.packed.z);

    let loadAlpha = smoothstep(0.0, 1.0, min(scene.currentTime - map.loadTime, 1.0));
    let baseFog = fogFactor(worldPos.xz - scene.playerPos);
    output.fogAmount = select(max(1.0 - loadAlpha, baseFog), baseFog, loadAlpha >= 1.0);
    return output;
}

@fragment
fn fsMain(input: VertexOutput) -> @location(0) vec4<f32> {
    let banding = max(scene.colorBanding, 1.0);
    let palette = round(input.color.rgb * banding) / banding;
    let fog = smoothstep(0.0, 1.0, clamp(input.fogAmount, 0.0, 1.0));
    let finalRgb = mix(palette * scene.brightness, scene.skyColor.rgb, fog);
    return vec4<f32>(clamp(finalRgb, vec3<f32>(0.0), vec3<f32>(1.0)), input.color.a);
}
`;
