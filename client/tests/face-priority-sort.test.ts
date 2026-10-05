import assert from "node:assert/strict";

import {
    createFaceDepthOrder,
    createFacePriorityDrawOrder,
    getFacePriorityThresholds,
} from "../render/priority/FacePrioritySort";

// No per-face priority array follows the software client's ordinary far-to-near
// depth buckets, preserving source order when faces land in the same bucket.
assert.deepEqual(createFaceDepthOrder([5, 9, 9, 2]), [1, 2, 0, 3]);
assert.deepEqual(createFacePriorityDrawOrder([5, 9, 9, 2]), [1, 2, 0, 3]);

// Ordinary priorities 0..9 are emitted bucket-by-bucket after the initial
// far-to-near walk. Each bucket remains stable and far-to-near internally.
assert.deepEqual(
    createFacePriorityDrawOrder([8, 3, 5, 9], [2, 0, 1, 2]),
    [1, 2, 3, 0],
);

// Construct all three software-client threshold groups:
//   avg(1,2) = (40 + 60) / 2 = 50
//   avg(3,4) = (30 + 50) / 2 = 40
//   avg(6,8) = (20 + 40) / 2 = 30
const thresholdDepths = [40, 60, 30, 50, 20, 40, 70, 45, 35, 25, 10, 15, 5];
const thresholdPriorities = [1, 2, 3, 4, 6, 8, 10, 10, 10, 10, 0, 5, 9];
assert.deepEqual(getFacePriorityThresholds(thresholdDepths, thresholdPriorities), {
    priority1And2: 50,
    priority3And4: 40,
    priority6And8: 30,
});

// Priority 10 is progressively spliced before priorities 0, 3 and 5 whenever
// its next face is farther than that stage's threshold. The final p10 face is
// below every threshold and therefore remains until after priority 9.
assert.deepEqual(
    createFacePriorityDrawOrder(thresholdDepths, thresholdPriorities),
    [6, 10, 0, 1, 7, 2, 3, 8, 11, 4, 5, 12, 9],
);

// The comparison is strictly greater-than. A special face exactly on the
// (1,2) average is not emitted before priority 0.
assert.deepEqual(
    createFacePriorityDrawOrder([50, 50, 50, 1], [1, 2, 10, 0]),
    [3, 0, 1, 2],
);

// Priority 10 and 11 are NOT merged by depth. The original exhausts the p10
// stream before switching to p11, so a very-far p11 face can remain behind a
// nearer p10 face when p10 has not crossed an insertion threshold.
assert.deepEqual(
    createFacePriorityDrawOrder([10, 100, 20, 20, 1], [10, 11, 1, 2, 0]),
    [4, 2, 3, 0, 1],
);

// Empty threshold pairs use zero, matching the client's initialized averages.
assert.deepEqual(getFacePriorityThresholds([7], [10]), {
    priority1And2: 0,
    priority3And4: 0,
    priority6And8: 0,
});
assert.deepEqual(createFacePriorityDrawOrder([7], [10]), [0]);

assert.throws(
    () => createFacePriorityDrawOrder([1], [12]),
    /invalid render priority 12/,
);
assert.throws(
    () => createFacePriorityDrawOrder([1, 2], [0]),
    /length mismatch/,
);

console.log("face-priority software painter reference checks passed");
