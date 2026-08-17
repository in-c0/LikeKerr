import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  HrSyncTracker,
  TreadmillSimulator,
  planTargetHr,
  requestWorkload,
} from "../../packages/control-core/dist/src/index.js";
import { SafetyPolicy } from "../../packages/control-core/dist/src/safetyPolicy.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const htmlPath = join(here, "index.html");
const tracePath = join(repoRoot, "data/demo/metrica-epts-player11.csv");
const sessionsDir = join(repoRoot, "var/sessions");

function parseTrace(csv) {
  const [, ...lines] = csv.trim().split(/\r?\n/);
  return lines.map((line) => {
    const [tMs, frame, xM, yM, speedMps, effort01] = line.split(",").map(Number);
    return { tMs, frame, xM, yM, speedMps, effort01 };
  });
}

const athlete = {
  restingHrBpm: 60,
  workingMaxHrBpm: 190,
  adaptiveScale: 0.82,
};

const controllerConfig = {
  minSpeedKph: 4,
  maxSpeedKph: 16,
  effortSpeedRangeKph: 10,
  hrFeedbackGainKphPerBpm: 0.05,
  inclinePct: 1,
};

function createSession(trace) {
  const treadmill = new TreadmillSimulator({
    maxSpeedKph: 18,
    maxInclinePct: 10,
    maxAccelerationKphPerSec: 2,
  });
  const safety = new SafetyPolicy(
    {
      maxSpeedKph: 16,
      maxInclinePct: 6,
      maxAccelerationKphPerSec: 1.5,
      recoverySpeedKph: 5,
    },
    treadmill.capabilities,
    { maxCommandAgeMs: 500, minCommandIntervalMs: 200 },
  );
  const sync = new HrSyncTracker(athlete, {
    smoothingWindowSamples: 2,
    lagSamples: 1,
    currentWindowSamples: 4,
  });

  let actualHr = 118;
  let distanceKm = 0;
  let maxHr = actualHr;
  let maxSpeedKph = 0;
  let sumHr = 0;
  let hrSamples = 0;
  const sessionSync = [];

  return {
    step(point, index) {
      // UI replay is slowed to 1 Hz; source frame/time stay visible separately.
      const demoTMs = index * 1000;
      const target = planTargetHr({ tMs: demoTMs, effort01: point.effort01 }, athlete, 80);
      const request = requestWorkload(target, actualHr, controllerConfig);
      const decision = safety.evaluate(request, {
        nowMs: demoTMs,
        dtSec: 1,
        currentSpeedKph: treadmill.speedKph,
        currentInclinePct: treadmill.inclinePct,
        hrFresh: true,
        treadmillConnected: treadmill.connected,
        userStop: false,
      });
      if (decision.shouldSend) treadmill.apply(decision.command, 1);

      // Synthetic first-order HR response for UI plumbing only.
      const speedEffort = Math.min(1, Math.max(0, (treadmill.speedKph - 4) / 12));
      const steadyHr = athlete.restingHrBpm + speedEffort * (athlete.workingMaxHrBpm - athlete.restingHrBpm);
      actualHr += (steadyHr - actualHr) / 14;

      const syncSnapshot = sync.push(target.targetHrBpm, actualHr);
      distanceKm += treadmill.speedKph / 3600;
      maxHr = Math.max(maxHr, actualHr);
      maxSpeedKph = Math.max(maxSpeedKph, treadmill.speedKph);
      sumHr += actualHr;
      hrSamples += 1;
      if (syncSnapshot.currentSync !== null) sessionSync.push(syncSnapshot.currentSync);

      const next = trace[index + 1] ?? null;
      return {
        type: "frame",
        demoTMs,
        source: {
          frame: point.frame,
          sourceTMs: point.tMs,
          xM: point.xM,
          yM: point.yM,
          speedMps: point.speedMps,
          effort01: point.effort01,
        },
        targetHrBpm: target.targetHrBpm,
        actualHrBpm: actualHr,
        hrSync: syncSnapshot.currentSync,
        sessionSync: syncSnapshot.sessionSync,
        treadmill: {
          speedKph: treadmill.speedKph,
          inclinePct: treadmill.inclinePct,
          simulated: true,
        },
        distanceKm,
        nextEffort01: next?.effort01 ?? null,
        safety: {
          limited: decision.command.limited,
          reasons: decision.command.reasons,
        },
      };
    },
    summary(frameCount = trace.length) {
      const meanSync = sessionSync.length
        ? sessionSync.reduce((sum, value) => sum + value, 0) / sessionSync.length
        : null;
      return {
        type: "summary",
        elapsedSec: Math.max(0, frameCount - 1),
        distanceKm,
        averageHrBpm: hrSamples ? sumHr / hrSamples : null,
        maxHrBpm: maxHr,
        maxSpeedKph,
        hrSync: meanSync,
        sourceFrames: frameCount,
      };
    },
  };
}

async function persistSession(frames, summary, status) {
  await mkdir(sessionsDir, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${id}-${status}.json`;
  const payload = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    status,
    source: "Metrica EPTS / Kloppy fixture, anonymised Home Player11",
    measured: ["source.position", "source.speed"],
    simulated: ["actualHrBpm", "treadmill"],
    frames,
    summary,
  };
  await writeFile(join(sessionsDir, filename), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return `var/sessions/${filename}`;
}

async function buildSelfTestFrame() {
  const trace = parseTrace(await readFile(tracePath, "utf8"));
  if (trace.length < 2) throw new Error("Accessible demo trace is too short");
  const session = createSession(trace);
  const frame = session.step(trace[0], 0);
  if (!Number.isFinite(frame.targetHrBpm) || !Number.isFinite(frame.actualHrBpm)) {
    throw new Error("Accessible demo produced invalid HR state");
  }
  const summary = session.summary(1);
  if (!Number.isFinite(summary.maxSpeedKph) || !Number.isFinite(summary.averageHrBpm)) {
    throw new Error("Accessible demo produced invalid summary state");
  }
  return { tracePoints: trace.length, firstFrame: frame, summary };
}

if (process.argv.includes("--self-test")) {
  console.log(JSON.stringify(await buildSelfTestFrame()));
  process.exit(0);
}

const trace = parseTrace(await readFile(tracePath, "utf8"));
const html = await readFile(htmlPath, "utf8");
const port = Number(process.env.PORT ?? 4173);

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.url === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    const session = createSession(trace);
    const frames = [];
    let index = 0;
    let timer = null;
    let finished = false;
    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    const tick = async () => {
      if (index >= trace.length) {
        const summary = session.summary(frames.length);
        const telemetryPath = await persistSession(frames, summary, "completed");
        finished = true;
        send({ ...summary, telemetryPath });
        res.end();
        return;
      }
      const frame = session.step(trace[index], index);
      frames.push(frame);
      send(frame);
      index += 1;
      timer = setTimeout(() => void tick(), 1000);
    };

    void tick();
    req.on("close", () => {
      if (timer) clearTimeout(timer);
      if (!finished && frames.length) {
        const summary = session.summary(frames.length);
        void persistSession(frames, summary, "interrupted").catch((error) => {
          console.error("Failed to persist interrupted LikeKerr session", error);
        });
      }
    });
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LikeKerr Accessible prototype: http://127.0.0.1:${port}`);
});
