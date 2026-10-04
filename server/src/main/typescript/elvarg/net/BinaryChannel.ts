import { Socket } from "net";
import { RawData, WebSocket } from "ws";

export const MAX_GAME_MESSAGE_BYTES = 64 * 1024;

export type BinaryChannelKind = "websocket" | "webrtc" | "tcp";

export interface BinaryChannel {
  readonly kind: BinaryChannelKind;
  readonly binaryTransport: true;
  readonly remoteAddress: string;
  readonly bufferedAmount?: number;
  readonly readyState?: number;
  send(payload: Buffer): void;
  close(code?: number, reason?: string): void;
  onData(handler: (data: Buffer) => void): void;
  onClose(handler: (code?: number, reason?: Buffer | string) => void): void;
  onError(handler: (err: Error) => void): void;
  isOpen(): boolean;
}

export class WebSocketBinaryChannel implements BinaryChannel {
  public readonly kind = "websocket" as const;
  public readonly binaryTransport = true as const;

  constructor(private readonly socket: WebSocket) {}

  public get remoteAddress(): string {
    return (this.socket as any)?._socket?.remoteAddress ?? "";
  }

  public get bufferedAmount(): number {
    return this.socket.bufferedAmount;
  }

  public get readyState(): number {
    return this.socket.readyState;
  }

  public send(payload: Buffer): void {
    this.socket.send(payload);
  }

  public close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  public onData(handler: (data: Buffer) => void): void {
    this.socket.on("message", (data: RawData) => {
      handler(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
    });
  }

  public onClose(handler: (code?: number, reason?: Buffer | string) => void): void {
    this.socket.on("close", handler);
  }

  public onError(handler: (err: Error) => void): void {
    this.socket.on("error", handler);
  }

  public isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }
}

export class TcpBinaryChannel implements BinaryChannel {
  public readonly kind = "tcp" as const;
  public readonly binaryTransport = true as const;

  constructor(private readonly socket: Socket) {
    this.socket.setNoDelay(true);
  }

  public get remoteAddress(): string {
    return this.socket.remoteAddress ?? "";
  }

  public get bufferedAmount(): number {
    return this.socket.writableLength;
  }

  public send(payload: Buffer): void {
    this.socket.write(payload);
  }

  public close(): void {
    this.socket.end();
  }

  public onData(handler: (data: Buffer) => void): void {
    this.socket.on("data", handler);
  }

  public onClose(handler: () => void): void {
    this.socket.on("close", handler);
  }

  public onError(handler: (err: Error) => void): void {
    this.socket.on("error", handler);
  }

  public isOpen(): boolean {
    return !this.socket.destroyed && this.socket.writable;
  }
}
