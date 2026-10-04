const bzip2 = require("bzip2");

export class Bzip2 {
    static bzip2Header = new Uint8Array("BZh1".split("").map((char) => char.charCodeAt(0)));

    static decompress(compressed: Uint8Array, actualSize: number): Int8Array {
        const compressedBzip = new Uint8Array(compressed.length + 4);
        compressedBzip.set(Bzip2.bzip2Header, 0);
        compressedBzip.set(compressed, 4);

        const result = bzip2.simple(bzip2.array(compressedBzip));
        return new Int8Array(result.buffer, result.byteOffset, result.byteLength);
    }
}
