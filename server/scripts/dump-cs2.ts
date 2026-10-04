// Disassembles clientscripts straight out of the active cache.
// Usage: TS_NODE_COMPILER_OPTIONS='{"target":"es2020"}' ts-node ./scripts/dump-cs2.ts <scriptId...>
import fs = require("fs");
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { ByteBuffer } from "../src/main/typescript/elvarg/game/cache/codec/rs/io/ByteBuffer";

const OPCODES_TS = path.resolve(__dirname, "../../client/rs/cs2/Opcodes.ts");
const opNames = new Map<number, string>();
for (const line of fs.readFileSync(OPCODES_TS, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(\d+),/.exec(line);
    if (m) opNames.set(Number(m[2]), m[1].toLowerCase());
}

const SCONST = 3, RETURN = 21, POP_INT = 38, POP_OBJECT = 39, LCONST = 61, POP_LONG = 62, PUSH_NULL = 63, SWITCH = 60;

function disassemble(id: number, data: Int8Array): string {
    const buf = new ByteBuffer(data);
    buf.offset = buf.length - 2;
    const switchLength = buf.readUnsignedShort();
    const endIdx = buf.length - 2 - switchLength - 12;
    buf.offset = endIdx;
    const numOpcodes = buf.readInt();
    const localIntCount = buf.readUnsignedShort();
    const localObjCount = buf.readUnsignedShort();
    const intArgCount = buf.readUnsignedShort();
    const objArgCount = buf.readUnsignedShort();

    const switches: Map<number, number>[] = [];
    const numSwitches = buf.readUnsignedByte();
    for (let i = 0; i < numSwitches; ++i) {
        const m = new Map<number, number>();
        let count = buf.readUnsignedShort();
        while (count-- > 0) m.set(buf.readInt(), buf.readInt());
        switches.push(m);
    }

    buf.offset = 0;
    const name = buf.readNullString();

    const out: string[] = [
        `; script ${id} name=${name} ops=${numOpcodes} localInt=${localIntCount} localObj=${localObjCount} intArgs=${intArgCount} objArgs=${objArgCount}`,
    ];
    for (let i = 0; buf.offset < endIdx; ++i) {
        const opcode = buf.readUnsignedShort();
        let operand: string;
        switch (opcode) {
            case SCONST:
                operand = JSON.stringify(buf.readString());
                break;
            case LCONST:
                operand = `${buf.readInt()}:${buf.readInt()}`;
                break;
            case RETURN: case POP_INT: case POP_OBJECT: case POP_LONG: case PUSH_NULL:
                operand = String(buf.readUnsignedByte());
                break;
            default:
                operand = String(opcode < 100 ? buf.readInt() : buf.readUnsignedByte());
                break;
        }
        let line = `${String(i).padStart(5)}  ${(opNames.get(opcode) ?? `op${opcode}`).padEnd(24)} ${operand}`;
        if (opcode === SWITCH) {
            const table = switches[Number(operand)];
            if (table) line += `  { ${[...table].map(([k, v]) => `${k} -> ${i + 1 + v}`).join(", ")} }`;
        }
        out.push(line);
    }
    return out.join("\n");
}

async function main() {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const index = CacheIndexDat2.fromStore(IndexType.DAT2.clientScript, CachePipeline.getStore());
    for (const arg of process.argv.slice(2)) {
        const id = Number(arg);
        const file = index.getFileSmart(id);
        if (!file) {
            console.log(`; script ${id} MISSING`);
            continue;
        }
        console.log(disassemble(id, new Int8Array(file.data)));
        console.log("");
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
