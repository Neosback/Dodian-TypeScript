export const FACE_PRIORITY_BUCKET_COUNT = 12;
export const FACE_PRIORITY_SPECIAL_10 = 10;
export const FACE_PRIORITY_SPECIAL_11 = 11;

export type FacePriorityThresholds = {
    priority1And2: number;
    priority3And4: number;
    priority6And8: number;
};

function assertMatchingLengths(
    depths: ArrayLike<number>,
    priorities: ArrayLike<number> | undefined,
): void {
    if (priorities && priorities.length !== depths.length) {
        throw new Error(
            `Face priority/depth length mismatch: ${priorities.length} priorities for ${depths.length} depths`,
        );
    }
}

function validatePriority(priority: number, faceIndex: number): number {
    const value = priority | 0;
    if (value < 0 || value >= FACE_PRIORITY_BUCKET_COUNT) {
        throw new RangeError(`Face ${faceIndex} has invalid render priority ${priority}`);
    }
    return value;
}

/**
 * Recreate the software renderer's initial far-to-near face walk.
 *
 * The original client walks integer depth buckets from the farthest bucket to
 * the nearest and preserves source order within a bucket. Sorting by depth
 * descending and then by source index is equivalent when callers supply the
 * same integer face-depth values.
 */
export function createFaceDepthOrder(depths: ArrayLike<number>): number[] {
    const order = Array.from({ length: depths.length }, (_, index) => index);
    order.sort((a, b) => {
        const depthDelta = Number(depths[b]) - Number(depths[a]);
        return depthDelta !== 0 ? depthDelta : a - b;
    });
    return order;
}

function averagePriorityDepth(
    depthSums: readonly number[],
    buckets: readonly number[][],
    a: number,
    b: number,
): number {
    const count = buckets[a].length + buckets[b].length;
    if (count === 0) {
        return 0;
    }
    return Math.trunc((depthSums[a] + depthSums[b]) / count);
}

export function getFacePriorityThresholds(
    depths: ArrayLike<number>,
    priorities: ArrayLike<number>,
): FacePriorityThresholds {
    assertMatchingLengths(depths, priorities);

    const buckets: number[][] = Array.from(
        { length: FACE_PRIORITY_BUCKET_COUNT },
        () => [],
    );
    const depthSums = new Array<number>(FACE_PRIORITY_BUCKET_COUNT).fill(0);

    for (const faceIndex of createFaceDepthOrder(depths)) {
        const priority = validatePriority(Number(priorities[faceIndex]), faceIndex);
        buckets[priority].push(faceIndex);
        if (priority < FACE_PRIORITY_SPECIAL_10) {
            depthSums[priority] += Math.trunc(Number(depths[faceIndex]));
        }
    }

    return {
        priority1And2: averagePriorityDepth(depthSums, buckets, 1, 2),
        priority3And4: averagePriorityDepth(depthSums, buckets, 3, 4),
        priority6And8: averagePriorityDepth(depthSums, buckets, 6, 8),
    };
}

/**
 * Exact CPU reference for the original model face-priority painter.
 *
 * With no per-face priority array the software client simply emits faces in
 * far-to-near depth order. With priorities present it first performs that same
 * depth walk, appending each face to one of twelve stable priority buckets.
 * Buckets 0..9 are emitted in numeric order, except that the complete priority
 * 10 stream followed by the complete priority 11 stream is spliced in at the
 * original three depth thresholds:
 *
 * - before priority 0 while special depth > average depth of priorities 1+2
 * - before priority 3 while special depth > average depth of priorities 3+4
 * - before priority 5 while special depth > average depth of priorities 6+8
 * - any remaining priority 10/11 faces after priority 9
 *
 * The comparison is deliberately strict (`>`), matching the software client.
 */
export function createFacePriorityDrawOrder(
    depths: ArrayLike<number>,
    priorities?: ArrayLike<number>,
): number[] {
    assertMatchingLengths(depths, priorities);
    const depthOrder = createFaceDepthOrder(depths);
    if (!priorities) {
        return depthOrder;
    }

    const buckets: number[][] = Array.from(
        { length: FACE_PRIORITY_BUCKET_COUNT },
        () => [],
    );
    const depthSums = new Array<number>(FACE_PRIORITY_BUCKET_COUNT).fill(0);

    for (const faceIndex of depthOrder) {
        const priority = validatePriority(Number(priorities[faceIndex]), faceIndex);
        buckets[priority].push(faceIndex);
        if (priority < FACE_PRIORITY_SPECIAL_10) {
            depthSums[priority] += Math.trunc(Number(depths[faceIndex]));
        }
    }

    const thresholds: FacePriorityThresholds = {
        priority1And2: averagePriorityDepth(depthSums, buckets, 1, 2),
        priority3And4: averagePriorityDepth(depthSums, buckets, 3, 4),
        priority6And8: averagePriorityDepth(depthSums, buckets, 6, 8),
    };

    // The original does not merge priorities 10 and 11 by depth. It exhausts
    // priority 10 first, then switches to the already depth-ordered 11 bucket.
    const special = [...buckets[FACE_PRIORITY_SPECIAL_10], ...buckets[FACE_PRIORITY_SPECIAL_11]];
    let specialOffset = 0;
    const output: number[] = [];

    const flushSpecialAbove = (threshold: number): void => {
        while (
            specialOffset < special.length &&
            Number(depths[special[specialOffset]]) > threshold
        ) {
            output.push(special[specialOffset++]);
        }
    };

    for (let priority = 0; priority < FACE_PRIORITY_SPECIAL_10; priority++) {
        if (priority === 0) {
            flushSpecialAbove(thresholds.priority1And2);
        } else if (priority === 3) {
            flushSpecialAbove(thresholds.priority3And4);
        } else if (priority === 5) {
            flushSpecialAbove(thresholds.priority6And8);
        }
        output.push(...buckets[priority]);
    }

    while (specialOffset < special.length) {
        output.push(special[specialOffset++]);
    }

    return output;
}
