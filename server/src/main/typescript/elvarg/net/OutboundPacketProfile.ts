import { PacketType } from "./packet/PacketType";

// Server -> client packet size table.
// Mirrors the web client PacketConstants.PACKET_SIZES to guarantee framing parity.
export const OUTBOUND_PACKET_SIZES: number[] = [
  0, 0, 0, 1, 6, 0, 0, 0, 4, 4, // 0
  6, 2, -2, 1, 1, -1, 1, 0, 0, 0, // 10
  0, 0, 0, 0, 1, 0, 0, -1, 1, 1, // 20
  0, 0, 0, 0, -2, 4, 3, 0, 2, 0, // 30
  0, 0, 0, 0, 7, 8, 0, 6, 0, 0, // 40
  9, 8, 0, -2, 4, 1, 0, 0, 0, 0, // 50
  -2, 1, 0, 0, 2, -2, 0, 0, 0, 0, // 60
  6, 3, 2, 4, 2, 4, 0, 0, 0, 4, // 70
  0, -2, 0, 0, 11, 2, 1, 6, 6, 0, // 80
  0, 0, 0, 0, 0, 0, 0, 2, 0, 1, // 90
  2, 2, 0, 1, -1, 8, 1, 0, 8, 0, // 100
  1, 1, 1, 1, 2, 1, 5, 15, 0, 0, // 110
  0, 4, 4, -1, 9, -1, -2, 2, 0, 0, // 120
  -1, 0, 0, 0, 13, 0, 0, 1, 0, 0, // 130
  3, 10, 2, 0, 0, 0, 0, 14, 0, 0, // 140
  0, 4, 5, 3, 0, 0, 3, 0, 0, 0, // 150
  4, 5, 0, 0, 2, 0, 6, -1, 0, 0, // 160 (167 = creation menu, variable length)
  0, 5, -2, -2, 7, 5, 10, 6, 0, -2, // 170
  0, 0, 0, 1, 1, 2, 1, -1, 0, 0, // 180
  0, 0, 0, 0, 0, 2, -1, 0, -1, 0, // 190
  4, 0, 0, 0, 0, 0, 3, 0, 4, 0, // 200
  0, 0, 0, 0, -2, 7, 0, -2, 2, 0, // 210
  0, 1, -2, -2, 0, 0, 0, 0, 0, 0, // 220
  8, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 230
  2, -2, 0, 0, -1, 0, 6, 0, 4, 3, // 240
  -1, 0, -1, -1, 6, 0, 0, // 250
];

export function getExpectedOutboundPacketSize(opcode: number): number | null {
  if (!Number.isInteger(opcode) || opcode < 0 || opcode >= OUTBOUND_PACKET_SIZES.length) {
    return null;
  }
  return OUTBOUND_PACKET_SIZES[opcode];
}

export function getExpectedOutboundPacketType(opcode: number): PacketType | null {
  const expectedSize = getExpectedOutboundPacketSize(opcode);
  if (expectedSize == null) {
    return null;
  }
  if (expectedSize === -1) {
    return PacketType.VARIABLE;
  }
  if (expectedSize === -2) {
    return PacketType.VARIABLE_SHORT;
  }
  return PacketType.FIXED;
}
