export function toSigned16bit(value: number): number {
    return (value << 16) >> 16;
}
