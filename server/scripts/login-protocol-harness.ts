/**
 * Login protocol harness for direct elvarg-web-client -> elvarg-web-server parity checks.
 *
 * It performs:
 * 1) 317 login handshake + RSA login block
 * 2) ISAAC setup for post-login packet encoding/decoding
 * 3) post-login client packets (121, 210, 0 keepalive, 164 movement)
 * 4) inbound packet decode/summary
 *
 * Usage:
 *   npm run test:protocol
 *   HOST=127.0.0.1 PORT=49598 USERNAME=smoketest PASSWORD=smoketest npm run test:protocol
 */
import { WebSocket } from "ws";
import { IsaacRandom } from "../src/main/typescript/elvarg/net/security/IsaacRandom";

const parseEnvInt = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = parseEnvInt("PORT", 49598);
const LOGIN_REQUEST_OPCODE = 14;
const CONNECTION_TYPE = 16; // new connection
const UID = parseEnvInt("UID", 8784521);
const USERNAME =
  process.env.PROTOCOL_USERNAME ??
  process.env.HARNESS_USERNAME ??
  process.env.USERNAME ??
  "smoketest";
const PASSWORD =
  process.env.PROTOCOL_PASSWORD ??
  process.env.HARNESS_PASSWORD ??
  process.env.PASSWORD ??
  "smoketest";
const TIMEOUT_MS = parseEnvInt("TIMEOUT_MS", 15000);
const RUN_MS = parseEnvInt("RUN_MS", 6000);
const SEND_BOOTSTRAP = (process.env.SEND_BOOTSTRAP ?? "1") !== "0";
const SEND_MOVEMENT = (process.env.SEND_MOVEMENT ?? "1") !== "0";
const MOVE_X = parseEnvInt("MOVE_X", 3092);
const MOVE_Y = parseEnvInt("MOVE_Y", 3524);
const MOVE_PLANE = parseEnvInt("MOVE_PLANE", 0);
const LOOP_MOVEMENT = (process.env.LOOP_MOVEMENT ?? "0") === "1";
const LOOP_INTERVAL_MS = parseEnvInt("LOOP_INTERVAL_MS", 1400);
const LOOP_START_DELAY_MS = parseEnvInt("LOOP_START_DELAY_MS", 1800);
const LOOP_CENTER_X = parseEnvInt("LOOP_CENTER_X", MOVE_X);
const LOOP_CENTER_Y = parseEnvInt("LOOP_CENTER_Y", MOVE_Y);
const LOOP_RADIUS = Math.max(1, parseEnvInt("LOOP_RADIUS", 5));
const LOOP_PLANE = parseEnvInt("LOOP_PLANE", MOVE_PLANE);
const SECOND_MOVE_X = process.env.SECOND_MOVE_X ? parseEnvInt("SECOND_MOVE_X", MOVE_X) : null;
const SECOND_MOVE_Y = process.env.SECOND_MOVE_Y ? parseEnvInt("SECOND_MOVE_Y", MOVE_Y) : null;
const SECOND_MOVE_PLANE = process.env.SECOND_MOVE_PLANE
  ? parseEnvInt("SECOND_MOVE_PLANE", MOVE_PLANE)
  : MOVE_PLANE;
const SECOND_MOVE_AFTER_MS = parseEnvInt("SECOND_MOVE_AFTER_MS", 1800);
const SEND_OBJECT_CLICK = (process.env.SEND_OBJECT_CLICK ?? "0") === "1";
const OBJECT_CLICK_DELAY_MS = parseEnvInt("OBJECT_CLICK_DELAY_MS", 2500);
const OBJECT_CLICK_REPEAT = Math.max(1, parseEnvInt("OBJECT_CLICK_REPEAT", 1));
const OBJECT_CLICK_REPEAT_INTERVAL_MS = parseEnvInt("OBJECT_CLICK_REPEAT_INTERVAL_MS", 900);
const OBJECT_CLICK_ID = parseEnvInt("OBJECT_CLICK_ID", 23271);
const OBJECT_CLICK_X = parseEnvInt("OBJECT_CLICK_X", 3094);
const OBJECT_CLICK_Y = parseEnvInt("OBJECT_CLICK_Y", 3521);
const COMMAND_SEQUENCE = (process.env.COMMAND_SEQUENCE ?? "")
  .split("||")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const COMMAND_DELAY_MS = parseEnvInt("COMMAND_DELAY_MS", 1500);
