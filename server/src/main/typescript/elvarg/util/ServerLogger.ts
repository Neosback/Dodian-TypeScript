import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import { GameConstants } from "../game/GameConstants";

type LogLevel = "debug" | "info" | "warn" | "error";

type LoggerFn = (...args: any[]) => void;

type ConsoleFns = {
  log: LoggerFn;
  info: LoggerFn;
  warn: LoggerFn;
  error: LoggerFn;
  debug: LoggerFn;
};

export class ServerLogger {
  private static installed = false;
  private static logStream: fs.WriteStream | null = null;
  private static streamWritable = true;
  private static enabledLevels: Set<LogLevel> = new Set(
    (GameConstants.SERVER_LOG_LEVELS || [])
      .map((v) => String(v).toLowerCase())
      .filter((v): v is LogLevel =>
        v === "debug" || v === "info" || v === "warn" || v === "error"
      )
  );
  private static enabledTypes: Set<string> = new Set(
    (GameConstants.SERVER_LOG_ENABLED_TYPES || [])
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean)
  );
  private static disabledTypes: Set<string> = new Set(
    (GameConstants.SERVER_LOG_DISABLED_TYPES || [])
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean)
  );

  private static parseCsvEnv(name: string): string[] {
    const value = process.env[name];
    if (typeof value !== "string" || value.trim().length === 0) {
      return [];
    }
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  private static parseLevels(): Set<LogLevel> {
    const raw = ServerLogger.parseCsvEnv("LOG_LEVELS");
    if (raw.length === 0) {
      return new Set<LogLevel>(
        (GameConstants.SERVER_LOG_LEVELS || [])
          .map((v) => String(v).toLowerCase())
          .filter((v): v is LogLevel =>
            v === "debug" || v === "info" || v === "warn" || v === "error"
          )
      );
    }
    const levels = new Set<LogLevel>();
    for (const entry of raw) {
      const normalized = entry.toLowerCase();
      if (
        normalized === "debug" ||
        normalized === "info" ||
        normalized === "warn" ||
        normalized === "error"
      ) {
        levels.add(normalized);
      }
    }
    return levels;
  }

  private static extractType(args: any[]): string {
    const first = args.length > 0 ? String(args[0]) : "";
    const match = first.match(/^\[([^\]]+)\]/);
    if (!match) {
      return "general";
    }
    const tag = match[1].toLowerCase();
    const colonIdx = tag.indexOf(":");
    if (colonIdx >= 0) {
      return tag.slice(0, colonIdx);
    }
    return tag;
  }

  private static shouldAllowType(
    type: string,
    enabledTypes: Set<string>,
    disabledTypes: Set<string>
  ): boolean {
    if (enabledTypes.size > 0 && !enabledTypes.has(type) && !enabledTypes.has("*")) {
      return false;
    }
    if (disabledTypes.has(type) || disabledTypes.has("*")) {
      return false;
    }
    return true;
  }

  public static install(logFile = path.join(process.cwd(), "logs", "server.log")): void {
    if (ServerLogger.installed) {
      return;
    }
    ServerLogger.installed = true;

    if (GameConstants.SERVER_LOG_WRITES_ENABLED) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      ServerLogger.logStream = fs.createWriteStream(logFile, {
        flags: "a",
        encoding: "utf8",
      });
      ServerLogger.streamWritable = true;
      ServerLogger.logStream.on("drain", () => {
        ServerLogger.streamWritable = true;
      });
      ServerLogger.logStream.on("error", () => {
        ServerLogger.streamWritable = false;
      });
      ServerLogger.logStream.write(
        `${new Date().toISOString()} [INFO] ===== server_bootstrap pid=${process.pid} =====\n`
      );
    }

    ServerLogger.enabledLevels = ServerLogger.parseLevels();
    const enabledFromEnv = ServerLogger.parseCsvEnv("LOG_ENABLED_TYPES").map((v) =>
      v.toLowerCase()
    );
    const disabledFromEnv = ServerLogger.parseCsvEnv("LOG_DISABLED_TYPES").map((v) =>
      v.toLowerCase()
    );
    ServerLogger.enabledTypes = new Set(
      enabledFromEnv.length > 0
        ? enabledFromEnv
        : (GameConstants.SERVER_LOG_ENABLED_TYPES || [])
            .map((v) => String(v).trim().toLowerCase())
            .filter(Boolean)
    );
    ServerLogger.disabledTypes = new Set(
      disabledFromEnv.length > 0
        ? disabledFromEnv
        : (GameConstants.SERVER_LOG_DISABLED_TYPES || [])
            .map((v) => String(v).trim().toLowerCase())
            .filter(Boolean)
    );
    GameConstants.SERVER_LOG_LEVELS = Array.from(ServerLogger.enabledLevels.values());
    GameConstants.SERVER_LOG_ENABLED_TYPES = Array.from(
      ServerLogger.enabledTypes.values()
    );
    GameConstants.SERVER_LOG_DISABLED_TYPES = Array.from(
      ServerLogger.disabledTypes.values()
    );

    const original: ConsoleFns = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug:
        typeof console.debug === "function"
          ? console.debug.bind(console)
          : console.log.bind(console),
    };

    const write = (level: LogLevel, fn: LoggerFn, ...args: any[]) => {
      if (!GameConstants.SERVER_LOG_WRITES_ENABLED) {
        return;
      }
      if (!ServerLogger.enabledLevels.has(level)) {
        return;
      }
      const type = ServerLogger.extractType(args);
      if (
        !ServerLogger.shouldAllowType(
          type,
          ServerLogger.enabledTypes,
          ServerLogger.disabledTypes
        )
      ) {
        return;
      }

      const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${util.format(
        ...args
      )}`;

      try {
        if (ServerLogger.logStream && ServerLogger.streamWritable) {
          if (!ServerLogger.logStream.write(line + "\n")) {
            ServerLogger.streamWritable = false;
          }
        }
      } catch {
        // Keep stdout/stderr logging even if disk writes fail.
      }
      fn(...args);
    };

    console.log = (...args: any[]) => write("info", original.log, ...args);
    console.info = (...args: any[]) => write("info", original.info, ...args);
    console.warn = (...args: any[]) => write("warn", original.warn, ...args);
    console.error = (...args: any[]) => write("error", original.error, ...args);
    console.debug = (...args: any[]) => write("debug", original.debug, ...args);
  }

  public static setEnabledTypes(types: string[]): void {
    ServerLogger.enabledTypes = new Set(
      (types || []).map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    );
    GameConstants.SERVER_LOG_ENABLED_TYPES = Array.from(
      ServerLogger.enabledTypes.values()
    );
  }

  public static setDisabledTypes(types: string[]): void {
    ServerLogger.disabledTypes = new Set(
      (types || []).map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    );
    GameConstants.SERVER_LOG_DISABLED_TYPES = Array.from(
      ServerLogger.disabledTypes.values()
    );
  }

  public static setEnabledLevels(levels: LogLevel[]): void {
    ServerLogger.enabledLevels = new Set(levels || []);
    GameConstants.SERVER_LOG_LEVELS = Array.from(ServerLogger.enabledLevels.values());
  }

  public static getEnabledLevels(): LogLevel[] {
    return Array.from(ServerLogger.enabledLevels.values());
  }

  public static getEnabledTypes(): string[] {
    return Array.from(ServerLogger.enabledTypes.values());
  }

  public static getDisabledTypes(): string[] {
    return Array.from(ServerLogger.disabledTypes.values());
  }

  public static isWriteEnabled(): boolean {
    return GameConstants.SERVER_LOG_WRITES_ENABLED;
  }
}
