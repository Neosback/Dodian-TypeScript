import type { vec3 } from "gl-matrix";

import type { Model } from "../../rs/model/Model";
import { type ModelFace, SceneBuffer } from "../buffer/SceneBuffer";

/**
 * SceneBuffer variant for model-only geometry that preserves the original
 * uncompressed 0..11 face priority for every emitted triangle.
 *
 * The existing packed vertex ABI deliberately stays unchanged for WebGL2.
 * WebGPU face sorting consumes this CPU-side sidecar later.
 */
export class ExactFacePrioritySceneBuffer extends SceneBuffer {
    private readonly exactFacePriorities: number[] = [];
    private readonly exactFacePriorityModelSpans: number[] = [];

    override addModel(
        model: Model,
        faces: ModelFace[],
        offset?: vec3,
        reuseVertices: boolean = true,
    ): void {
        if (faces.length === 0) {
            return;
        }

        for (const face of faces) {
            const priority = face.priority | 0;
            if (priority < 0 || priority > 11) {
                throw new Error(`Face priority must be in 0..11, got ${priority}`);
            }
        }

        const firstIndex = this.indices.length;
        super.addModel(model, faces, offset, reuseVertices);
        const indexCount = this.indices.length - firstIndex;
        const expectedIndexCount = faces.length * 3;
        if (indexCount !== expectedIndexCount) {
            throw new Error(
                `Exact face-priority sidecar lost index alignment: expected ${expectedIndexCount} indices, emitted ${indexCount}`,
            );
        }

        for (const face of faces) {
            this.exactFacePriorities.push(face.priority & 0xff);
        }
        this.exactFacePriorityModelSpans.push(firstIndex, indexCount);
    }

    toExactFacePriorityArray(): Uint8Array {
        const priorities = Uint8Array.from(this.exactFacePriorities);
        validateExactFacePriorityAlignment(
            this.indices.length,
            priorities,
            this.exactFacePriorityModelSpans,
        );
        return priorities;
    }

    toExactFacePriorityModelSpans(): Uint32Array {
        const priorities = Uint8Array.from(this.exactFacePriorities);
        validateExactFacePriorityAlignment(
            this.indices.length,
            priorities,
            this.exactFacePriorityModelSpans,
        );
        return Uint32Array.from(this.exactFacePriorityModelSpans);
    }
}

/**
 * Validate the model-local priority sidecar contract.
 *
 * `modelSpans` stores `[firstIndex, indexCount]` pairs in source-index units.
 * Model-only buffers are expected to cover the entire index stream exactly once
 * in emission order. A later sorter can therefore partition merged draw ranges
 * back into the individual model submissions used by the software client.
 */
export function validateExactFacePriorityAlignment(
    indexCount: number,
    priorities: ArrayLike<number>,
    modelSpans: ArrayLike<number>,
): void {
    const normalizedIndexCount = indexCount | 0;
    if (normalizedIndexCount < 0 || normalizedIndexCount % 3 !== 0) {
        throw new Error(`Exact face-priority index count must be a non-negative multiple of 3`);
    }
    const expectedPriorityCount = normalizedIndexCount / 3;
    if (priorities.length !== expectedPriorityCount) {
        throw new Error(
            `Exact face-priority count mismatch: expected ${expectedPriorityCount}, got ${priorities.length}`,
        );
    }
    if ((modelSpans.length & 1) !== 0) {
        throw new Error(`Exact face-priority model spans must contain firstIndex/indexCount pairs`);
    }

    let expectedFirstIndex = 0;
    for (let i = 0; i < modelSpans.length; i += 2) {
        const firstIndex = modelSpans[i] | 0;
        const spanIndexCount = modelSpans[i + 1] | 0;
        if (firstIndex !== expectedFirstIndex) {
            throw new Error(
                `Exact face-priority model span ${i >> 1} starts at ${firstIndex}, expected ${expectedFirstIndex}`,
            );
        }
        if (spanIndexCount <= 0 || spanIndexCount % 3 !== 0) {
            throw new Error(
                `Exact face-priority model span ${i >> 1} has invalid index count ${spanIndexCount}`,
            );
        }
        expectedFirstIndex += spanIndexCount;
        if (expectedFirstIndex > normalizedIndexCount) {
            throw new Error(`Exact face-priority model spans exceed the source index stream`);
        }
    }

    if (expectedFirstIndex !== normalizedIndexCount) {
        throw new Error(
            `Exact face-priority model spans cover ${expectedFirstIndex} indices, expected ${normalizedIndexCount}`,
        );
    }
}
