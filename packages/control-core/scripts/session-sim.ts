import {
  TreadmillSimulator,
  applySafetyGuard,
  planTargetHr,
  requestWorkload,
  scoreHrSync,
  type AthleteCalibration,
  type PlayerEffortFrame,
  type SafetyEnvelope,
} from "../src/index.js";

const athlete: AthleteCalibration = { restingHrBpm: 60, workingMaxHrBpm: 190 };
const envelope: SafetyEnvelope = {
  maxSpeedKph: 18,
  maxInclinePct: 8,
  maxAccelerationKphPerSec: 1.5,
  recoverySpeedKph: 5,
};
const treadmill = new TreadmillSimulator({
  maxSpeedKph: 18,
  maxInclinePct: 8,
  maxAccelerationKphPerSec: 1.5,
});

// Real Metrica/Kloppy Player11 fixture derived by
// scripts/derive-demo-player-trace.mjs and committed at
// data/demo/metrica-kloppy-player11.csv.
const effortTrace: PlayerEffortFrame[] = [
  { tMs: 0, effort01: 0.0 },
  { tMs: 40, effort01: 0.049 },
  { tMs: 80, effort01: 0.063 },
];

let actualHr = 78;
let totalSync = 0;
let frames = 0;
let previousTMs = -40;

console.log("t_ms,effort,target_hr,actual_hr,sync,speed_kph");
for (const frame of effortTrace) {
  const dtSec = Math.max(0.04, (frame.tMs - previousTMs) / 1000);
  previousTMs = frame.tMs;

  const target = planTargetHr(frame, athlete, 80);
  const request = requestWorkload(target, actualHr, {
    minSpeedKph: 4,
    maxSpeedKph: 18,
    effortSpeedRangeKph: 11,
    hrFeedbackGainKphPerBpm: 0.06,
    inclinePct: 1,
  });
  const safe = applySafetyGuard(
    request,
    {
      dtSec,
      currentSpeedKph: treadmill.speedKph,
      hrFresh: true,
      treadmillConnected: treadmill.connected,
      userStop: false,
    },
    envelope,
  );
  treadmill.apply(safe, dtSec);

  // Synthetic first-order HR response: plumbing test only, not physiology evidence.
  const speedEffort = Math.min(1, Math.max(0, (treadmill.speedKph - 4) / 14));
  const steadyStateHr = athlete.restingHrBpm + speedEffort * (athlete.workingMaxHrBpm - athlete.restingHrBpm);
  actualHr += (steadyStateHr - actualHr) * (dtSec / 25);

  const sync = scoreHrSync(target.targetHrBpm, actualHr, athlete);
  totalSync += sync;
  frames += 1;

  console.log(
    [frame.tMs, frame.effort01.toFixed(3), target.targetHrBpm.toFixed(1), actualHr.toFixed(1), sync.toFixed(1), treadmill.speedKph.toFixed(2)].join(","),
  );
}

console.log(`session_sync=${(totalSync / frames).toFixed(1)}`);
