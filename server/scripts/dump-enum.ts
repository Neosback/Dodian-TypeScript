// Dumps a cache enum's key -> value pairs.
//
//   yarn dump:enum <enumId>        # e.g. yarn dump:enum 255
//
// Enums are how the cache's own scripts look things up per skill, per equipment slot, and
// so on - enum 255 maps a skill to its icon sprite, enum 904 maps an equipment slot to the
// silhouette shown while it is empty. When a clientscript reads a table you need to match,
// this is how you read it too. Find the enum id in the script with `yarn dump:cs2`.
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { ByteBuffer } from "../src/main/typescript/elvarg/game/cache/codec/rs/io/ByteBuffer";
import { ConfigType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/ConfigType";

type EnumType = {
    keyType: string;
    valueType: string;
    defaultValue: number | string;
    values: Map<number, number | string>;
};

function decodeEnum(data: Int8Array): EnumType {
    const buf = new ByteBuffer(data);
    const result: EnumType = {
        keyType: "",
        valueType: "",
        defaultValue: 0,
        values: new Map(),
    };
    for (;;) {
        const opcode = buf.readUnsignedByte();
        if (opcode === 0) break;
        if (opcode === 1) result.keyType = String.fromCharCode(buf.readUnsignedByte());
        else if (opcode === 2) result.valueType = String.fromCharCode(buf.readUnsignedByte());
        else if (opcode === 3) result.defaultValue = buf.readString();
        else if (opcode === 4) result.defaultValue = buf.readInt();
        else if (opcode === 5 || opcode === 6) {
            const size = buf.readUnsignedShort();
            for (let i = 0; i < size; i++) {
                const key = buf.readInt();
                result.values.set(key, opcode === 5 ? buf.readString() : buf.readInt());
            }
        } else if (opcode === 7 || opcode === 8) {
            buf.readUnsignedShort();
            const size = buf.readUnsignedShort();
            for (let i = 0; i < size; i++) {
                const key = buf.readUnsignedShort();
                result.values.set(key, opcode === 7 ? buf.readString() : buf.readInt());
            }
        } else break;
    }
    return result;
}

async function main() {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const index = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore());
    for (const arg of process.argv.slice(2)) {
        const enumId = Number(arg);
        const file = index.getFile(ConfigType.DAT2.enums, enumId);
        if (!file) {
            console.log(`; enum ${enumId} MISSING`);
            continue;
        }
        const decoded = decodeEnum(new Int8Array(file.data));
        console.log(
            `; enum ${enumId} key=${decoded.keyType || "?"} value=${decoded.valueType || "?"} ` +
                `default=${JSON.stringify(decoded.defaultValue)} entries=${decoded.values.size}`
        );
        for (const [key, value] of [...decoded.values].sort((a, b) => a[0] - b[0])) {
            console.log(`  ${key} -> ${JSON.stringify(value)}`);
        }
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
