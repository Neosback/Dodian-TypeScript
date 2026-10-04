import { PacketType } from './PacketType';
import { ByteOrder } from './ByteOrder';
import { Packet } from './Packet';


export enum ValueType {
    A,
    C,
    S,
    STANDARD
}

export enum AccessType {
    BIT,
    BYTE,
}

export class PacketBuilder {
    public static BIT_MASK = [0, 0x1, 0x3, 0x7, 0xf, 0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff, 0x3fff,
        0x7fff, 0xffff, 0x1ffff, 0x3ffff, 0x7ffff, 0xfffff, 0x1fffff, 0x3fffff, 0x7fffff, 0xffffff, 0x1ffffff, 0x3ffffff, 0x7ffffff,
        0xfffffff, 0x1fffffff, 0x3fffffff, 0x7fffffff, -1];
    private opcode: number;
    private type: PacketType;
    private bitPosition: number = 0;
    private buffers = Buffer.alloc(4096);
    private offset = 0;

    public reset(opcodeOrType?: number | PacketType, type?: PacketType): PacketBuilder {
        this.bitPosition = 0;
        this.offset = 0;
        if (typeof opcodeOrType === 'number') {
            this.opcode = opcodeOrType;
            this.type = type ?? PacketType.FIXED;
        } else {
            this.opcode = -1;
            this.type = PacketType.FIXED;
        }
        return this;
    }

    private ensureCapacity(additionalBytes: number): void {
        if (additionalBytes <= 0) {
            return;
        }
        const required = this.offset + additionalBytes;
        if (required <= this.buffers.length) {
            return;
        }

        let nextSize = this.buffers.length;
        while (nextSize < required) {
            nextSize = nextSize << 1;
        }
        const next = Buffer.alloc(nextSize);
        this.buffers.copy(next, 0, 0, this.offset);
        this.buffers = next;
    }

    constructor(opcodeOrType?: number | PacketType, type?: PacketType) {
        this.reset(opcodeOrType, type);
    }

    public writeBuffer(buffer: string | Buffer): PacketBuilder {
        const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
        this.ensureCapacity(buf.length);
        buf.copy(this.buffers, this.offset);
        this.offset += buf.length;
        return this;
    }

    public writePutBytes(buffer: string): PacketBuilder {
        return this.writeBuffer(buffer);
    }

    public putBytesReverse(data: Uint8Array): PacketBuilder {
        for (let i = data.length - 1; i >= 0; i--) {
            this.put(data[i]);
        }
        return this;
    }

    public writeByteArray(bytes: string | Buffer): PacketBuilder {
        return this.writeBuffer(bytes);
    }


    public writePutBits(numBits: number, value: number): PacketBuilder {
        const buffer = this.buffers;

        let bytePos = this.bitPosition >> 3;
        let bitOffset = 8 - (this.bitPosition & 7);
        this.bitPosition += numBits;

        for (; numBits > bitOffset; bitOffset = 8) {
            buffer[bytePos] &= ~PacketBuilder.BIT_MASK[bitOffset];
            buffer[bytePos++] |= (value >> (numBits - bitOffset)) & PacketBuilder.BIT_MASK[bitOffset];
            numBits -= bitOffset;
        }
        if (numBits == bitOffset) {
            buffer[bytePos] &= ~PacketBuilder.BIT_MASK[bitOffset];
            buffer[bytePos] |= value & PacketBuilder.BIT_MASK[bitOffset];
        } else {
            buffer[bytePos] &= ~(PacketBuilder.BIT_MASK[numBits] << (bitOffset - numBits));
            buffer[bytePos] |= (value & PacketBuilder.BIT_MASK[numBits]) << (bitOffset - numBits);
        }
        return this;
    }

    public putsBit(flag: boolean) {
        this.putBits(1, flag ? 1 : 0);
        return this;
    }

    public initializesAccess(type: AccessType) {
        switch (type) {
            case AccessType.BIT:
                this.bitPosition = this.offset * 8;
                break;
            case AccessType.BYTE:
                this.offset = Math.floor((this.bitPosition + 7) / 8);
                break;
        }
        return this;
    }

    public put(value: number): PacketBuilder {
        this.puts(value, ValueType.STANDARD);
        return this;
    }

