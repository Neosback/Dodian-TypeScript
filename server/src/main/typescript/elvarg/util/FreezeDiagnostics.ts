import * as fs from "fs";
import * as path from "path";
import { GameConstants } from "../game/GameConstants";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "freeze-diagnostics.log");

export class FreezeDiagnostics {
  private static initialized = false;
  private static stream: fs.WriteStream | null = null;
  private static streamWritable = true;
  private static droppedLines = 0;

  private static ensureInitialized(): void {
    if (FreezeDiagnostics.initialized) {
      return;
    }
    FreezeDiagnostics.initialized = true;
    if (!GameConstants.SERVER_LOG_WRITES_ENABLED) {
      return;
    }

    fs.mkdirSync(LOG_DIR, { recursive: true });
    FreezeDiagnostics.stream = fs.createWriteStream(LOG_FILE, {
      flags: "a",
      encoding: "utf8",
    });
    FreezeDiagnostics.streamWritable = true;
    FreezeDiagnostics.stream.on("drain", () => {
      FreezeDiagnostics.streamWritable = true;
      if (FreezeDiagnostics.droppedLines <= 0) {
        return;
      }
      const dropped = FreezeDiagnostics.droppedLines;
      FreezeDiagnostics.droppedLines = 0;
      FreezeDiagnostics.writeLine(
        `${new Date().toISOString()} [freeze_diag] dropped_lines count=${dropped}`
      );
    });
    FreezeDiagnostics.stream.on("error", () => {
      FreezeDiagnostics.streamWritable = false;
    });
  }

  private static writeLine(line: string): void {
    if (!GameConstants.SERVER_LOG_WRITES_ENABLED) {
      return;
    }
    FreezeDiagnostics.ensureInitialized();
    if (!FreezeDiagnostics.stream) {
      return;
    }
    if (!FreezeDiagnostics.streamWritable) {
      FreezeDiagnostics.droppedLines++;
      return;
    }
    if (!FreezeDiagnostics.stream.write(`${line}\n`)) {
      FreezeDiagnostics.streamWritable = false;
    }
  }

  public static log(event: string, payload: Record<string, unknown>): void {
    const safeEvent = String(event || "unknown_event").trim() || "unknown_event";
    let serializedPayload = "{}";
    try {
      serializedPayload = JSON.stringify(payload ?? {});
    } catch {
      serializedPayload = "{\"error\":\"payload_serialization_failed\"}";
    }
    FreezeDiagnostics.writeLine(
      `${new Date().toISOString()} [freeze_diag] ${safeEvent} ${serializedPayload}`
    );
  }
}

