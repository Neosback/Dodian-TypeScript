import * as fs from "fs";
import * as path from "path";

type TickPhaseMap = Map<string, number>;

type TickSample = {
  at: number;
  tickNumber: number;
  driftMs: number;
  durationMs: number;
  players: number;
  npcs: number;
  tasks: number;
  phases: TickPhaseMap;
};

type PhaseSummary = {
  name: string;
  totalMs: number;
  avgMs: number;
  maxMs: number;
};

function parseEnvFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return defaultValue;
}

export class ServerPerf {
  private static readonly SAMPLE_CAP = 300;
  private static readonly SNAPSHOT_FILE = path.join(
    process.cwd(),
    "logs",
    "server-performance.snapshot.log"
  );
  private static readonly PERIODIC_SNAPSHOT_FILE = path.join(
    process.cwd(),
    "logs",
    "server-performance.periodic.log"
  );
  private static readonly PERIODIC_SNAPSHOT_LATEST_FILE = path.join(
    process.cwd(),
    "logs",
    "server-performance.periodic.latest.log"
  );
  private static readonly AUTO_SNAPSHOT_FILE = path.join(
    process.cwd(),
    "logs",
    "server-performance.auto.log"
  );
  private static readonly AUTO_SNAPSHOT_LATEST_FILE = path.join(
    process.cwd(),
    "logs",
    "server-performance.auto.latest.log"
  );
  private static readonly AUTO_SNAPSHOT_COOLDOWN_MS = 15000;
  private static readonly AUTO_SUMMARY_TICKS = 30;
  private static readonly AUTO_TICK_AVG_THRESHOLD_MS = 140;
  private static readonly AUTO_TICK_MAX_THRESHOLD_MS = 220;
  private static readonly AUTO_PHASE_AVG_THRESHOLD_MS = 90;
  private static readonly AUTO_SNAPSHOT_ENABLED = parseEnvFlag(
    process.env.SERVER_PERF_AUTO_ENABLED,
    false
  );
  private static readonly PERIODIC_SNAPSHOT_ENABLED = parseEnvFlag(
    process.env.SERVER_PERF_PERIODIC_ENABLED,
    false
  );
  private static readonly PERIODIC_SUMMARY_TICKS = (() => {
    const parsed = Number.parseInt(process.env.SERVER_PERF_PERIODIC_SUMMARY_TICKS ?? "60", 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 60;
    }
    return Math.min(300, Math.max(10, parsed));
  })();
  private static readonly PERIODIC_SNAPSHOT_INTERVAL_MS = (() => {
    const parsed = Number.parseInt(process.env.SERVER_PERF_PERIODIC_INTERVAL_MS ?? "10000", 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 10000;
    }
    return parsed;
  })();
  private static samples: TickSample[] = [];
  private static currentTick: TickSample | null = null;
  private static lastAutoSnapshotAt = 0;
  private static lastPeriodicSnapshotAt = 0;

  public static beginTick(
    tickNumber: number,
    driftMs: number,
    players: number,
    npcs: number,
    tasks: number
  ): void {
    ServerPerf.currentTick = {
      at: Date.now(),
      tickNumber,
      driftMs,
      durationMs: 0,
      players,
      npcs,
      tasks,
      phases: new Map<string, number>(),
    };
  }

  public static addPhaseDuration(phase: string, durationMs: number): void {
    const current = ServerPerf.currentTick;
    if (!current) {
      return;
    }
    const prev = current.phases.get(phase) ?? 0;
    current.phases.set(phase, prev + durationMs);
  }

  public static measurePhase<T>(phase: string, fn: () => T): T {
    const started = process.hrtime.bigint();
    try {
      return fn();
    } finally {
      ServerPerf.addPhaseDuration(phase, Number(process.hrtime.bigint() - started) / 1_000_000);
    }
  }

  public static isPeriodicSnapshotEnabled(): boolean {
    return ServerPerf.PERIODIC_SNAPSHOT_ENABLED;
  }