    public putsShort(value: number, type: ValueType, order: ByteOrder): PacketBuilder {
        switch (order) {
            case ByteOrder.BIG:
                this.put(value >> 8);
                this.puts(value, type);
                break;
            case ByteOrder.MIDDLE:
                throw new Error("Middle-endian short is impossible!");
            case ByteOrder.INVERSE_MIDDLE:
                throw new Error("Inverse-middle-endian short is impossible!");
            case ByteOrder.LITTLE:
                this.puts(value, type);
                this.put(value >> 8);
                break;
            case ByteOrder.TRIPLE_INT:
                throw new Error("TRIPLE_INT short not added!");
        }
        return this;
    }

    public putTypeInt(value: number, type: ValueType = ValueType.STANDARD, order: ByteOrder = ByteOrder.BIG): PacketBuilder {
        switch (order) {
            case ByteOrder.BIG:
                this.put((value >> 24));
                this.put((value >> 16));
                this.put((value >> 8));
                this.puts(value, type);
                break;
            case ByteOrder.MIDDLE:
                this.put((value >> 8));
                this.puts(value, type);
                this.put((value >> 24));
                this.put((value >> 16));
                break;
            case ByteOrder.INVERSE_MIDDLE:
                this.put((value >> 16));
                this.put((value >> 24));
                this.puts(value, type);
                this.put((value >> 8));
                break;
            case ByteOrder.LITTLE:
                this.puts(value, type);
                this.put((value >> 8));
                this.put((value >> 16));
                this.put((value >> 24));
                break;
            case ByteOrder.TRIPLE_INT:
                this.put((value >> 16));
                this.put((value >> 8));
                this.put(value);
                break;
        }
        return this;
    }

    public putInt(value: number): PacketBuilder {
        this.putInts(value, ValueType.STANDARD, ByteOrder.BIG);
        return this;
    }

    putBytes(from: Buffer): PacketBuilder {
        for (let i = 0; i < from.length; i++) {
            this.put(from.readInt8(i));
        }
        return this;
    }

    public putsBytes(from: string): PacketBuilder {
        this.writeBuffer(from);
        return this;
    }

    public writeByteArrays(bytes: string, offset: number, length: number): PacketBuilder {
        Buffer.from(bytes).copy(this.buffers, this.offset + offset, 0, length);
        this.offset += length;
        return this;
    }

    public writeBytesArray(bytes: string): PacketBuilder {
        this.writeBuffer(bytes);
        return this;
    }

    public putBits(numBits: number, value: number): PacketBuilder {
        const buffer = this.buffers;

        let bytePos: number = this.bitPosition >> 3;
        let bitOffset: number = 8 - (this.bitPosition & 7);
        this.bitPosition += numBits;

        for (; numBits > bitOffset; bitOffset = 8) {
            buffer[bytePos] &= ~PacketBuilder.BIT_MASK[bitOffset];
            buffer[bytePos++] |= (value >> (numBits - bitOffset)) & PacketBuilder.BIT_MASK[bitOffset];
            numBits -= bitOffset;
        }

        if (numBits === bitOffset) {
            buffer[bytePos] &= ~PacketBuilder.BIT_MASK[bitOffset];
            buffer[bytePos] |= value & PacketBuilder.BIT_MASK[bitOffset];
        } else {
            buffer[bytePos] &= ~(PacketBuilder.BIT_MASK[numBits] << (bitOffset - numBits));
            buffer[bytePos] |= (value & PacketBuilder.BIT_MASK[numBits]) << (bitOffset - numBits);
        }
        return this;
    }

    public initializeAccess(type: AccessType) {
        switch (type) {
            case AccessType.BIT:
                this.bitPosition = this.offset * 8;
                break;
            case AccessType.BYTE:
                this.offset = Math.floor((this.bitPosition + 7) / 8);
                break;
        }
        return this;
    }

    public putBit(flag: boolean) {
        this.putBits(1, flag ? 1 : 0);
        return this;
    }

