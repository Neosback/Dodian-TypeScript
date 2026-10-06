import {
    WEBGPU_BUFFER_USAGE,
    type WebGPUBindGroupLayoutLike,
    type WebGPUBindGroupLike,
    type WebGPUBufferLike,
    type WebGPUDeviceLike,
} from "../../backend/WebGPUPlatform";
import {
    WEBGPU_HEIGHT_MAP_LAYERS,
    WebGPUHeightMapResources,
} from "../loc/WebGPUHeightMapResources";

export function alignWebGPUBufferSize(byteLength: number): number {
    return Math.max(4, (Math.max(0, byteLength | 0) + 3) & ~3);
}

export interface WebGPUGrowableBufferDiagnostics {
    allocations: number;
    reuses: number;
    grows: number;
    writes: number;
    destroys: number;
    bytesUploaded: number;
    liveBuffers: number;
    liveCapacityBytes: number;
}

interface GrowableBufferEntry {
    buffer: WebGPUBufferLike;
    capacityBytes: number;
}

/**
 * Keyed growable COPY_DST buffer cache used by dynamic instance streams.
 *
 * Geometry cache ownership deliberately stays outside this helper. This only
 * centralizes the identical capacity-growth/write/disposal mechanics that were
 * previously repeated by every dynamic comparison runtime.
 */
export class WebGPUGrowableBufferCache {
    private readonly entries = new Map<string, GrowableBufferEntry>();
    private readonly diagnostics: WebGPUGrowableBufferDiagnostics = {
        allocations: 0,
        reuses: 0,
        grows: 0,
        writes: 0,
        destroys: 0,
        bytesUploaded: 0,
        liveBuffers: 0,
        liveCapacityBytes: 0,
    };

    constructor(
        private readonly device: WebGPUDeviceLike,
        private readonly labelPrefix: string,
        private readonly usage = WEBGPU_BUFFER_USAGE.VERTEX | WEBGPU_BUFFER_USAGE.COPY_DST,
    ) {}

    getOrWrite(
        key: string,
        data: ArrayBuffer | ArrayBufferView,
    ): WebGPUBufferLike | undefined {
        const byteLength = data.byteLength | 0;
        if (byteLength <= 0) return undefined;

        const required = alignWebGPUBufferSize(byteLength);
        let entry = this.entries.get(key);
        if (!entry || entry.capacityBytes < required) {
            const previousCapacity = entry?.capacityBytes ?? 0;
            if (entry) {
                entry.buffer.destroy?.();
                this.diagnostics.destroys++;
                this.diagnostics.grows++;
                this.diagnostics.liveCapacityBytes -= previousCapacity;
            }

            const capacityBytes = Math.max(
                required,
                previousCapacity > 0 ? previousCapacity * 2 : required,
            );
            entry = {
                buffer: this.device.createBuffer({
                    label: `${this.labelPrefix}-${key}`,
                    size: capacityBytes,
                    usage: this.usage,
                }),
                capacityBytes,
            };
            this.entries.set(key, entry);
            this.diagnostics.allocations++;
            if (previousCapacity === 0) this.diagnostics.liveBuffers++;
            this.diagnostics.liveCapacityBytes += capacityBytes;
        } else {
            this.diagnostics.reuses++;
        }

        this.device.queue.writeBuffer(entry.buffer, 0, data);
        this.diagnostics.writes++;
        this.diagnostics.bytesUploaded += byteLength;
        return entry.buffer;
    }

    getDiagnostics(): WebGPUGrowableBufferDiagnostics {
        return { ...this.diagnostics };
    }

    dispose(): void {
        for (const entry of this.entries.values()) {
            entry.buffer.destroy?.();
            this.diagnostics.destroys++;
        }
        this.entries.clear();
        this.diagnostics.liveBuffers = 0;
        this.diagnostics.liveCapacityBytes = 0;
    }
}

export interface WebGPUHeightBindGroupCacheDiagnostics {
    allocations: number;
    reuses: number;
    replacements: number;
    releases: number;
    liveEntries: number;
}

export interface WebGPUHeightBindGroupCacheEntry {
    source: Int16Array;
    size: number;
    heightMap: WebGPUHeightMapResources;
    bindGroup: WebGPUBindGroupLike;
}

/**
 * Per-layout bind-group cache for signed dynamic height maps.
 *
 * WebGPUHeightMapResources shares the underlying texture globally by
 * (device, source identity, size). This class layers stable bind-group reuse on
 * top once a runtime supplies its height bind-group layout.
 */
export class WebGPUDynamicHeightBindGroupCache {
    private readonly entries = new Map<number, WebGPUHeightBindGroupCacheEntry>();
    private readonly diagnostics: WebGPUHeightBindGroupCacheDiagnostics = {
        allocations: 0,
        reuses: 0,
        replacements: 0,
        releases: 0,
        liveEntries: 0,
    };

    constructor(
        private readonly device: WebGPUDeviceLike,
        private readonly layout: WebGPUBindGroupLayoutLike,
        private readonly labelPrefix: string,
    ) {}

    get(
        key: number,
        source: Int16Array | undefined,
        size: number,
    ): WebGPUHeightBindGroupCacheEntry | undefined {
        const safeSize = size | 0;
        if (!source || safeSize <= 0) return undefined;

        const existing = this.entries.get(key);
        if (existing && existing.source === source && existing.size === safeSize) {
            this.diagnostics.reuses++;
            return existing;
        }

        if (existing) {
            existing.heightMap.dispose();
            this.diagnostics.replacements++;
            this.diagnostics.releases++;
        } else {
            this.diagnostics.liveEntries++;
        }

        const heightMap = new WebGPUHeightMapResources(this.device, safeSize, source);
        const bindGroup = this.device.createBindGroup({
            label: `${this.labelPrefix}-${key}-height-bind-group`,
            layout: this.layout,
            entries: [
                {
                    binding: 0,
                    resource: heightMap.texture.createView({
                        dimension: "2d-array",
                        baseArrayLayer: 0,
                        arrayLayerCount: WEBGPU_HEIGHT_MAP_LAYERS,
                    }),
                },
            ],
        });
        const entry = { source, size: safeSize, heightMap, bindGroup };
        this.entries.set(key, entry);
        this.diagnostics.allocations++;
        return entry;
    }

    getDiagnostics(): WebGPUHeightBindGroupCacheDiagnostics {
        return { ...this.diagnostics };
    }

    dispose(): void {
        for (const entry of this.entries.values()) {
            entry.heightMap.dispose();
            this.diagnostics.releases++;
        }
        this.entries.clear();
        this.diagnostics.liveEntries = 0;
    }
}
