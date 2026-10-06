import { useEffect, useRef } from "react";

import { Renderer } from "../game/render/Renderer";
import { getWebGPUTerrainComparisonCanvas } from "../render/webgpu/compare/WebGPUTerrainComparison";
import { installWebGPUDynamicComparisons } from "../render/webgpu/dynamic/WebGPUDynamicComparisonLifecycle";
import { installWebGPUPickingParityRecorder } from "../render/webgpu/picking/WebGPUPickingParityRecorder";

export interface CanvasProps {
    renderer: Renderer;
}

export function Canvas({ renderer }: CanvasProps): JSX.Element {
    const divRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const host = divRef.current;
        if (!host) {
            return;
        }
        let active = true;
        let restoreDynamicComparisons: (() => void) | undefined;
        let restorePickingParity: (() => void) | undefined;
        host.appendChild(renderer.canvas);
        renderer.attachResizeObserver();
        requestAnimationFrame(() => renderer.forceResize());

        renderer.initOnce().then(() => {
            if (!active) return;
            restoreDynamicComparisons = installWebGPUDynamicComparisons(renderer);
            restorePickingParity = installWebGPUPickingParityRecorder(renderer);
            const comparisonCanvas = getWebGPUTerrainComparisonCanvas(renderer);
            if (comparisonCanvas && comparisonCanvas.parentNode !== host) {
                host.appendChild(comparisonCanvas);
            }
            renderer.start();
        });

        return () => {
            active = false;
            restorePickingParity?.();
            restorePickingParity = undefined;
            restoreDynamicComparisons?.();
            restoreDynamicComparisons = undefined;
            renderer.stop();
            const comparisonCanvas = getWebGPUTerrainComparisonCanvas(renderer);
            if (comparisonCanvas?.parentNode === host) host.removeChild(comparisonCanvas);
            if (renderer.canvas.parentNode === host) host.removeChild(renderer.canvas);
        };
    }, [renderer]);

    return (
        <div
            ref={divRef}
            style={{ position: "relative", width: "100%", height: "100%" }}
            tabIndex={0}
        />
    );
}