    public puts(value: number, type: ValueType) {
        this.ensureCapacity(1);
        switch (type) {
            case ValueType.A:
                value += 128;
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
        // Mask to byte range to mirror the Java client/server behaviour.
        this.buffers.writeUInt8(value & 0xff, this.offset++);
        return this;
    }

    public putShort(value: number, type: ValueType = ValueType.STANDARD, order: ByteOrder = ByteOrder.BIG): this {
        switch (order) {
            case ByteOrder.BIG:
                this.put(value >> 8);
                this.puts(value, type);
                break;
            case ByteOrder.MIDDLE:
                throw new Error("Middle-endian short is impossible!");
            case ByteOrder.INVERSE_MIDDLE:
                throw new Error("Inverse-middle-endian short is impossible!");
            case ByteOrder.LITTLE:
                this.puts(value, type);
                this.put(value >> 8);
                break;
            case ByteOrder.TRIPLE_INT:
                throw new Error("TRIPLE_INT short not added!");
        }
        return this;
    }

    public writePutShorts(value: number): this {
        return this.putShort(value, ValueType.STANDARD, ByteOrder.BIG);
    }

    public putShorts(value: number, order: ByteOrder): PacketBuilder {
        return this.putShort(value, ValueType.STANDARD, order);
    }

    public putInts(value: number, type: ValueType, order: ByteOrder): PacketBuilder {
        switch (order) {
            case ByteOrder.BIG:
                this.put(value >> 24);
                this.put(value >> 16);
                this.put(value >> 8);
                this.puts(value, type);
                break;
            case ByteOrder.MIDDLE:
                this.put(value >> 8);
                this.puts(value, type);
                this.put(value >> 24);
                this.put(value >> 16);
                break;
            case ByteOrder.INVERSE_MIDDLE:
                this.put(value >> 16);
                this.put(value >> 24);
                this.puts(value, type);
                this.put(value >> 8);
                break;
            case ByteOrder.LITTLE:
                this.puts(value, type);
                this.put(value >> 8);
                this.put(value >> 16);
                this.put(value >> 24);
                break;
            case ByteOrder.TRIPLE_INT:
                this.put((value >> 16));
                this.put((value >> 8));
                this.put(value);
                break;
        }
        return this;
    }

    public putInteger(value: number): this {
        this.putInts(value, ValueType.STANDARD, ByteOrder.BIG);
        return this;
    }

    public putIntegers(value: number, type: ValueType): this {
        this.putInts(value, type, ByteOrder.BIG);
        return this;
    }

    public putsInt(value: number, order: ByteOrder): this {
        this.putInts(value, ValueType.STANDARD, order);
        return this;
    }

    private toUnsignedLong(value: number | bigint): bigint {
        if (typeof value === "bigint") {
            return BigInt.asUintN(64, value);
        }
        if (!Number.isFinite(value)) {
            return 0n;
        }
        return BigInt.asUintN(64, BigInt(Math.trunc(value)));
    }

    public putsLong(value: number | bigint, type: ValueType = ValueType.STANDARD, order: ByteOrder = ByteOrder.BIG) {
        return this.putLong(value, type, order);
    }

    public putLong(value: number | bigint, type: ValueType = ValueType.STANDARD, order: ByteOrder = ByteOrder.BIG): PacketBuilder {
        const longValue = this.toUnsignedLong(value);
        switch (order) {
            case ByteOrder.BIG:
                for (let shift = 56n; shift >= 8n; shift -= 8n) {
                    this.put(Number((longValue >> shift) & 0xffn));
                }
                this.puts(Number(longValue & 0xffn), type);
                break;
            case ByteOrder.MIDDLE:
                throw new Error("Middle-endian long is not implemented!");
            case ByteOrder.INVERSE_MIDDLE:
                throw new Error("Inverse-middle-endian long is not implemented!");
            case ByteOrder.TRIPLE_INT:
                throw new Error("triple-int long is not implemented!");
            case ByteOrder.LITTLE:
                this.puts(Number(longValue & 0xffn), type);
                for (let shift = 8n; shift <= 56n; shift += 8n) {
                    this.put(Number((longValue >> shift) & 0xffn));
                }
                break;
        }
        return this;
    }

    public putString(string: string) {
        if (string == null) {
            string = "unknown";
        }
        const encoder = new TextEncoder();
        const byteArray = encoder.encode(string);
        for (let value of byteArray) {
            this.put(value);
        }
        this.put(10);
        return this;
    }

    /**
     * Gets the packet's opcode.
     *
     * @return the packets opcode.
     */
    public getOpcode(): number {
        return this.opcode;
    }

    /**
     * Gets the packet's size.
     *
     * @return the packets size.
     */
    public getSize(): number {
        return this.buffers.length;
    }

    /**
     * Gets the backing byte buffer used to read and write data.
     *
     * @return the backing byte buffer.
     */
    public buffer() {
        return this.buffer;
    }

    public getBuffer(): Buffer {
        return this.buffers.slice(0, this.offset);
    }

    /**
     * Creates the actual packet from this builder
     *
     * @return
     */
    public toPacket() {
        return new Packet(this.opcode, this.type, this.getBuffer());
    }

    public getType(): PacketType {
        return this.type;
    }
}
