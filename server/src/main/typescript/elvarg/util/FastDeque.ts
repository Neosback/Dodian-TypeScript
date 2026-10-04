export class FastDeque<T> {
  private store: Record<number, T> = Object.create(null);
  private head = 0;
  private tail = 0;

  public get length(): number {
    return this.tail - this.head;
  }

  public push(value: T): void {
    this.store[this.tail++] = value;
  }

  public unshift(value: T): void {
    this.store[--this.head] = value;
  }

  public shift(): T | undefined {
    if (this.tail === this.head) {
      return undefined;
    }
    const index = this.head++;
    const value = this.store[index];
    delete this.store[index];
    if (this.tail === this.head) {
      this.head = 0;
      this.tail = 0;
    }
    return value;
  }

  public peekFirst(): T | undefined {
    return this.tail === this.head ? undefined : this.store[this.head];
  }

  public peekLast(): T | undefined {
    if (this.tail === this.head) {
      return undefined;
    }
    return this.store[this.tail - 1];
  }

  public clear(): void {
    this.store = Object.create(null);
    this.head = 0;
    this.tail = 0;
  }

  public toArray(): T[] {
    const values: T[] = [];
    for (let index = this.head; index < this.tail; index++) {
      if (index in this.store) {
        values.push(this.store[index]);
      }
    }
    return values;
  }
}
