import { PlayerSession } from "./PlayerSession";
import { PacketBuilder } from "./packet/PacketBuilder";

const BOT_CHANNEL = {
  readyState: 1,
  connected: true,
  send: (_payload?: unknown) => {},
  removeAllListeners: (_event?: string) => {},
  on: (_event?: string, _handler?: (...args: unknown[]) => void) => {},
  disconnect: () => {},
};

export class BotPlayerSession extends PlayerSession {
  constructor() {
    super(BOT_CHANNEL as any);
  }

  public processPackets(): void {
    // Bots do not receive network packets.
  }

  public write(_builder: PacketBuilder): void {
    // Bots do not emit outbound packets.
  }

  public flush(): void {
    // Keep bot session open.
  }

  public getChannel(): any {
    return BOT_CHANNEL;
  }
}
