// Client -> server packet size table (index = opcode).
// Copied from Java PacketDecoder.PACKET_SIZES and patched for web-client compact object interactions.
export const INBOUND_PACKET_SIZES: number[] = [
  0, 0, 6, 1, -1, -1, 2, 4, 4, 4, // 0
  4, 13, -1, -1, 8, 0, 6, 2, 2, 0, // 10
  0, 2, 0, 6, 0, 12, 0, 0, 0, 0, // 20
  9, 0, 0, 0, 0, 8, 4, 0, 0, 2, // 30
  2, 6, 0, 8, 0, -1, 0, 0, 0, 1, // 40
  0, 0, 0, 12, 0, 0, 0, 8, 0, 0, // 50
  -1, 8, 0, 0, 0, 0, 0, 0, 0, 0, // 60
  // Web client uses compact object-interaction packets (6-byte object clicks / 12-byte item-on-object)
  // where Java decoder tables often list 8/14. Keep these values in sync with web PacketSender payloads.
  6, 0, 2, 2, 8, 6, 0, -1, 0, 6, // 70
  -1, 0, 0, 0, 0, 1, 4, 6, 0, 0, // 80
  0, 0, 0, 0, 0, 3, 0, 0, -1, 0, // 90
  0, 13, 0, -1, -1, 0, 0, 0, 0, 0, // 100
  0, 0, 0, 0, 0, 0, 0, 8, 0, 0, // 110
  1, 0, 6, 0, 0, 0, -1, 0, 2, 8, // 120
  0, 4, 6, 8, 0, 8, 0, 0, 6, 2, // 130
  0, 0, 0, 0, 0, 8, 0, 0, 0, 0, // 140
  0, 0, 1, 2, 0, 2, 6, 0, 0, 0, // 150
  0, 0, 0, 0, 5, -1, 5, 0, 0, 0, // 160
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 170
  0, 8, 0, 2, 4, 4, 5, 6, 8, 1, // 180
  0, 0, 12, 0, 0, 0, 0, 0, 0, 0, // 190
  2, 0, 0, 0, 2, 0, 0, 0, 4, 0, // 200
  4, 0, 0, 0, 9, 8, 8, 0, 10, 0, // 210
  0, 0, 3, 2, 0, 0, -1, 0, 6, 1, // 220
  1, 0, 0, 0, 6, 6, 6, 8, 1, 1, // 230
  0, 4, 0, 0, 0, 0, -1, 0, -1, 4, // 240
  0, 0, 6, 6, 0, 0, // 250
];

export function getExpectedInboundPacketSize(opcode: number): number | null {
  if (!Number.isInteger(opcode) || opcode < 0 || opcode >= INBOUND_PACKET_SIZES.length) {
    return null;
  }
  return INBOUND_PACKET_SIZES[opcode];
}

export function getInboundPacketSizeOrUndefined(opcode: number): number | undefined {
  return INBOUND_PACKET_SIZES[opcode];
}
