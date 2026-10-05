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
 * A triangle fully behind the camera (`w <= 0` for all three vertices) cannot
 * rasterize and is rejected. A triangle that straddles the camera plane is kept
 * conservatively: projected winding is undefined before clipping, while the
 * hardware rasterizer can clip the primitive correctly. Only triangles with
 * three positive clip-space W values are rejected by the projected winding test.
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

    const clipPoint = (point: FacePriorityVisibilityPoint): Vec4 => {
        const view = transformVec4([point[0], point[1], point[2], 1], viewTransform);
        return transformVec4(view, projectionMatrix);
    };

    const ca = clipPoint(a);
    const cb = clipPoint(b);
    const cc = clipPoint(c);
    if (
        !Number.isFinite(ca[3]) ||
        !Number.isFinite(cb[3]) ||
        !Number.isFinite(cc[3])
    ) {
        return false;
    }

    const aInFront = ca[3] > 0;
    const bInFront = cb[3] > 0;
    const cInFront = cc[3] > 0;
    const frontCount = Number(aInFront) + Number(bInFront) + Number(cInFront);
    if (frontCount === 0) {
        return false;
    }
    if (frontCount < 3) {
        return true;
    }

    const pa: [number, number] = [ca[0] / ca[3], ca[1] / ca[3]];
    const pb: [number, number] = [cb[0] / cb[3], cb[1] / cb[3]];
    const pc: [number, number] = [cc[0] / cc[3], cc[1] / cc[3]];
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