  public static endTick(
    durationMs: number,
    players: number,
    npcs: number,
    tasks: number
  ): void {
    const current = ServerPerf.currentTick;
    if (!current) {
      return;
    }
    current.durationMs = durationMs;
    current.players = players;
    current.npcs = npcs;
    current.tasks = tasks;
    ServerPerf.samples.push(current);
    if (ServerPerf.samples.length > ServerPerf.SAMPLE_CAP) {
      ServerPerf.samples.shift();
    }
    ServerPerf.currentTick = null;
    ServerPerf.maybeWriteAutoSnapshot(current);
    ServerPerf.maybeWritePeriodicSnapshot(current);
  }

  public static getSummary(limitTicks = 60): {
    ticks: number;
    avgTickMs: number;
    maxTickMs: number;
    avgDriftMs: number;
    maxDriftMs: number;
    lastTickNumber: number;
    lastPlayers: number;
    lastNpcs: number;
    lastTasks: number;
    topPhases: PhaseSummary[];
  } {
    const count = Math.max(1, Math.min(Math.floor(limitTicks), ServerPerf.samples.length || 1));
    const samples =
      ServerPerf.samples.length > 0
        ? ServerPerf.samples.slice(Math.max(0, ServerPerf.samples.length - count))
        : [];
    const actualCount = samples.length;

    if (actualCount === 0) {
      return {
        ticks: 0,
        avgTickMs: 0,
        maxTickMs: 0,
        avgDriftMs: 0,
        maxDriftMs: 0,
        lastTickNumber: 0,
        lastPlayers: 0,
        lastNpcs: 0,
        lastTasks: 0,
      topPhases: [],
      };
    }

    let tickTotal = 0;
    let tickMax = 0;
    let driftTotal = 0;
    let driftMax = 0;
    const phaseAgg = new Map<
      string,
      {
        totalMs: number;
        maxMs: number;
      }
    >();

    for (const s of samples) {
      tickTotal += s.durationMs;
      tickMax = Math.max(tickMax, s.durationMs);
      driftTotal += s.driftMs;
      driftMax = Math.max(driftMax, s.driftMs);
      for (const [phase, ms] of s.phases.entries()) {
        const prev = phaseAgg.get(phase);
        if (!prev) {
          phaseAgg.set(phase, { totalMs: ms, maxMs: ms });
          continue;
        }
        prev.totalMs += ms;
        prev.maxMs = Math.max(prev.maxMs, ms);
      }
    }

    const topPhases: PhaseSummary[] = Array.from(phaseAgg.entries())
      .map(([name, agg]) => ({
        name,
        totalMs: agg.totalMs,
        avgMs: agg.totalMs / actualCount,
        maxMs: agg.maxMs,
      }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 20);

    const last = samples[samples.length - 1];
    return {
      ticks: actualCount,
      avgTickMs: tickTotal / actualCount,
      maxTickMs: tickMax,
      avgDriftMs: driftTotal / actualCount,
      maxDriftMs: driftMax,
      lastTickNumber: last.tickNumber,
      lastPlayers: last.players,
      lastNpcs: last.npcs,
      lastTasks: last.tasks,
      topPhases,
    };
  }

  private static maybeWriteAutoSnapshot(sample: TickSample): void {
    if (!ServerPerf.AUTO_SNAPSHOT_ENABLED) {
      return;
    }
    const nowMs = Date.now();
    if (nowMs - ServerPerf.lastAutoSnapshotAt < ServerPerf.AUTO_SNAPSHOT_COOLDOWN_MS) {
      return;
    }

    const summary = ServerPerf.getSummary(ServerPerf.AUTO_SUMMARY_TICKS);
    const hottestPhase = summary.topPhases[0] ?? null;
    const reasonParts: string[] = [];
    if (summary.avgTickMs >= ServerPerf.AUTO_TICK_AVG_THRESHOLD_MS) {
      reasonParts.push(`avgTick=${summary.avgTickMs.toFixed(1)}ms`);
    }
    if (summary.maxTickMs >= ServerPerf.AUTO_TICK_MAX_THRESHOLD_MS) {
      reasonParts.push(`maxTick=${summary.maxTickMs.toFixed(1)}ms`);
    }
    if (hottestPhase && hottestPhase.avgMs >= ServerPerf.AUTO_PHASE_AVG_THRESHOLD_MS) {
      reasonParts.push(`${hottestPhase.name}=${hottestPhase.avgMs.toFixed(1)}ms`);
    }
    if (reasonParts.length === 0) {
      return;
    }

    const timestamp = new Date(nowMs).toISOString();
    const lines: string[] = [
      `${timestamp} [serverperf-auto] reason=${reasonParts.join(" ")}`,
      `${timestamp} [serverperf-auto] ticks=${summary.ticks} avgTick=${summary.avgTickMs.toFixed(
        1
      )}ms maxTick=${summary.maxTickMs.toFixed(1)}ms avgDrift=${summary.avgDriftMs.toFixed(
        1
      )}ms maxDrift=${summary.maxDriftMs.toFixed(1)}ms`,
      `${timestamp} [serverperf-auto] lastTick=${sample.tickNumber} players=${sample.players} npcs=${sample.npcs} tasks=${sample.tasks} duration=${sample.durationMs.toFixed(
        1
      )}ms drift=${sample.driftMs.toFixed(1)}ms`,
    ];

    for (const phase of summary.topPhases.slice(0, 12)) {
      lines.push(
        `${timestamp} [serverperf-auto] ${phase.name}: total=${phase.totalMs.toFixed(
          1
        )}ms avg=${phase.avgMs.toFixed(1)}ms max=${phase.maxMs.toFixed(1)}ms`
      );
    }

    const payload = `${lines.join("\n")}\n`;
    fs.mkdirSync(path.dirname(ServerPerf.AUTO_SNAPSHOT_FILE), { recursive: true });
    fs.appendFileSync(ServerPerf.AUTO_SNAPSHOT_FILE, payload, "utf8");
    fs.writeFileSync(ServerPerf.AUTO_SNAPSHOT_LATEST_FILE, payload, "utf8");
    ServerPerf.lastAutoSnapshotAt = nowMs;
  }

  private static maybeWritePeriodicSnapshot(sample: TickSample): void {
    if (!ServerPerf.PERIODIC_SNAPSHOT_ENABLED) {
      return;
    }
    if (ServerPerf.PERIODIC_SNAPSHOT_INTERVAL_MS <= 0) {
      return;
    }
    const nowMs = Date.now();
    if (nowMs - ServerPerf.lastPeriodicSnapshotAt < ServerPerf.PERIODIC_SNAPSHOT_INTERVAL_MS) {
      return;
    }
    const summary = ServerPerf.getSummary(ServerPerf.PERIODIC_SUMMARY_TICKS);
    if (!summary || summary.ticks <= 0) {
      return;
    }
    const timestamp = new Date(nowMs).toISOString();
    const lines: string[] = [
      `${timestamp} [serverperf] ticks=${summary.ticks} avgTick=${summary.avgTickMs.toFixed(
        1
      )}ms maxTick=${summary.maxTickMs.toFixed(1)}ms avgDrift=${summary.avgDriftMs.toFixed(
        1
      )}ms maxDrift=${summary.maxDriftMs.toFixed(1)}ms`,
      `${timestamp} [serverperf] lastTick=${sample.tickNumber} players=${sample.players} npcs=${sample.npcs} tasks=${sample.tasks}`,
    ];
    for (const phase of summary.topPhases) {
      lines.push(
        `${timestamp} [serverperf] ${phase.name}: total=${phase.totalMs.toFixed(
          1
        )}ms avg=${phase.avgMs.toFixed(1)}ms max=${phase.maxMs.toFixed(1)}ms`
      );
    }
    const payload = `${lines.join("\n")}\n`;
    fs.mkdirSync(path.dirname(ServerPerf.SNAPSHOT_FILE), { recursive: true });
    fs.appendFileSync(ServerPerf.SNAPSHOT_FILE, payload, "utf8");
    fs.appendFileSync(ServerPerf.PERIODIC_SNAPSHOT_FILE, payload, "utf8");
    fs.writeFileSync(ServerPerf.PERIODIC_SNAPSHOT_LATEST_FILE, payload, "utf8");
    ServerPerf.lastPeriodicSnapshotAt = nowMs;
  }
}
