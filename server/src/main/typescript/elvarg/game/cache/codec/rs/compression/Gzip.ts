import { gunzipSync } from "zlib";

export class Gzip {
    static async initWasm(): Promise<void> {}

    static decompress(compressed: Uint8Array): Int8Array {
        const buffer = gunzipSync(compressed);
        return new Int8Array(buffer.buffer, buffer.byteOffset, buffer.length);
    }
}
