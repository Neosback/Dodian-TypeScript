import type { WebGPURenderPassEncoderLike } from "../../backend/WebGPUPlatform";

export interface WebGPUDynamicPhaseCounters {
    /** Number of frames in which this phase handler was invoked. */
    attempted: number;
    /** Number of invoked frames that emitted at least one GPU draw call. */
    drawn: number;
    /** Number of invoked frames that emitted no GPU draw calls. */
    skipped: number;
    /** Total draw()/drawIndexed() calls emitted by this phase. */
    drawCalls: number;
}

export function emptyWebGPUDynamicPhaseCounters(): WebGPUDynamicPhaseCounters {
    return { attempted: 0, drawn: 0, skipped: 0, drawCalls: 0 };
}

export function addWebGPUDynamicPhaseSample(
    counters: WebGPUDynamicPhaseCounters,
    drawCalls: number,
): void {
    counters.attempted++;
    counters.drawCalls += Math.max(0, drawCalls | 0);
    if (drawCalls > 0) counters.drawn++;
    else counters.skipped++;
}

/**
 * Count GPU draw submissions without changing the render-pass API seen by a
 * dynamic phase. Function properties are rebound to the real encoder so WebGPU
 * brand checks still receive the native target as `this`.
 */
export function trackWebGPUDynamicPhaseDrawCalls(
    pass: WebGPURenderPassEncoderLike,
): { pass: WebGPURenderPassEncoderLike; getDrawCalls: () => number } {
    let drawCalls = 0;
    const tracked = new Proxy(pass as object, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== "function") return value;
            if (property === "draw" || property === "drawIndexed") {
                return (...args: unknown[]) => {
                    drawCalls++;
                    return value.apply(target, args);
                };
            }
            return value.bind(target);
        },
    }) as WebGPURenderPassEncoderLike;
    return { pass: tracked, getDrawCalls: () => drawCalls };
}
