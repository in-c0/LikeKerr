import {
  TreadmillSimulator,
  applySafetyGuard,
  planTargetHr,
  requestWorkload,
  scoreHrSync,
  type AthleteCalibration,
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

// Synthetic plumbing fixture only. M001.1 replaces this with a real match trace.
const effortTrace = [
  ...Array(30).fill(0.25),
  ...Array(20).fill(0.5),
  ...Array(12).fill(0.9),
  ...Array(25).fill(0.35),
  ...Array(15).fill(0.75),
  ...Array(30).fill(0.3),
] as number[];

let actualHr = 78;
let totalSync = 0;
let frames = 0;

console.log("t_s,effort,target_hr,actual_hr,sync,speed_kph");
for (let t = 0; t < effortTrace.length; t += 1) {
  const target = planTargetHr({ tMs: t * 1000, effort01: effortTrace[t]! }, athlete, 80);
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
      dtSec: 1,
      currentSpeedKph: treadmill.speedKph,
      hrFresh: true,
      treadmillConnected: treadmill.connected,
      userStop: false,
    },
    envelope,
  );
  treadmill.apply(safe, 1);

  // Synthetic first-order HR response to prove session plumbing only.
  const speedEffort = Math.min(1, Math.max(0, (treadmill.speedKph - 4) / 14));
  const steadyStateHr = athlete.restingHrBpm + speedEffort * (athlete.workingMaxHrBpm - athlete.restingHrBpm);
  actualHr += (steadyStateHr - actualHr) / 25;

  const sync = scoreHrSync(target.targetHrBpm, actualHr, athlete);
  totalSync += sync;
  frames += 1;

  if (t % 10 === 0 || t === effortTrace.length - 1) {
    console.log(
      [t, effortTrace[t]!.toFixed(2), target.targetHrBpm.toFixed(1), actualHr.toFixed(1), sync.toFixed(1), treadmill.speedKph.toFixed(1)].join(","),
    );
  }
}

console.log(`session_sync=${(totalSync / frames).toFixed(1)}`);
