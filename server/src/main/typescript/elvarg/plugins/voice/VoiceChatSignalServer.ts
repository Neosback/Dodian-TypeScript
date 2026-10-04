import { WebSocketServer, WebSocket } from "ws";
import { World } from "../../game/World";
import { NetworkConstants } from "../../net/NetworkConstants";

type RelayMessage =
    | {
          type: "voice-state";
          enabled?: boolean;
      }
    | {
          type: "speaking-state";
          speaking?: boolean;
      }
    | {
          type: "offer" | "answer";
          target?: string;
          description?: unknown;
      }
    | {
          type: "ice-candidate";
          target?: string;
          candidate?: unknown;
      };

type ClientState = {
    socket: WebSocket;
    username: string;
    voiceEnabled: boolean;
    speaking: boolean;
};

export class VoiceChatSignalServer {
    private static server: WebSocketServer | null = null;
    private static clientsByUsername = new Map<string, ClientState>();

    public static start(): void {
        if (VoiceChatSignalServer.server != null) {
            return;
        }
        const host = process.env.HOST || process.env.BIND_HOST || "0.0.0.0";
        const port = NetworkConstants.VOICE_SIGNAL_PORT;
        if (!Number.isInteger(port) || port <= 0) {
            console.warn("[voice-chat] skipping signal server start: invalid port");
            return;
        }

        const server = new WebSocketServer({ host, port });
        server.on("connection", (socket, request) => {
            const username = VoiceChatSignalServer.resolveUsername(request.url ?? "");
            if (!username) {
                socket.close(1008, "Missing username");
                return;
            }
            if (!World.getPlayerByName(username)) {
                socket.close(1008, "Player is not online");
                return;
            }

            const existing = VoiceChatSignalServer.clientsByUsername.get(username);
            if (existing) {
                try {
                    existing.socket.close(1012, "Voice chat reconnected");
                } catch (_err) {}
            }

            const state: ClientState = {
                socket,
                username,
                voiceEnabled: false,
                speaking: false,
            };
            VoiceChatSignalServer.clientsByUsername.set(username, state);
            VoiceChatSignalServer.sendJson(socket, {
                type: "welcome",
                peers: Array.from(VoiceChatSignalServer.clientsByUsername.values())
                    .filter((otherState) => otherState.username !== username && otherState.voiceEnabled)
                    .map((otherState) => otherState.username),
                speaking: Array.from(VoiceChatSignalServer.clientsByUsername.values())
                    .filter((otherState) => otherState.username !== username && otherState.speaking)
                    .map((otherState) => otherState.username),
            });

            socket.on("message", (rawData) => {
                VoiceChatSignalServer.handleMessage(state, rawData.toString());
            });
            socket.on("close", () => {
                VoiceChatSignalServer.unregisterUsername(username, socket);
            });
            socket.on("error", (err) => {
                console.warn(`[voice-chat] socket error for ${username}`, err);
            });
        });
        server.on("error", (err) => {
            console.error("[voice-chat] signal server failed", err);
        });

        VoiceChatSignalServer.server = server;
        console.info(`[voice-chat] signal server started on ${host}:${port}`);
    }

    public static stop(): void {
        for (const state of VoiceChatSignalServer.clientsByUsername.values()) {
            try {
                state.socket.close(1001, "Voice chat server shutting down");
            } catch (_err) {}
        }
        VoiceChatSignalServer.clientsByUsername.clear();

        if (VoiceChatSignalServer.server != null) {
            try {
                VoiceChatSignalServer.server.close();
            } catch (_err) {}
        }
        VoiceChatSignalServer.server = null;
    }

    public static disconnectUsername(username: string | null | undefined): void {
        if (!username) {
            return;
        }
        const normalized = String(username);
        const state = VoiceChatSignalServer.clientsByUsername.get(normalized);
        if (!state) {
            return;
        }
        try {
            state.socket.close(1000, "Game session closed");
        } catch (_err) {}
        VoiceChatSignalServer.unregisterUsername(normalized, state.socket);
    }

