import { useEffect, useRef } from "react";

import { Renderer } from "../game/render/Renderer";
import { getWebGPUTerrainComparisonCanvas } from "../render/webgpu/compare/WebGPUTerrainComparison";
import { installWebGPUNpcAlphaComparison } from "../render/webgpu/npc/WebGPUNpcAlphaComparison";
import { installWebGPUNpcOpaqueComparison } from "../render/webgpu/npc/WebGPUNpcOpaqueComparison";
import { installWebGPUPlayerAlphaComparison } from "../render/webgpu/player/WebGPUPlayerAlphaComparison";
import { installWebGPUPlayerOpaqueCaptureBoundary } from "../render/webgpu/player/WebGPUPlayerOpaqueCaptureBoundary";
import { installWebGPUPlayerOpaqueComparison } from "../render/webgpu/player/WebGPUPlayerOpaqueComparison";
import { installWebGPUPlayerOpaquePassBoundaryGuard } from "../render/webgpu/player/WebGPUPlayerOpaquePassBoundary";

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
        let restoreNpcComparison: (() => void) | undefined;
        let restoreNpcAlphaComparison: (() => void) | undefined;
        let restorePlayerComparison: (() => void) | undefined;
        let restorePlayerCaptureBoundary: (() => void) | undefined;
        let restorePlayerAlphaComparison: (() => void) | undefined;
        host.appendChild(renderer.canvas);
        renderer.attachResizeObserver();
        requestAnimationFrame(() => renderer.forceResize());

        renderer.initOnce().then(() => {
            if (!active) return;
            installWebGPUPlayerOpaquePassBoundaryGuard();
            // Install NPC comparison before the player wrapper so the opaque
            // actor order is static scene -> NPC -> player, matching WebGL2.
            restoreNpcComparison = installWebGPUNpcOpaqueComparison(renderer);
            restorePlayerComparison = installWebGPUPlayerOpaqueComparison(renderer);
            restorePlayerCaptureBoundary = installWebGPUPlayerOpaqueCaptureBoundary(renderer);
            // NPC alpha installs its transparent actor phase before the existing
            // player-alpha wrapper. The resulting order is static transparency
            // -> NPC alpha -> player alpha, matching the live WebGL actor order.
            restoreNpcAlphaComparison = installWebGPUNpcAlphaComparison(renderer);
            restorePlayerAlphaComparison = installWebGPUPlayerAlphaComparison(renderer);
            const comparisonCanvas = getWebGPUTerrainComparisonCanvas(renderer);
            if (comparisonCanvas && comparisonCanvas.parentNode !== host) {
                host.appendChild(comparisonCanvas);
            }
            renderer.start();
        });

        return () => {
            active = false;
            restorePlayerAlphaComparison?.();
            restorePlayerAlphaComparison = undefined;
            restoreNpcAlphaComparison?.();
            restoreNpcAlphaComparison = undefined;
            restorePlayerCaptureBoundary?.();
            restorePlayerCaptureBoundary = undefined;
            restorePlayerComparison?.();
            restorePlayerComparison = undefined;
            restoreNpcComparison?.();
            restoreNpcComparison = undefined;
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
