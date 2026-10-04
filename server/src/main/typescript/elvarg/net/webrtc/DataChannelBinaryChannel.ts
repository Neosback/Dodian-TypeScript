import { isIP } from "net";
import type { RTCDataChannel, RTCPeerConnection } from "node-datachannel/polyfill";
import { BinaryChannel, MAX_GAME_MESSAGE_BYTES } from "../BinaryChannel";

type CloseHandler = (code?: number, reason?: Buffer | string) => void;

export class DataChannelBinaryChannel implements BinaryChannel {
  public readonly kind = "webrtc" as const;
  public readonly binaryTransport = true as const;
  private dataHandler?: (data: Buffer) => void;
  private readonly pending: Buffer[] = [];
  private readonly closeHandlers: CloseHandler[] = [];
  private readonly errorHandlers: Array<(error: Error) => void> = [];
  private closed = false;

  constructor(
    private readonly channel: RTCDataChannel,
    private readonly peer: RTCPeerConnection
  ) {
    channel.binaryType = "arraybuffer";
    channel.addEventListener("message", (event) => this.receive((event as MessageEvent).data));
    channel.addEventListener("close", () => this.finishClose());
    channel.addEventListener("error", (event: Event) => {
      const error = new Error((event as any)?.error?.message ?? "WebRTC DataChannel error");
      for (const handler of this.errorHandlers) handler(error);
    });
  }

  public get remoteAddress(): string {
    const remote = this.peer.selectedCandidatePair()?.remote;
    return remote && (remote.type === "host" || remote.type === "srflx") && isIP(remote.address)
      ? remote.address
      : "";
  }

  public get bufferedAmount(): number {
    return this.channel.bufferedAmount;
  }

  public get readyState(): number {
    return this.channel.readyState === "open" ? 1 : this.channel.readyState === "connecting" ? 0 : 3;
  }

  public send(payload: Buffer): void {
    if (!this.isOpen()) throw new Error("WebRTC DataChannel is not open");
    this.channel.send(payload);
  }

  public close(): void {
    this.channel.close();
    this.peer.close();
    this.finishClose();
  }

  public onData(handler: (data: Buffer) => void): void {
    this.dataHandler = handler;
    for (const frame of this.pending.splice(0)) handler(frame);
  }

  public onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  public onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  public isOpen(): boolean {
    return !this.closed && this.channel.readyState === "open";
  }

  private receive(raw: unknown): void {
    if (!(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw)) {
      this.reject(new Error("WebRTC gameplay channel received a non-binary message"));
      return;
    }
    const frame = raw instanceof ArrayBuffer
      ? Buffer.from(raw)
      : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    if (frame.length > MAX_GAME_MESSAGE_BYTES) {
      this.reject(new Error(`WebRTC gameplay message exceeds ${MAX_GAME_MESSAGE_BYTES} bytes`));
      return;
    }
    if (this.dataHandler) this.dataHandler(frame);
    else this.pending.push(frame);
  }

  private reject(error: Error): void {
    for (const handler of this.errorHandlers) handler(error);
    this.close();
  }

  private finishClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const handler of this.closeHandlers) handler();
  }
}