    private static handleMessage(state: ClientState, rawMessage: string): void {
        let message: RelayMessage | { type?: string; [key: string]: unknown };
        try {
            message = JSON.parse(rawMessage);
        } catch (_err) {
            VoiceChatSignalServer.sendJson(state.socket, {
                type: "error",
                message: "Invalid voice chat payload",
            });
            return;
        }

        if (message.type === "identify") {
            return;
        }

        if (message.type === "voice-state") {
            const enabled = message.enabled === true;
            if (state.voiceEnabled !== enabled) {
                state.voiceEnabled = enabled;
                if (!enabled && state.speaking) {
                    state.speaking = false;
                    VoiceChatSignalServer.broadcast(state.username, {
                        type: "speaking-state",
                        username: state.username,
                        speaking: false,
                    });
                }
                VoiceChatSignalServer.broadcast(state.username, {
                    type: enabled ? "peer-joined" : "peer-left",
                    username: state.username,
                });
            }
            return;
        }

        if (message.type === "speaking-state") {
            const speaking = state.voiceEnabled && message.speaking === true;
            if (state.speaking !== speaking) {
                state.speaking = speaking;
                VoiceChatSignalServer.broadcast(null, {
                    type: "speaking-state",
                    username: state.username,
                    speaking,
                });
            }
            return;
        }

        if (message.type !== "offer" && message.type !== "answer" && message.type !== "ice-candidate") {
            VoiceChatSignalServer.sendJson(state.socket, {
                type: "error",
                message: "Unsupported voice chat message type",
            });
            return;
        }

        const targetUsername = typeof message.target === "string" ? message.target : null;
        if (!targetUsername) {
            VoiceChatSignalServer.sendJson(state.socket, {
                type: "error",
                message: "Voice chat target is required",
            });
            return;
        }

        const target = VoiceChatSignalServer.clientsByUsername.get(targetUsername);
        if (!target) {
            VoiceChatSignalServer.sendJson(state.socket, {
                type: "error",
                message: `${targetUsername} is not connected to voice chat`,
            });
            return;
        }

        switch (message.type) {
            case "offer":
            case "answer":
                VoiceChatSignalServer.sendJson(target.socket, {
                    type: message.type,
                    from: state.username,
                    description: message.description ?? null,
                });
                break;
            case "ice-candidate":
                VoiceChatSignalServer.sendJson(target.socket, {
                    type: "ice-candidate",
                    from: state.username,
                    candidate: message.candidate ?? null,
                });
                break;
        }
    }

    private static unregisterUsername(username: string, socket: WebSocket): void {
        const current = VoiceChatSignalServer.clientsByUsername.get(username);
        if (!current || current.socket !== socket) {
            return;
        }
        VoiceChatSignalServer.clientsByUsername.delete(username);
        if (current.voiceEnabled) {
            VoiceChatSignalServer.broadcast(username, {
                type: "peer-left",
                username,
            });
        }
        if (current.speaking) {
            VoiceChatSignalServer.broadcast(username, {
                type: "speaking-state",
                username,
                speaking: false,
            });
        }
    }

    private static broadcast(excludedUsername: string | null, payload: Record<string, unknown>): void {
        for (const [username, state] of VoiceChatSignalServer.clientsByUsername.entries()) {
            if (excludedUsername != null && username === excludedUsername) {
                continue;
            }
            VoiceChatSignalServer.sendJson(state.socket, payload);
        }
    }

  private static sendJson(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  private static resolveUsername(rawUrl: string): string | null {
    try {
      const parsed = new URL(rawUrl, "ws://localhost");
      const username = parsed.searchParams.get("username");
      if (!username) {
        return null;
      }
      return username.trim();
    } catch (_err) {
      return null;
    }
  }
}
