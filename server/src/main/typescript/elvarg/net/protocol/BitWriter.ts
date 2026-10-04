// OSRS-compatible bit writer used by the primary client protocol.
export class BitWriter {
  private readonly buffer: number[] = [];
  private currentByte = 0;
  private bitOffset = 0;

  public writeBits(count: number, value: number): void {
    if (count <= 0 || count > 32) throw new RangeError(`Invalid bit count: ${count}`);
    let remaining = count;
    while (remaining > 0) {
      const free = 8 - this.bitOffset;
      const bits = Math.min(free, remaining);
      const shift = remaining - bits;
      const mask = ((value >>> shift) & ((1 << bits) - 1)) << (free - bits);
      this.currentByte |= mask;
      this.bitOffset += bits;
      remaining -= bits;
      if (this.bitOffset === 8) this.flush();
    }
  }

  public alignToByte(): void {
    if (this.bitOffset > 0) this.flush();
  }

  public toBuffer(): Buffer {
    this.alignToByte();
    return Buffer.from(this.buffer);
  }

  private flush(): void {
    this.buffer.push(this.currentByte & 0xff);
    this.currentByte = 0;
    this.bitOffset = 0;
  }
}
