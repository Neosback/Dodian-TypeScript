import type { SceneFrameDescription } from "../../frame/SceneFrameDescription";
import {
    createLocDelayedWallDrawOrder,
    type LocDelayedWallDrawItem,
} from "../../loc/LocDelayedWallOrdering";
import { resolveLocOrderingAnchorWorldTile } from "../../loc/LocOrderingMetadata";
import {
    LOC_PLACEMENT_FOOTPRINT_NONE,
    LOC_PLACEMENT_NONE,
} from "../../loc/LocPlacementMetadata";
import type {
    WebGPUBufferLike,
    WebGPURenderPassEncoderLike,
    WebGPURenderPipelineLike,
} from "../../backend/WebGPUPlatform";
import type { WebGPUTerrainMapResources } from "../terrain/WebGPUTerrainMapResources";
import type {
    WebGPUStaticLocDrawPlanEntry,
    WebGPUStaticLocPassResources,
} from "./WebGPUStaticLocResources";

export interface WebGPUOrderedStaticGeometryResources {
    readonly vertexBuffer: WebGPUBufferLike;
    readonly indexBuffer: WebGPUBufferLike;
}

export type WebGPUOrderedStaticDrawSource = {
    resources: WebGPUOrderedStaticGeometryResources | undefined;
    staticPass: WebGPUStaticLocPassResources | undefined;
};

type WebGPUOrderedStaticSubmission = {
    sourceIndex: number;
    resources: WebGPUOrderedStaticGeometryResources;
    staticPass: WebGPUStaticLocPassResources;
    draw: WebGPUStaticLocDrawPlanEntry;
    ordering: LocDelayedWallDrawItem;
};

/**
 * Submit loc-like static geometry in its existing map-local baseline order,
 * applying only the local type-1/type-3 diagonal-wall painter constraints.
 *
 * The source list is intentionally supplied as ordinary locs -> ground items ->
 * doors. Stable topological ordering preserves that established WebGPU/WebGL
 * baseline unless an overlapping diagonal wall must move before/after a scene
 * loc according to the original software painter.
 */
export function drawWebGPUOrderedStaticGeometry(
    pass: WebGPURenderPassEncoderLike,
    frame: SceneFrameDescription,
    map: WebGPUTerrainMapResources,
    pipeline: WebGPURenderPipelineLike,
    sources: readonly WebGPUOrderedStaticDrawSource[],
): void {
    const submissions: WebGPUOrderedStaticSubmission[] = [];
    const renderPosX = map.plan.renderPosX;
    const renderPosY = map.plan.renderPosY;
    const worldTileOffset = map.plan.borderSize;

    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        const source = sources[sourceIndex];
        if (!source.resources || !source.staticPass) {
            continue;
        }
        for (const draw of source.staticPass.draws) {
            if (draw.plane > frame.roofPlaneLimit) {
                continue;
            }
            const instanceIndex = draw.firstInstance | 0;
            const anchor = resolveLocOrderingAnchorWorldTile(
                source.staticPass.orderingAnchorTiles,
                instanceIndex,
                renderPosX,
                renderPosY,
                worldTileOffset,
            );
            submissions.push({
                sourceIndex,
                resources: source.resources,
                staticPass: source.staticPass,
                draw,
                ordering: {
                    plane: draw.plane,
                    placementMetadata:
                        source.staticPass.placementMetadata[instanceIndex] ?? LOC_PLACEMENT_NONE,
                    anchorX: anchor?.x ?? -1,
                    anchorY: anchor?.y ?? -1,
                    encodedFootprint:
                        source.staticPass.orderingFootprints[instanceIndex] ??
                        LOC_PLACEMENT_FOOTPRINT_NONE,
                },
            });
        }
    }

    if (submissions.length === 0) {
        return;
    }

    const order = createLocDelayedWallDrawOrder(
        submissions.map((submission) => submission.ordering),
        Math.floor(frame.cameraPosition[0]),
        Math.floor(frame.cameraPosition[1]),
    );

    pass.setPipeline(pipeline);
    pass.setBindGroup(1, map.sharedMapBindGroup);
    let activeSourceIndex = -1;
    for (const orderedIndex of order) {
        const submission = submissions[orderedIndex];
        const draw = submission.draw;
        if (draw.indexCount <= 0 || draw.instanceCount <= 0) {
            continue;
        }
        if (submission.sourceIndex !== activeSourceIndex) {
            activeSourceIndex = submission.sourceIndex;
            pass.setBindGroup(4, submission.staticPass.bindGroup);
            pass.setVertexBuffer(0, submission.resources.vertexBuffer);
            pass.setIndexBuffer(submission.resources.indexBuffer, "uint32");
        }
        pass.drawIndexed(
            draw.indexCount,
            draw.instanceCount,
            draw.firstIndex,
            0,
            draw.firstInstance,
        );
    }
}
