import { createFacePriorityDrawOrder } from "../../priority/FacePrioritySort";

export type FacePriorityVisibilityMatrix = ArrayLike<number>;
export type FacePriorityVisibilityPoint = readonly [number, number, number];

type Vec4 = readonly [number, number, number, number];

function assertMatrix(matrix: FacePriorityVisibilityMatrix, label: string): void {
    if (matrix.length < 16) {
        throw new Error(`${label} requires a 4x4 matrix`);
    }
}

function transformVec4(vector: Vec4, matrix: FacePriorityVisibilityMatrix): Vec4 {
    const [x, y, z, w] = vector;
    return [
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
        matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
    ];
}

/**
 * Match the software painter's projected winding test while using the same
 * clip-space transform as the WebGPU loc pipeline.
 *
 * WebGPU's framebuffer Y axis is down. With `frontFace: "ccw"`, the equivalent
 * NDC test is the retained software expression:
 *
 * `(aX-bX)*(cY-bY) - (cX-bX)*(aY-bY) > 0`.
 *
 * Vertices behind the camera (`w <= 0`) cannot establish the submitted
 * primitive's front-facing winding before clipping and are excluded here.
 */
export function isWebGPUFacePriorityFrontFacing(
    a: FacePriorityVisibilityPoint,
    b: FacePriorityVisibilityPoint,
    c: FacePriorityVisibilityPoint,
    viewTransform: FacePriorityVisibilityMatrix,
    projectionMatrix: FacePriorityVisibilityMatrix,
): boolean {
    assertMatrix(viewTransform, "Face-priority view transform");
    assertMatrix(projectionMatrix, "Face-priority projection transform");

    const project = (point: FacePriorityVisibilityPoint): [number, number] | undefined => {
        const view = transformVec4([point[0], point[1], point[2], 1], viewTransform);
        const clip = transformVec4(view, projectionMatrix);
        if (!(clip[3] > 0) || !Number.isFinite(clip[3])) {
            return undefined;
        }
        return [clip[0] / clip[3], clip[1] / clip[3]];
    };

    const pa = project(a);
    const pb = project(b);
    const pc = project(c);
    if (!pa || !pb || !pc) {
        return false;
    }
    const winding =
        (pa[0] - pb[0]) * (pc[1] - pb[1]) -
        (pc[0] - pb[0]) * (pa[1] - pb[1]);
    return winding > 0;
}

/**
 * CPU oracle for the visible sequence consumed by the GPU sorter. Back faces
 * are absent from threshold counts entirely rather than merely discarded after
 * sorting.
 */
export function createVisibilityFilteredFacePriorityOrder(
    depths: ArrayLike<number>,
    priorities: ArrayLike<number>,
    visibility: ArrayLike<number | boolean>,
): number[] {
    if (depths.length !== priorities.length || depths.length !== visibility.length) {
        throw new Error(
            `Face visibility/depth/priority length mismatch: ${visibility.length}/${depths.length}/${priorities.length}`,
        );
    }

    const sourceFaces: number[] = [];
    const visibleDepths: number[] = [];
    const visiblePriorities: number[] = [];
    for (let face = 0; face < depths.length; face++) {
        if (!visibility[face]) {
            continue;
        }
        sourceFaces.push(face);
        visibleDepths.push(Number(depths[face]));
        visiblePriorities.push(Number(priorities[face]));
    }
    if (sourceFaces.length === 0) {
        return [];
    }
    const localOrder = createFacePriorityDrawOrder(visibleDepths, visiblePriorities);
    return localOrder.map((localFace) => sourceFaces[localFace]);
}
