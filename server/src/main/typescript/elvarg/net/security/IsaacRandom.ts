export class IsaacRandom {
  private static readonly GOLDEN_RATIO = 0x9e3779b9 | 0;
  private static readonly LOG_SIZE = 8;
  private static readonly SIZE = 1 << IsaacRandom.LOG_SIZE;
  private static readonly MASK = ((IsaacRandom.SIZE - 1) << 2) | 0;
  private readonly results: number[] = new Array(IsaacRandom.SIZE).fill(0);
  private readonly state: number[] = new Array(IsaacRandom.SIZE).fill(0);
  private count: number = IsaacRandom.SIZE;
  private accumulator = 0;
  private last = 0;
  private counter = 0;

  public constructor(seed: number[]) {
    const length = Math.min(seed.length, this.results.length);
    for (let i = 0; i < length; i++) {
      this.results[i] = seed[i] | 0;
    }
    this.init();
  }

  private isaac() {
    let i: number;
    let j: number;
    let x: number;
    let y: number;

    this.last = (this.last + ((++this.counter) | 0)) | 0;

    for (i = 0, j = IsaacRandom.SIZE / 2; i < IsaacRandom.SIZE / 2;) {
      x = this.state[i] | 0;
      this.accumulator = (this.accumulator ^ (this.accumulator << 13)) | 0;
      this.accumulator = (this.accumulator + this.state[j++]) | 0;
      this.state[i] = y =
        (this.state[(x & IsaacRandom.MASK) >>> 2] + this.accumulator + this.last) | 0;
      this.results[i++] = this.last =
        (this.state[((y >>> IsaacRandom.LOG_SIZE) & IsaacRandom.MASK) >>> 2] + x) | 0;

      x = this.state[i] | 0;
      this.accumulator = (this.accumulator ^ (this.accumulator >>> 6)) | 0;
      this.accumulator = (this.accumulator + this.state[j++]) | 0;
      this.state[i] = y =
        (this.state[(x & IsaacRandom.MASK) >>> 2] + this.accumulator + this.last) | 0;
      this.results[i++] = this.last =
        (this.state[((y >>> IsaacRandom.LOG_SIZE) & IsaacRandom.MASK) >>> 2] + x) | 0;

      x = this.state[i] | 0;
      this.accumulator = (this.accumulator ^ (this.accumulator << 2)) | 0;
      this.accumulator = (this.accumulator + this.state[j++]) | 0;
      this.state[i] = y =
        (this.state[(x & IsaacRandom.MASK) >>> 2] + this.accumulator + this.last) | 0;
      this.results[i++] = this.last =
        (this.state[((y >>> IsaacRandom.LOG_SIZE) & IsaacRandom.MASK) >>> 2] + x) | 0;

      x = this.state[i] | 0;
      this.accumulator = (this.accumulator ^ (this.accumulator >>> 16)) | 0;
      this.accumulator = (this.accumulator + this.state[j++]) | 0;
      this.state[i] = y =
        (this.state[(x & IsaacRandom.MASK) >>> 2] + this.accumulator + this.last) | 0;
      this.results[i++] = this.last =
        (this.state[((y >>> IsaacRandom.LOG_SIZE) & IsaacRandom.MASK) >>> 2] + x) | 0;
    }

    for (j = 0; j < IsaacRandom.SIZE / 2;) {
      x = this.state[i] | 0;
      this.accumulator = (this.accumulator ^ (this.accumulator << 13)) | 0;
      this.accumulator = (this.accumulator + this.state[j++]) | 0;
      this.state[i] = y =
        (this.state[(x & IsaacRandom.MASK) >>> 2] + this.accumulator + this.last) | 0;
      this.results[i++] = this.last =
        (this.state[((y >>> IsaacRandom.LOG_SIZE) & IsaacRandom.MASK) >>> 2] + x) | 0;

      x = this.state[i] | 0;
      this.accumulator = (this.accumulator ^ (this.accumulator >>> 6)) | 0;
      this.accumulator = (this.accumulator + this.state[j++]) | 0;
      this.state[i] = y =
        (this.state[(x & IsaacRandom.MASK) >>> 2] + this.accumulator + this.last) | 0;
      this.results[i++] = this.last =
        (this.state[((y >>> IsaacRandom.LOG_SIZE) & IsaacRandom.MASK) >>> 2] + x) | 0;

      x = this.state[i] | 0;
      this.accumulator = (this.accumulator ^ (this.accumulator << 2)) | 0;
      this.accumulator = (this.accumulator + this.state[j++]) | 0;
      this.state[i] = y =
        (this.state[(x & IsaacRandom.MASK) >>> 2] + this.accumulator + this.last) | 0;
      this.results[i++] = this.last =
        (this.state[((y >>> IsaacRandom.LOG_SIZE) & IsaacRandom.MASK) >>> 2] + x) | 0;

      x = this.state[i] | 0;
      this.accumulator = (this.accumulator ^ (this.accumulator >>> 16)) | 0;
      this.accumulator = (this.accumulator + this.state[j++]) | 0;
      this.state[i] = y =
        (this.state[(x & IsaacRandom.MASK) >>> 2] + this.accumulator + this.last) | 0;
      this.results[i++] = this.last =
        (this.state[((y >>> IsaacRandom.LOG_SIZE) & IsaacRandom.MASK) >>> 2] + x) | 0;
    }
  }

  private init() {
    let i: number;
    let a: number;
    let b: number;
    let c: number;
    let d: number;
    let e: number;
    let f: number;
    let g: number;
    let h: number;

    a = b = c = d = e = f = g = h = IsaacRandom.GOLDEN_RATIO;

    for (i = 0; i < 4; ++i) {
      a = (a ^ (b << 11)) | 0;
      d = (d + a) | 0;
      b = (b + c) | 0;
      b = (b ^ (c >>> 2)) | 0;
      e = (e + b) | 0;
      c = (c + d) | 0;
      c = (c ^ (d << 8)) | 0;
      f = (f + c) | 0;
      d = (d + e) | 0;
      d = (d ^ (e >>> 16)) | 0;
      g = (g + d) | 0;
      e = (e + f) | 0;
      e = (e ^ (f << 10)) | 0;
      h = (h + e) | 0;
      f = (f + g) | 0;
      f = (f ^ (g >>> 4)) | 0;
      a = (a + f) | 0;
      g = (g + h) | 0;
      g = (g ^ (h << 8)) | 0;
      b = (b + g) | 0;
      h = (h + a) | 0;
      h = (h ^ (a >>> 9)) | 0;
      c = (c + h) | 0;
      a = (a + b) | 0;
    }

    for (i = 0; i < IsaacRandom.SIZE; i += 8) {
      a = (a + this.results[i]) | 0;
      b = (b + this.results[i + 1]) | 0;
      c = (c + this.results[i + 2]) | 0;
      d = (d + this.results[i + 3]) | 0;
      e = (e + this.results[i + 4]) | 0;
      f = (f + this.results[i + 5]) | 0;
      g = (g + this.results[i + 6]) | 0;
      h = (h + this.results[i + 7]) | 0;

      a = (a ^ (b << 11)) | 0;
      d = (d + a) | 0;
      b = (b + c) | 0;
      b = (b ^ (c >>> 2)) | 0;
      e = (e + b) | 0;
      c = (c + d) | 0;
      c = (c ^ (d << 8)) | 0;
      f = (f + c) | 0;
      d = (d + e) | 0;
      d = (d ^ (e >>> 16)) | 0;
      g = (g + d) | 0;
      e = (e + f) | 0;
      e = (e ^ (f << 10)) | 0;
      h = (h + e) | 0;
      f = (f + g) | 0;
      f = (f ^ (g >>> 4)) | 0;
      a = (a + f) | 0;
      g = (g + h) | 0;
      g = (g ^ (h << 8)) | 0;
      b = (b + g) | 0;
      h = (h + a) | 0;
      h = (h ^ (a >>> 9)) | 0;
      c = (c + h) | 0;
      a = (a + b) | 0;

      this.state[i] = a;
      this.state[i + 1] = b;
      this.state[i + 2] = c;
      this.state[i + 3] = d;
      this.state[i + 4] = e;
      this.state[i + 5] = f;
      this.state[i + 6] = g;
      this.state[i + 7] = h;
    }

    for (i = 0; i < IsaacRandom.SIZE; i += 8) {
      a = (a + this.state[i]) | 0;
      b = (b + this.state[i + 1]) | 0;
      c = (c + this.state[i + 2]) | 0;
      d = (d + this.state[i + 3]) | 0;
      e = (e + this.state[i + 4]) | 0;
      f = (f + this.state[i + 5]) | 0;
      g = (g + this.state[i + 6]) | 0;
      h = (h + this.state[i + 7]) | 0;

      a = (a ^ (b << 11)) | 0;
      d = (d + a) | 0;
      b = (b + c) | 0;
      b = (b ^ (c >>> 2)) | 0;
      e = (e + b) | 0;
      c = (c + d) | 0;
      c = (c ^ (d << 8)) | 0;
      f = (f + c) | 0;
      d = (d + e) | 0;
      d = (d ^ (e >>> 16)) | 0;
      g = (g + d) | 0;
      e = (e + f) | 0;
      e = (e ^ (f << 10)) | 0;
      h = (h + e) | 0;
      f = (f + g) | 0;
      f = (f ^ (g >>> 4)) | 0;
      a = (a + f) | 0;
      g = (g + h) | 0;
      g = (g ^ (h << 8)) | 0;
      b = (b + g) | 0;
      h = (h + a) | 0;
      h = (h ^ (a >>> 9)) | 0;
      c = (c + h) | 0;
      a = (a + b) | 0;

      this.state[i] = a;
      this.state[i + 1] = b;
      this.state[i + 2] = c;
      this.state[i + 3] = d;
      this.state[i + 4] = e;
      this.state[i + 5] = f;
      this.state[i + 6] = g;
      this.state[i + 7] = h;
    }

    this.isaac();
  }

  public nextInt(): number {
    if (0 === this.count--) {
      this.isaac();
      this.count = IsaacRandom.SIZE - 1;
    }
    return this.results[this.count] | 0;
  }
}
