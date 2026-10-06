import type { DynamicActorKind } from "../../dynamic/DynamicActorRenderData";
import { encodeWebGPUDynamicPickKind } from "./WebGPUDynamicPicking";

export const WEBGPU_COMBINED_DYNAMIC_PICK_TAG = 0x80000000;

interface DynamicActorShaderNames {
    outputType: "PlayerVertexOutput" | "NpcVertexOutput";
    vertexEntry: "vsPlayerOpaque" | "vsNpcOpaque";
}

function shaderNames(kind: DynamicActorKind): DynamicActorShaderNames {
    return kind === "player"
        ? { outputType: "PlayerVertexOutput", vertexEntry: "vsPlayerOpaque" }
        : { outputType: "NpcVertexOutput", vertexEntry: "vsNpcOpaque" };
}

/**
 * Add a dedicated integer pick payload/fragment to an existing player or NPC
 * shader module while preserving its already-audited vertex transform path.
 *
 * The ordinary color fragments remain untouched. The resulting module is used
 * only by an on-demand actor pick pass.
 */
export function patchWebGPUDynamicActorShaderForPicking(
    code: string,
    kind: DynamicActorKind,
): string {
    if (code.includes("fn fsDynamicPick")) return code;

    const names = shaderNames(kind);
    const outputStruct = `struct ${names.outputType} {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) fogAmount: f32,
    @location(2) texCoord: vec2<f32>,
    @location(3) @interpolate(flat) textureId: u32,
    @location(4) @interpolate(flat) alphaCutOff: f32,
};`;
    const patchedOutputStruct = `struct ${names.outputType} {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) fogAmount: f32,
    @location(2) texCoord: vec2<f32>,
    @location(3) @interpolate(flat) textureId: u32,
    @location(4) @interpolate(flat) alphaCutOff: f32,
    @location(5) @interpolate(flat) pickData: vec4<u32>,
};`;

    if (!code.includes(outputStruct)) {
        throw new Error(`WebGPU ${kind} shader output contract changed`);
    }
    if (!code.includes(`fn ${names.vertexEntry}`)) {
        throw new Error(`WebGPU ${kind} shader vertex entry changed`);
    }

    const returnSite = `    return output;\n}\n\n@fragment`;
    const returnMatches = code.split(returnSite).length - 1;
    if (returnMatches !== 1) {
        throw new Error(
            `Expected one WebGPU ${kind} actor vertex return site, found ${returnMatches}`,
        );
    }

    const kindCode = encodeWebGPUDynamicPickKind(kind);
    const patchedReturnSite = `    output.pickData = vec4<u32>(
        u32(max(input.actorMisc.y, 0.0)),
        map.mapId,
        ${kindCode}u,
        1u,
    );
    return output;
}\n\n@fragment`;

    const pickFragment = `

@fragment
fn fsDynamicPick(input: ${names.outputType}) -> @location(0) vec4<u32> {
    if (input.pickData.w == 0u || input.fogAmount >= 1.0) {
        discard;
    }
    let textureColor = sampleTextureAtlas(input.textureId, input.texCoord);
    let alpha = textureColor.a * input.color.a;
    if (
        (input.textureId == 0u && alpha < 0.01) ||
        textureColor.a < input.alphaCutOff
    ) {
        discard;
    }
    return input.pickData;
}
`;

    const patched = code
        .replace(outputStruct, patchedOutputStruct)
        .replace(returnSite, patchedReturnSite)
        .replace(/\s*$/, "") + pickFragment;

    if (!patched.includes("@location(5) @interpolate(flat) pickData: vec4<u32>")) {
        throw new Error(`Failed to inject WebGPU ${kind} pick payload`);
    }
    if (!patched.includes("fn fsDynamicPick")) {
        throw new Error(`Failed to inject WebGPU ${kind} pick fragment`);
    }
    return patched;
}

/**
 * Derive the M3 combined-pass variant from the M1/M2 dynamic picking shader.
 * Static pick word 2 contains InteractType values 0..3, so dynamic picks set
 * the high bit of that word to create a collision-free namespace while keeping
 * the underlying player/NPC kind code intact in the low bits.
 */
export function patchWebGPUDynamicActorShaderForCombinedPicking(
    code: string,
    kind: DynamicActorKind,
): string {
    const kindCode = encodeWebGPUDynamicPickKind(kind);
    const patched = patchWebGPUDynamicActorShaderForPicking(code, kind);
    const untaggedKind = `        ${kindCode}u,\n        1u,`;
    const taggedKind = `        (0x80000000u | ${kindCode}u),\n        1u,`;
    if (!patched.includes(untaggedKind)) {
        throw new Error(`WebGPU ${kind} dynamic pick payload contract changed`);
    }
    const combined = patched
        .replace(untaggedKind, taggedKind)
        .replace("fn fsDynamicPick(", "fn fsDynamicCombinedPick(");
    if (!combined.includes("fn fsDynamicCombinedPick")) {
        throw new Error(`Failed to create WebGPU ${kind} combined pick fragment`);
    }
    return combined;
}
