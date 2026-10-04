import fs = require("fs");
import path = require("path");
import { ByteBuffer } from "../../io/ByteBuffer";
import { ApiType } from "../ApiType";
import { CacheFiles } from "../CacheFiles";
import { CacheIndex } from "../CacheIndex";
import { CacheStore } from "./CacheStore";
import { Sector } from "./Sector";
import { SectorCluster } from "./SectorCluster";

/** Keeps small index files in memory while reading the large data file on demand. */
export class FileStore implements CacheStore<ApiType.SYNC> {
    private readonly dataFile: number;
    private readonly dataFileSize: number;
    private readonly indexFiles = new Map<number, Int8Array>();
    private readonly hasMetaIndex: boolean;

    constructor(directory: string) {
        const dataPath = path.join(directory, CacheFiles.DAT2_FILE_NAME);
        this.dataFile = fs.openSync(dataPath, "r");
        this.dataFileSize = fs.statSync(dataPath).size;
        for (const name of fs.readdirSync(directory)) {
            if (!name.startsWith(CacheFiles.INDEX_FILE_PREFIX)) continue;
            const indexId = Number(name.slice(CacheFiles.INDEX_FILE_PREFIX.length));
            if (!Number.isInteger(indexId) || indexId < 0) continue;
            const contents = fs.readFileSync(path.join(directory, name));
            this.indexFiles.set(indexId, new Int8Array(
                contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength),
            ));
        }
        this.hasMetaIndex = this.indexFiles.has(CacheIndex.META_INDEX_ID);
    }

    read(indexId: number, archiveId: number): Int8Array {
        const index = this.indexFiles.get(indexId);
        if (!index) throw new Error(`Index ${indexId} not found`);
        const clusterOffset = archiveId * SectorCluster.SIZE;
        if (clusterOffset < 0 || clusterOffset + SectorCluster.SIZE > index.length) {
            throw new Error(`Invalid ptr: ${clusterOffset}, fileSize: ${index.length}, indexId: ${indexId}, archiveId: ${archiveId}`);
        }
        const cluster = SectorCluster.decode(new ByteBuffer(index.slice(clusterOffset, clusterOffset + SectorCluster.SIZE)));
        const data = new Int8Array(cluster.size);
        const sectorIndexId = this.hasMetaIndex ? indexId : indexId + 1;
        const extended = archiveId > 65535;
        const headerSize = extended ? Sector.EXTENDED_HEADER_SIZE : Sector.HEADER_SIZE;
        const sectorDataSize = extended ? Sector.EXTENDED_DATA_SIZE : Sector.DATA_SIZE;
        let chunk = 0;
        let remaining = cluster.size;
        let sectorOffset = cluster.sector * Sector.SIZE;

        while (remaining > 0) {
            const dataSize = Math.min(sectorDataSize, remaining);
            const sectorBytes = this.readData(sectorOffset, headerSize + dataSize);
            const sectorBuffer = new ByteBuffer(sectorBytes);
            const sector = extended
                ? Sector.decodeExtended(new Sector(), sectorBuffer, dataSize)
                : Sector.decode(new Sector(), sectorBuffer, dataSize);
            if (sector.indexId !== sectorIndexId || sector.archiveId !== archiveId || sector.chunk !== chunk) {
                throw new Error(`Invalid cache sector for index ${indexId}, archive ${archiveId}`);
            }
            data.set(sector.data, cluster.size - remaining);
            remaining -= dataSize;
            chunk++;
            sectorOffset = sector.nextSector * Sector.SIZE;
        }
        return data;
    }

    close(): void {
        fs.closeSync(this.dataFile);
    }

    private readData(offset: number, length: number): Int8Array {
        if (offset < 0 || offset + length > this.dataFileSize) {
            throw new Error(`Invalid cache sector offset ${offset}`);
        }
        const bytes = new Int8Array(length);
        if (fs.readSync(this.dataFile, bytes, 0, length, offset) !== length) {
            throw new Error(`Short cache read at ${offset}`);
        }
        return bytes;
    }
}