const COMMAND_STEP_MS = parseEnvInt("COMMAND_STEP_MS", 1200);
const DECODE_SERVER_FRAMES = (process.env.DECODE_SERVER_FRAMES ?? "1") !== "0";

const RSA_MODULUS = BigInt(
  "131409501542646890473421187351592645202876910715283031445708554322032707707649791604685616593680318619733794036379235220188001221437267862925531863675607742394687835827374685954437825783807190283337943749605737918856262761566146702087468587898515768996741636870321689974105378482179138088453912399137944888201"
);
const RSA_PUBLIC = BigInt(65537);

// Must mirror server PacketEncoder.CLIENTS_PACKET_SIZES for decoding server->client packets.
const INCOMING_PACKET_SIZES: number[] = [
  0, 0, 0, 1, 6, 0, 0, 0, 4, 4, //0
  6, 2, -2, 1, 1, -1, 1, 0, 0, 0, // 10
  0, 0, 0, 0, 1, 0, 0, -1, 1, 1, //20
  0, 0, 0, 0, -2, 4, 3, 0, 2, 0, //30
  0, 0, 0, 0, 7, 8, 0, 6, 0, 0, //40
  9, 8, 0, -2, 4, 1, 0, 0, 0, 0, //50
  -2, 1, 0, 0, 2, -2, 0, 0, 0, 0, //60
  6, 3, 2, 4, 2, 4, 0, 0, 0, 4, //70
  0, -2, 0, 0, 11, 2, 1, 6, 6, 0, //80
  0, 0, 0, 0, 0, 0, 0, 2, 0, 1, //90
  2, 2, 0, 1, -1, 8, 1, 0, 8, 0, //100
  1, 1, 1, 1, 2, 1, 5, 15, 0, 0, //110
  0, 4, 4, -1, 9, -1, -2, 2, 0, 0, //120
  -1, 0, 0, 0, 13, 0, 0, 1, 0, 0, //130
  3, 10, 2, 0, 0, 0, 0, 14, 0, 0, //140
  0, 4, 5, 3, 0, 0, 3, 0, 0, 0, //150
  4, 5, 0, 0, 2, 0, 6, 5, 0, 0, //160
  0, 5, -2, -2, 7, 5, 10, 6, 0, -2, //170
  0, 0, 0, 1, 1, 2, 1, -1, 0, 0, //180
  0, 0, 0, 0, 0, 2, -1, 0, -1, 0, //190
  4, 0, 0, 0, 0, 0, 3, 0, 4, 0, //200
  0, 0, 0, 0, -2, 7, 0, -2, 2, 0, //210
  0, 1, -2, -2, 0, 0, 0, 0, 0, 0, //220
  8, 0, 0, 0, 0, 0, 0, 0, 0, 0, //230
  2, -2, 0, 0, -1, 0, 6, 0, 4, 3, //240
  -1, 0, -1, -1, 6, 0, 0 //250
];

const OPCODE_LABELS: Record<number, string> = {
  0: "keep_alive",
  36: "config",
  53: "item_container",
  65: "npc_update",
  71: "tab_interface",
  73: "map_region",
  81: "player_update",
  99: "map_state",
  104: "interaction_option",
  108: "total_experience",
  110: "run_energy",
  113: "run_status",
  127: "rights",
  219: "interface_removal",
  249: "player_details",
  253: "message",
};

type PacketType = "fixed" | "var" | "var_short";
type Stage = "HANDSHAKE" | "LOGIN" | "ESTABLISHED";

type HarnessState = {
  stage: Stage;
  outboundCipher: IsaacRandom | null;
  inboundCipher: IsaacRandom | null;
  seed: number[] | null;
  loginSucceeded: boolean;
  rights: number | null;
  movementSentAt: number | null;
  secondMovementSentAt: number | null;
  packetCounts: Map<number, number>;
  postMovePlayerUpdate: boolean;
  postSecondMovePlayerUpdate: boolean;
};

const state: HarnessState = {
  stage: "HANDSHAKE",
  outboundCipher: null,
  inboundCipher: null,
  seed: null,
  loginSucceeded: false,
  rights: null,
  movementSentAt: null,
  secondMovementSentAt: null,
  packetCounts: new Map<number, number>(),
  postMovePlayerUpdate: false,
  postSecondMovePlayerUpdate: false,
};

