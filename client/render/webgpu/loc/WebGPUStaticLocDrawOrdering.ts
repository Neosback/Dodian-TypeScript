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
    WebGPUCommandEncoderLike,
    WebGPURenderPassEncoderLike,
    WebGPURenderPipelineLike,
} from "../../backend/WebGPUPlatform";
import type { WebGPUTerrainMapResources } from "../terrain/WebGPUTerrainMapResources";
import type { WebGPUHeightMapResources } from "./WebGPUHeightMapResources";
import type { WebGPUFacePrioritySortResources } from "./WebGPUFacePrioritySortResources";
import {
    prepareWebGPUFacePriorityPass,
    type WebGPUFacePriorityPreparedPass,
} from "./WebGPUFacePriorityPassActivation";
import type {
    WebGPUStaticLocDrawPlanEntry,
    WebGPUStaticLocPassResources,
} from "./WebGPUStaticLocResources";

export interface WebGPUOrderedStaticGeometryResources {
    readonly vertexBuffer: WebGPUBufferLike;
    readonly indexBuffer: WebGPUBufferLike;
    readonly heightMap?: WebGPUHeightMapResources;
    readonly facePrioritySortResources?: WebGPUFacePrioritySortResources;
}

export type WebGPUOrderedStaticDrawSource = {
    resources: WebGPUOrderedStaticGeometryResources | undefined;
    staticPass: WebGPUStaticLocPassResources | undefined;
};

type WebGPUOrderedStaticSubmission = {
    sourceIndex: number;
    resources: WebGPUOrderedStaticGeometryResources;
    staticPass: WebGPUStaticLocPassResources;
    indexBuffer: WebGPUBufferLike;
    draw: WebGPUStaticLocDrawPlanEntry;
    ordering: LocDelayedWallDrawItem;
};

/**
 * Submit loc-like static geometry in its existing map-local baseline order,
 * applying exact model-local face-priority sorting first and then the local
 * type-1/type-3 diagonal-wall painter constraints across whole placed models.
 *
 * The exact priority pass expands instanced draws into one draw per placement.
 * This is required because terrain contouring can give two instances that share
 * source geometry different face depths. It also lets delayed-wall ordering use
 * the correct placement metadata for every instance instead of only the first.
 */
export function drawWebGPUOrderedStaticGeometry(
    pass: WebGPURenderPassEncoderLike,
    frame: SceneFrameDescription,
    map: WebGPUTerrainMapResources,
    pipeline: WebGPURenderPipelineLike,
    sources: readonly WebGPUOrderedStaticDrawSource[],
): void {
    const preparedBySource = new Array<WebGPUFacePriorityPreparedPass | undefined>(
        sources.length,
    );

    // The render pass is only being recorded at this point; its command buffer
    // is submitted later by WebGPUStaticSceneRenderer. Submit one compute command
    // buffer now so queue ordering guarantees depth -> sort completes before that
    // later render submission consumes the dense sorted-index buffers.
    let computeEncoder: WebGPUCommandEncoderLike | undefined;
    let computeDevice: WebGPUFacePrioritySortResources["device"] | undefined;
    let encodedWorkItems = 0;

    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        const source = sources[sourceIndex];
        const sortResources = source.resources?.facePrioritySortResources;
        const heightMap = source.resources?.heightMap;
        if (!sortResources || !heightMap || !source.staticPass) {
            continue;
        }
        if (!computeEncoder) {
            computeDevice = sortResources.device;
            computeEncoder = computeDevice.createCommandEncoder({
                label: "face-priority-static-pass-encoder",
            });
        } else if (computeDevice !== sortResources.device) {
            throw new Error("Static face-priority sources unexpectedly use different WebGPU devices");
        }

        const prepared = prepareWebGPUFacePriorityPass(
            computeEncoder,
            frame,
            map,
            sortResources,
            heightMap,
            source.staticPass,
        );
        preparedBySource[sourceIndex] = prepared;
        encodedWorkItems += prepared?.workItemCount ?? 0;
    }

    if (computeEncoder && computeDevice && encodedWorkItems > 0) {
        computeDevice.queue.submit([computeEncoder.finish()]);
    }

    const submissions: WebGPUOrderedStaticSubmission[] = [];
    const renderPosX = map.plan.renderPosX;
    const renderPosY = map.plan.renderPosY;
    const worldTileOffset = map.plan.borderSize;

    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        const source = sources[sourceIndex];
        if (!source.resources || !source.staticPass) {
            continue;
        }
        const prepared = preparedBySource[sourceIndex];
        const draws = prepared?.draws ?? source.staticPass.draws;
        const indexBuffer = prepared?.indexBuffer ?? source.resources.indexBuffer;

        for (const draw of draws) {
            if (
                draw.indexCount <= 0 ||
                draw.instanceCount <= 0 ||
                draw.plane > frame.roofPlaneLimit
            ) {
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
                indexBuffer,
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
    let activeIndexBuffer: WebGPUBufferLike | undefined;
    for (const orderedIndex of order) {
        const submission = submissions[orderedIndex];
        const draw = submission.draw;
        if (
            submission.sourceIndex !== activeSourceIndex ||
            submission.indexBuffer !== activeIndexBuffer
        ) {
            activeSourceIndex = submission.sourceIndex;
            activeIndexBuffer = submission.indexBuffer;
            pass.setBindGroup(4, submission.staticPass.bindGroup);
            pass.setVertexBuffer(0, submission.resources.vertexBuffer);
            pass.setIndexBuffer(submission.indexBuffer, "uint32");
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
