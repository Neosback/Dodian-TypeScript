import { PacketType } from './PacketType';
import { ValueType } from './ValueType';

export class Packet {
    private offset = 0;
    constructor(opcode: number, buffer: Buffer);
    constructor(opcode: number, type: PacketType, buffer: Buffer);
    constructor(opcode: number, arg2: PacketType | Buffer, arg3?: Buffer) {
        this.opcode = opcode;
        if (arg3 !== undefined) {
            this.type = arg2 as PacketType;
            this.buffer = arg3;
        } else {
            this.type = PacketType.FIXED;
            this.buffer = arg2 as Buffer;
        }
    }

    private opcode: number;
    public type: PacketType;
    private buffer: Buffer;
    private safeSlice(size: number): Buffer | null {
        if (this.offset + size > this.buffer.length) {
            return null;
        }
        const slice = this.buffer.subarray(this.offset, this.offset + size);
        this.offset += size;
        return slice;
    }

    public getOpcode(): number {
        return this.opcode;
    }

    public getBuffer(): Buffer {
        return this.buffer;
    }
    public getSize(): number {
        return this.buffer.length;
    }

    public getLength(): number {
        return this.buffer.length;
    }

    public readByte(): number {
        const slice = this.safeSlice(1);
        if (!slice) return 0;
        return slice.readUInt8(0);
    }

    public readByteA(): number {
        return this.readByte() - 128;
    }

    public readByteC(): number {
        return -this.readByte();
    }

    public readByteS(): number {
        return 128 - this.readByte();
    }

    public readUnsignedByteS(): number {
        return this.readByteS() & 0xff;
    }

    // public readBytes(bytes: number[]): Packet {
    //     this.buffer.readBytes(bytes);
    //     return this;
    // }

    public readBytes(amount: number): number[] {
        let bytes = new Array(amount);
        for (let i = 0; i < amount; i++) {
            bytes[i] = this.readByte();
        }
        return bytes;
    }

    public readBytesA(amount: number): number[] {
        if (amount < 0)
            throw new Error("The byte array amount cannot have a negative value!");
        let bytes = new Array(amount);
        for (let i = 0; i < amount; i++) {
            bytes[i] = this.readByte() + 128;
        }
        return bytes;
    }

    public readReversedBytesA(amount: number): number[] {
        let bytes = new Array(amount);
        let position = amount - 1;
        for (; position >= 0; position--) {
            bytes[position] = this.readByte() + 128;
        }
        return bytes;
    }

    public readUnsignedByte(): number {
        const slice = this.safeSlice(1);
        if (!slice) return 0;
        return slice.readUInt8(0);
    }

    public readShort(): number {
        const slice = this.safeSlice(2);
        if (!slice) return 0;
        return slice.readInt16BE(0);
    }

    public readShortA(): number {
        let value = ((this.readByte() & 0xFF) << 8) | (this.readByte() - 128 & 0xFF);
        return value > 32767 ? value - 0x10000 : value;
    }

    // ... previous code
    public readLEShort(): number {
        let value = (this.readByte() & 0xFF) | (this.readByte() & 0xFF) << 8;
        return value > 32767 ? value - 0x10000 : value;
    }

    public readLEShortA(): number {
        let value = (this.readByte() - 128 & 0xFF) | (this.readByte() & 0xFF) << 8;
        return value > 32767 ? value - 0x10000 : value;
    }

    public readUnsignedShort(): number {
        const slice = this.safeSlice(2);
        if (!slice) return 0;
        return slice.readUInt16BE(0);
    }

    public readUnsignedShortA(): number {
        let value = 0;
        value |= this.readUnsignedByte() << 8;
        value |= (this.readByte() - 128) & 0xff;
        return value;
    }

    public readInt(): number {
        const slice = this.safeSlice(4);
        if (!slice) return 0;
        return slice.readInt32BE(0);
    }

    public readSingleInt(): number {
        const firstByte = this.readByte(), secondByte = this.readByte(), thirdByte = this.readByte(), fourthByte = this.readByte();
        return ((thirdByte << 24) & 0xFF) | ((fourthByte << 16) & 0xFF) | ((firstByte << 8) & 0xFF) | (secondByte & 0xFF);
    }

    public readDoubleInt(): number {
        const firstByte = this.readByte() & 0xFF, secondByte = this.readByte() & 0xFF, thirdByte = this.readByte() & 0xFF, fourthByte = this.readByte() & 0xFF;
        return ((secondByte << 24) & 0xFF) | ((firstByte << 16) & 0xFF) | ((fourthByte << 8) & 0xFF) | (thirdByte & 0xFF);
    }

    public readTripleInt(): number {
        return ((this.readByte() << 16) & 0xFF) | ((this.readByte() << 8) & 0xFF) | (this.readByte() & 0xFF);
    }

    public readLong(): number {
        const high = this.readInt();
        const low = this.readInt();
        return high * 0x100000000 + low;
    }

    public readLongBigInt(): bigint {
        const slice = this.safeSlice(8);
        if (!slice) return 0n;
        const high = BigInt(slice.readUInt32BE(0));
        const low = BigInt(slice.readUInt32BE(4));
        return (high << 32n) | low;
    }

    public getBytesReverse(amount: number, type: ValueType): number[] {
        let data = new Array(amount);
        let dataPosition = 0;
        for (let i = this.buffer.length + amount - 1; i >= this.buffer.length; i--) {
            let value = this.buffer.readInt8(i);
            switch (type) {
                case ValueType.A:
                    value -= 128;
                    break;
                case ValueType.C:
                    value = -value;
                    break;
                case ValueType.S:
                    value = 128 - value;
                    break;
                case ValueType.STANDARD:
                    break;
            }
            data[dataPosition++] = value;
        }
        return data;
    }

    public readString(): string {
        let out = "";
        while (this.offset < this.buffer.length) {
            const b = this.buffer.readUInt8(this.offset++);
            if (b === 10) {
                break;
            }
            out += String.fromCharCode(b);
        }
        return out;
    }

    public readSmart(): number {
        return this.buffer.readInt8(this.buffer.readInt8()) < 128 ? this.readByte() & 0xFF : (this.readShort() & 0xFFFF) - 32768;
    }

    public readSignedSmart(): number {
        return this.buffer.readInt8(this.buffer.readInt8()) < 128 ? (this.readByte() & 0xFF) - 64 : (this.readShort() & 0xFFFF) - 49152;
    }

    public toString(): string {
        return `Packet - [opcode, size] : [${this.getOpcode()}, ${this.getSize()}]`;
    }

    public getType(): PacketType {
        return this.type;
    }
}
