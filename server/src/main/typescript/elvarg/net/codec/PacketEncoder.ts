import { IsaacRandom } from "../security/IsaacRandom";
import { Packet } from "../packet/Packet";
import { PacketType } from "../packet/PacketType";
import { getExpectedOutboundPacketSize } from "../OutboundPacketProfile";

export class PacketEncoder {
    private encoder: IsaacRandom;

    constructor(encoder: IsaacRandom) {
        this.encoder = encoder;
    }

    public encode(packet: Packet): Buffer {
        const opcode = (packet.getOpcode() + this.encoder.nextInt()) & 0xff;
        const type = packet.getType();
        const size = packet.getSize();

        if (type === PacketType.FIXED) {
            const currSize = getExpectedOutboundPacketSize(packet.getOpcode());
            if (currSize == null) {
                console.error(`{PacketEncoder} Opcode ${packet.getOpcode()} has no defined size.`);
                return null;
            }
            if (size !== currSize) {
                console.error(`{PacketEncoder} Opcode ${packet.getOpcode()} has defined size ${currSize} but is actually ${size}.`);
                return null;
            }
        } else if (type === PacketType.VARIABLE) {
            const currSize = getExpectedOutboundPacketSize(packet.getOpcode());
            if (currSize == null) {
                console.error(`{PacketEncoder} Opcode ${packet.getOpcode()} has no defined size.`);
                return null;
            }
            if (currSize !== -1) {
                console.error(`{PacketEncoder} Opcode ${packet.getOpcode()}'s size needs to be -1, it's currently ${currSize}.`);
                return null;
            }
        } else if (type === PacketType.VARIABLE_SHORT) {
            const currSize = getExpectedOutboundPacketSize(packet.getOpcode());
            if (currSize == null) {
                console.error(`{PacketEncoder} Opcode ${packet.getOpcode()} has no defined size.`);
                return null;
            }
            if (currSize !== -2) {
                console.error(`{PacketEncoder} Opcode ${packet.getOpcode()}'s size needs to be -2, it's currently ${currSize}.`);
                return null;
            }
        }

        let finalSize = size + 1;
        switch (type) {
            case PacketType.VARIABLE:
                if (size > 255) {
                    throw new Error(`Tried to send packet length ${size} in variable-byte packet`);
                }
                finalSize++;
                break;
            case PacketType.VARIABLE_SHORT:
                if (size > 65535) {
                    throw new Error(`Tried to send packet length ${size} in variable-short packet`);
                }
                finalSize += 2;
                break;
            default:
                break;
        }

        const buffer = Buffer.allocUnsafe(finalSize);
        buffer.writeUInt8(opcode);

        switch (type) {
            case PacketType.VARIABLE:
                buffer.writeUInt8(size, 1);
                break;
            case PacketType.VARIABLE_SHORT:
                buffer.writeUInt16BE(size, 1);
                break;
            default:
                break;
        }

        // Write packet
        buffer.set(packet.getBuffer(), finalSize - size - 1);

        return buffer;
    }
}