const ts = () => new Date().toISOString();
const log = (event: string, data?: Record<string, unknown>) => {
  const suffix = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[harness ${ts()}] ${event}${suffix}`);
};

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function writeInt(buf: number[], value: number) {
  buf.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
}

function writeString(buf: number[], text: string) {
  for (let i = 0; i < text.length; i++) {
    buf.push(text.charCodeAt(i) & 0xff);
  }
  buf.push(10);
}

function encryptRsa(plain: Buffer): Buffer {
  const plainHex = plain.toString("hex") || "00";
  const m = BigInt("0x" + plainHex);
  const c = modPow(m, RSA_PUBLIC, RSA_MODULUS);
  let hex = c.toString(16);
  if (hex.length % 2 === 1) hex = "0" + hex;
  // Match Java BigInteger#toByteArray sign handling.
  if ((parseInt(hex.slice(0, 2), 16) & 0x80) !== 0) hex = "00" + hex;
  return Buffer.from(hex, "hex");
}

function buildLoginPayload(serverSeed1: number, serverSeed2: number): { payload: Buffer; seed: number[] } {
  const seed = [
    Math.floor(Math.random() * 0x7fffffff),
    Math.floor(Math.random() * 0x7fffffff),
    serverSeed1,
    serverSeed2,
  ];

  const rsaPlain: number[] = [];
  rsaPlain.push(10);
  writeInt(rsaPlain, seed[0]);
  writeInt(rsaPlain, seed[1]);
  writeInt(rsaPlain, seed[2]);
  writeInt(rsaPlain, seed[3]);
  writeInt(rsaPlain, UID);
  writeString(rsaPlain, USERNAME);
  writeString(rsaPlain, PASSWORD);
  const rsaCipher = encryptRsa(Buffer.from(rsaPlain));

  const sender: number[] = [];
  sender.push(rsaCipher.length & 0xff);
  sender.push(...rsaCipher);

  const loginBuf: number[] = [];
  loginBuf.push(CONNECTION_TYPE);
  loginBuf.push(sender.length + 2);
  loginBuf.push(255);
  loginBuf.push(0);
  loginBuf.push(...sender);

  return { payload: Buffer.from(loginBuf), seed };
}

function encodeClientPacket(opcode: number, payload: Buffer, type: PacketType = "fixed"): Buffer {
  if (!state.outboundCipher) {
    throw new Error("Outbound cipher not initialized");
  }
  const rand = state.outboundCipher.nextInt() & 0xff;
  const encOpcode = (opcode + rand) & 0xff;
  switch (type) {
    case "var":
      if (payload.length > 255) {
        throw new Error(`Variable packet too long for opcode ${opcode}: ${payload.length}`);
      }
      return Buffer.concat([Buffer.from([encOpcode, payload.length & 0xff]), payload]);
    case "var_short": {
      if (payload.length > 65535) {
        throw new Error(`Variable-short packet too long for opcode ${opcode}: ${payload.length}`);
      }
      const header = Buffer.alloc(3);
      header.writeUInt8(encOpcode, 0);
      header.writeUInt16BE(payload.length, 1);
      return Buffer.concat([header, payload]);
    }
    default:
      return Buffer.concat([Buffer.from([encOpcode]), payload]);
  }
}

function sendPacket(ws: WebSocket, opcode: number, payload: Buffer, type: PacketType = "fixed", label?: string) {
  const encoded = encodeClientPacket(opcode, payload, type);
  log("send_packet", {
    opcode,
    label: label ?? OPCODE_LABELS[opcode] ?? "unknown",
    payloadLength: payload.length,
    encodedLength: encoded.length,
    payloadPreview: payload.subarray(0, Math.min(payload.length, 16)).toString("hex"),
  });
  ws.send(encoded);
}

function encodeCommandPayload(command: string): Buffer {
  const sanitized = command.endsWith("\n") ? command : `${command}\n`;
  return Buffer.from(sanitized, "latin1");
}

function sendCommand(ws: WebSocket, command: string) {
  const normalized = command.startsWith("::") ? command : `::${command.replace(/^[:/]+/, "")}`;
  sendPacket(ws, 103, encodeCommandPayload(normalized), "var", "command");
}

function decodeServerFrame(frame: Buffer) {
  if (!state.inboundCipher) {
    throw new Error("Inbound cipher not initialized");
  }
  let offset = 0;
  while (offset < frame.length) {
    const encOpcode = frame.readUInt8(offset++);
    const rand = state.inboundCipher.nextInt() & 0xff;
    const opcode = (encOpcode - rand) & 0xff;
    let size = INCOMING_PACKET_SIZES[opcode];
    if (size === undefined) {
      throw new Error(`No packet size mapping for opcode ${opcode}`);
    }
    if (size === -1) {
      if (offset + 1 > frame.length) throw new Error(`Truncated variable packet header for opcode ${opcode}`);
      size = frame.readUInt8(offset++);
    } else if (size === -2) {
      if (offset + 2 > frame.length) throw new Error(`Truncated var-short packet header for opcode ${opcode}`);
      size = frame.readUInt16BE(offset);
      offset += 2;
    }
    if (offset + size > frame.length) {
      throw new Error(
        `Truncated packet body for opcode ${opcode}: expected ${size}, remaining ${frame.length - offset}`
      );
    }
    const payload = frame.subarray(offset, offset + size);
    offset += size;

    const nextCount = (state.packetCounts.get(opcode) ?? 0) + 1;
    state.packetCounts.set(opcode, nextCount);
    if (opcode === 81 && state.movementSentAt != null) {
      state.postMovePlayerUpdate = true;
    }
    if (opcode === 81 && state.secondMovementSentAt != null) {
      state.postSecondMovePlayerUpdate = true;
    }

    log("recv_packet", {
      opcode,
      label: OPCODE_LABELS[opcode] ?? "unknown",
      count: nextCount,
      payloadLength: payload.length,
      payloadPreview: payload.subarray(0, Math.min(payload.length, 16)).toString("hex"),
    });
  }
}

function sendBootstrapPackets(ws: WebSocket) {
  if (!SEND_BOOTSTRAP) return;
  sendPacket(ws, 121, Buffer.alloc(0), "fixed", "finalized_region_change");
  const region = Buffer.alloc(4);
  region.writeInt32BE(1057001181, 0);
  sendPacket(ws, 210, region, "fixed", "region_change");
}

function sendMovementPacket(ws: WebSocket, x: number, y: number, plane: number, label = "movement") {
  if (!SEND_MOVEMENT) return;
  const payload = Buffer.alloc(5);
  payload.writeUInt16BE(x & 0xffff, 0);
  payload.writeUInt16BE(y & 0xffff, 2);
  payload.writeUInt8(plane & 0xff, 4);
  if (label === "movement") {
    state.movementSentAt = Date.now();
  } else {
    state.secondMovementSentAt = Date.now();
  }
  sendPacket(ws, 164, payload, "fixed", label);
}

function sendKeepAlive(ws: WebSocket) {
  sendPacket(ws, 0, Buffer.alloc(0), "fixed", "keepalive");
}

function writeLEShortA(payload: Buffer, offset: number, value: number) {
  payload.writeUInt8((value + 128) & 0xff, offset);
  payload.writeUInt8((value >> 8) & 0xff, offset + 1);
}

function writeUnsignedShortA(payload: Buffer, offset: number, value: number) {
  payload.writeUInt8((value >> 8) & 0xff, offset);
  payload.writeUInt8((value + 128) & 0xff, offset + 1);
}

function sendObjectFirstClickPacket(
  ws: WebSocket,
  objectId: number,
  objectX: number,
  objectY: number,
  label = "object_first_click"
) {
  const payload = Buffer.alloc(6);
  writeLEShortA(payload, 0, objectX & 0xffff);
  payload.writeUInt16BE(objectId & 0xffff, 2);
  writeUnsignedShortA(payload, 4, objectY & 0xffff);
  sendPacket(ws, 132, payload, "fixed", label);
}

function nextLoopDestination(step: number): { x: number; y: number; plane: number } {
  const points = 12;
  const baseAngle = ((step % points) / points) * (Math.PI * 2);
  const angleJitter = (Math.random() - 0.5) * 0.4;
  const radiusJitter = Math.round((Math.random() - 0.5) * 2);
  const r = Math.max(1, LOOP_RADIUS + radiusJitter);
  const x = LOOP_CENTER_X + Math.round(Math.cos(baseAngle + angleJitter) * r);
  const y = LOOP_CENTER_Y + Math.round(Math.sin(baseAngle + angleJitter) * r);
  return { x, y, plane: LOOP_PLANE };
}

function summarizeAndAssert() {
  if (!DECODE_SERVER_FRAMES) {
    const summary = {
      loginSucceeded: state.loginSucceeded,
      rights: state.rights,
      decodeServerFrames: false,
    };
    log("summary", summary);
    if (!state.loginSucceeded) {
      throw new Error("Protocol harness failed: login was not successful");
    }
    return;
  }

  const summary = {
    loginSucceeded: state.loginSucceeded,
    rights: state.rights,
    packets: {
      mapRegion73: state.packetCounts.get(73) ?? 0,
      playerUpdate81: state.packetCounts.get(81) ?? 0,
      npcUpdate65: state.packetCounts.get(65) ?? 0,
      details249: state.packetCounts.get(249) ?? 0,
    },
    postMovePlayerUpdate: state.postMovePlayerUpdate,
    postSecondMovePlayerUpdate: state.postSecondMovePlayerUpdate,
  };
  log("summary", summary);

  if (!state.loginSucceeded) {
    throw new Error("Protocol harness failed: login was not successful");
  }
  if ((state.packetCounts.get(81) ?? 0) < 1) {
    throw new Error("Protocol harness failed: no player_update (81) received");
  }
  if (SEND_MOVEMENT && !state.postMovePlayerUpdate) {
    throw new Error("Protocol harness failed: movement sent but no post-move player_update (81) observed");
  }
  if (SECOND_MOVE_X != null && SECOND_MOVE_Y != null && !state.postSecondMovePlayerUpdate) {
    throw new Error("Protocol harness failed: second movement sent but no post-second-move player_update (81) observed");
  }
}

async function main() {
  return new Promise<void>((resolve, reject) => {
    const url = `ws://${HOST}:${PORT}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    log("connect", {
      url,
      username: USERNAME,
      runMs: RUN_MS,
      sendBootstrap: SEND_BOOTSTRAP,
      sendMovement: SEND_MOVEMENT,
      moveTo: { x: MOVE_X, y: MOVE_Y, plane: MOVE_PLANE },
      loopMovement: LOOP_MOVEMENT
        ? {
            centerX: LOOP_CENTER_X,
            centerY: LOOP_CENTER_Y,
            radius: LOOP_RADIUS,
            plane: LOOP_PLANE,
            everyMs: LOOP_INTERVAL_MS,
          }
        : false,
      secondMoveTo:
        SECOND_MOVE_X != null && SECOND_MOVE_Y != null
          ? { x: SECOND_MOVE_X, y: SECOND_MOVE_Y, plane: SECOND_MOVE_PLANE, afterMs: SECOND_MOVE_AFTER_MS }
          : null,
      objectClick: SEND_OBJECT_CLICK
        ? {
            id: OBJECT_CLICK_ID,
            x: OBJECT_CLICK_X,
            y: OBJECT_CLICK_Y,
            delayMs: OBJECT_CLICK_DELAY_MS,
            repeat: OBJECT_CLICK_REPEAT,
            intervalMs: OBJECT_CLICK_REPEAT_INTERVAL_MS,
          }
        : null,
      commands:
        COMMAND_SEQUENCE.length > 0
          ? {
              delayMs: COMMAND_DELAY_MS,
              stepMs: COMMAND_STEP_MS,
              values: COMMAND_SEQUENCE,
            }
          : null,
    });

    let finished = false;
    let keepAliveTimer: NodeJS.Timeout | null = null;
    let finishTimer: NodeJS.Timeout | null = null;
    let movementLoopTimer: NodeJS.Timeout | null = null;
    let movementLoopStep = 0;

    const cleanup = () => {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      if (finishTimer) clearTimeout(finishTimer);
      if (movementLoopTimer) clearInterval(movementLoopTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };

    const complete = (err?: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      } catch {
        // ignore close errors
      }
      if (err) reject(err);
      else resolve();
    };

    const timeoutTimer = setTimeout(() => {
      complete(new Error(`Timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    ws.on("open", () => {
      ws.send(Buffer.from([LOGIN_REQUEST_OPCODE]));
      log("handshake_request_sent", { opcode: LOGIN_REQUEST_OPCODE });
    });

    ws.on("message", (rawData) => {
      const frame = Buffer.isBuffer(rawData)
        ? rawData
        : Array.isArray(rawData)
          ? Buffer.concat(rawData)
          : Buffer.from(rawData as ArrayBuffer);

      try {
        if (state.stage === "HANDSHAKE") {
          const firstByte = frame.length > 0 ? frame.readUInt8(0) : -1;
          if (frame.length !== 9 || firstByte !== 0) {
            throw new Error(`Unexpected handshake response: len=${frame.length} firstByte=${firstByte}`);
          }
          const serverSeed1 = frame.readInt32BE(1);
          const serverSeed2 = frame.readInt32BE(5);
          const { payload, seed } = buildLoginPayload(serverSeed1, serverSeed2);

          state.seed = seed;
          state.outboundCipher = new IsaacRandom(seed.slice());
          state.inboundCipher = new IsaacRandom(seed.map((value) => value + 50));
          state.stage = "LOGIN";

          ws.send(payload);
          log("login_payload_sent", {
            payloadLength: payload.length,
            serverSeed1,
            serverSeed2,
            seed0: seed[0],
            seed1: seed[1],
          });
          return;
        }

        if (state.stage === "LOGIN") {
          if (frame.length < 1) {
            throw new Error("Empty login response frame");
          }
          const response = frame.readUInt8(0);
          if (response !== 2) {
            throw new Error(`Login failed with response ${response}`);
          }
          state.loginSucceeded = true;
          state.rights = frame.length > 1 ? frame.readUInt8(1) : null;
          state.stage = "ESTABLISHED";
          log("login_success", { rights: state.rights });

          sendBootstrapPackets(ws);
          sendKeepAlive(ws);
          keepAliveTimer = setInterval(() => sendKeepAlive(ws), 2500);

          if (COMMAND_SEQUENCE.length > 0) {
            COMMAND_SEQUENCE.forEach((command, index) => {
              setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) {
                  return;
                }
                sendCommand(ws, command);
              }, COMMAND_DELAY_MS + index * COMMAND_STEP_MS);
            });
          }

          if (SEND_MOVEMENT) {
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                sendMovementPacket(ws, MOVE_X, MOVE_Y, MOVE_PLANE, "movement");
              }
            }, 800);
            if (SECOND_MOVE_X != null && SECOND_MOVE_Y != null) {
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  sendMovementPacket(
                    ws,
                    SECOND_MOVE_X,
                    SECOND_MOVE_Y,
                    SECOND_MOVE_PLANE,
                    "movement_second"
                  );
                }
              }, SECOND_MOVE_AFTER_MS);
            }
            if (LOOP_MOVEMENT) {
              setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) {
                  return;
                }
                movementLoopTimer = setInterval(() => {
                  if (ws.readyState !== WebSocket.OPEN) {
                    return;
                  }
                  const destination = nextLoopDestination(movementLoopStep++);
                  sendMovementPacket(ws, destination.x, destination.y, destination.plane, "movement_loop");
                }, LOOP_INTERVAL_MS);
              }, LOOP_START_DELAY_MS);
            }
          }

          if (SEND_OBJECT_CLICK) {
            for (let i = 0; i < OBJECT_CLICK_REPEAT; i++) {
              const delayMs = OBJECT_CLICK_DELAY_MS + i * OBJECT_CLICK_REPEAT_INTERVAL_MS;
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  sendObjectFirstClickPacket(
                    ws,
                    OBJECT_CLICK_ID,
                    OBJECT_CLICK_X,
                    OBJECT_CLICK_Y,
                    `object_first_click_${i + 1}`
                  );
                }
              }, delayMs);
            }
          }

          finishTimer = setTimeout(() => {
            try {
              summarizeAndAssert();
              complete();
            } catch (err) {
              complete(err as Error);
            }
          }, RUN_MS);
          return;
        }

        if (DECODE_SERVER_FRAMES) {
          decodeServerFrame(frame);
        } else {
          log("recv_frame", { length: frame.length });
        }
      } catch (err) {
        complete(err as Error);
      }
    });

    ws.on("error", (err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      complete(e);
    });

    ws.on("close", (code, reason) => {
      if (finished) return;
      const reasonText = reason instanceof Buffer ? reason.toString("utf8") : String(reason ?? "");
      complete(new Error(`Socket closed before completion (code=${code}, reason=${reasonText})`));
    });
  });
}

main()
  .then(() => {
    console.log("Protocol harness: SUCCESS");
  })
  .catch((err) => {
    console.error("Protocol harness: FAILED");
    console.error(err);
    process.exit(1);
  });
