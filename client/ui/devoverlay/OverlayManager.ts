import { profiler } from "../../render/PerformanceProfiler";
import type { SceneViewportRect } from "../../render/render/viewportRect";
import type { OverlayCommandExecutor } from "../../render/frame/OverlayCommandExecutor";
import type { OverlayDrawCommand } from "../../render/frame/OverlayDrawCommand";
import { Overlay, OverlayInitArgs, OverlayUpdateArgs, RenderPhase } from "./Overlay";

// PERF: Per-overlay timing for debugging
const overlayTimings: Map<string, number> = new Map();
let lastLogTime = 0;
const LOG_INTERVAL_MS = 1000;

interface OverlaySlot {
    overlay: Overlay;
    clipToViewport: boolean;
    command: OverlayDrawCommand;
}

export class OverlayManager {
    private slots: OverlaySlot[] = [];

    constructor(private readonly commandExecutor: OverlayCommandExecutor) {}

    add(overlay: Overlay, clipToViewport = true): this {
        const overlayIndex = this.slots.length;
        this.slots.push({
            overlay,
            clipToViewport,
            command: {
                overlayIndex,
                phase: RenderPhase.PostPresent,
                clipEnabled: false,
                clipRect: { x: 0, y: 0, width: 0, height: 0 },
            },
        });
        return this;
    }

    init(args: OverlayInitArgs): void {
        for (const slot of this.slots) slot.overlay.init(args);
    }

    update(args: OverlayUpdateArgs): void {
        if (!profiler.enabled) {
            for (const slot of this.slots) slot.overlay.update(args);
            return;
        }

        const start = performance.now();
        for (const slot of this.slots) slot.overlay.update(args);
        profiler.recordGauge("overlayUpdateMs", performance.now() - start);
    }

    draw(phase: RenderPhase, viewport?: SceneViewportRect): void {
        if (!profiler.enabled) {
            for (const slot of this.slots) this.executeSlot(slot, phase, viewport);
            return;
        }

        // Profile each overlay
        for (const slot of this.slots) {
            const name = slot.overlay.constructor.name;
            const start = performance.now();
            this.executeSlot(slot, phase, viewport);
            const elapsed = performance.now() - start;
            overlayTimings.set(name, (overlayTimings.get(name) ?? 0) + elapsed);
        }

        // Log breakdown every second
        const now = performance.now();
        if (now - lastLogTime > LOG_INTERVAL_MS) {
            lastLogTime = now;
            if (profiler.verbose && overlayTimings.size > 0) {
                const sorted = [...overlayTimings.entries()]
                    .filter(([_, ms]) => ms > 0.1)
                    .sort((a, b) => b[1] - a[1]);
                const total = sorted.reduce((sum, [_, ms]) => sum + ms, 0);
                const breakdown = sorted
                    .map(
                        ([name, ms]) =>
                            `${name}: ${ms.toFixed(1)}ms (${((ms / total) * 100).toFixed(0)}%)`,
                    )
                    .join(" | ");
                console.log(`[PERF] Overlay breakdown (${total.toFixed(1)}ms total): ${breakdown}`);
            }
            overlayTimings.clear();
        }
    }

    private executeSlot(
        slot: OverlaySlot,
        phase: RenderPhase,
        viewport?: SceneViewportRect,
    ): void {
        const command = slot.command;
        command.phase = phase;
        command.clipEnabled = slot.clipToViewport && viewport !== undefined;

        if (command.clipEnabled && viewport) {
            command.clipRect.x = viewport.x;
            command.clipRect.y = viewport.y;
            command.clipRect.width = viewport.width;
            command.clipRect.height = viewport.height;
        }

        this.commandExecutor.execute(command, slot.overlay);
    }

    dispose(): void {
        for (const slot of this.slots) slot.overlay.dispose();
        this.slots.length = 0;
        this.commandExecutor.dispose?.();
    }
}
