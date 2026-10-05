import { createFacePriorityDrawOrder } from "../../priority/FacePrioritySort";

export type FacePriorityVisibilityMatrix = ArrayLike<number>;
export type FacePriorityVisibilityPoint = readonly [number, number, number];

function assertMatrix(matrix: FacePriorityVisibilityMatrix, label: string): void {
    if (matrix.length < 16) {
        throw new Error(`${label} requires a 4x4 matrix`);
    }
}

function transformPoint(
    point: FacePriorityVisibilityPoint,
    matrix: FacePriorityVisibilityMatrix,
): [number, number, number, number] {
    const [x, y, z] = point;
    return [
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
        matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15],
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
        const view = transformPoint(point, viewTransform);
        const clip = transformPoint([view[0], view[1], view[2]], {
            0: projectionMatrix[0], 1: projectionMatrix[1], 2: projectionMatrix[2], 3: projectionMatrix[3],
            4: projectionMatrix[4], 5: projectionMatrix[5], 6: projectionMatrix[6], 7: projectionMatrix[7],
            8: projectionMatrix[8], 9: projectionMatrix[9], 10: projectionMatrix[10], 11: projectionMatrix[11],
            12: projectionMatrix[12], 13: projectionMatrix[13], 14: projectionMatrix[14], 15: projectionMatrix[15],
            length: 16,
        });
        const w = projectionMatrix[3] * view[0] + projectionMatrix[7] * view[1] + projectionMatrix[11] * view[2] + projectionMatrix[15];
        if (!(w > 0) || !Number.isFinite(w)) {
            return undefined;
        }
        return [clip[0] / w, clip[1] / w];
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
