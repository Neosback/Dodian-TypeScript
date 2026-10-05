import { useEffect, useRef } from "react";

import { Renderer } from "../game/render/Renderer";
import { getWebGPUTerrainComparisonCanvas } from "../render/webgpu/compare/WebGPUTerrainComparison";
import { installWebGPUPlayerOpaqueComparison } from "../render/webgpu/player/WebGPUPlayerOpaqueComparison";

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
        let restorePlayerComparison: (() => void) | undefined;
        host.appendChild(renderer.canvas);
        renderer.attachResizeObserver();
        requestAnimationFrame(() => renderer.forceResize());

        renderer.initOnce().then(() => {
            if (!active) return;
            restorePlayerComparison = installWebGPUPlayerOpaqueComparison(renderer);
            const comparisonCanvas = getWebGPUTerrainComparisonCanvas(renderer);
            if (comparisonCanvas && comparisonCanvas.parentNode !== host) {
                host.appendChild(comparisonCanvas);
            }
            renderer.start();
        });

        return () => {
            active = false;
            restorePlayerComparison?.();
            restorePlayerComparison = undefined;
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
