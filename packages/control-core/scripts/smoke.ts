import {
  TreadmillSimulator,
  applySafetyGuard,
  planTargetHr,
  requestWorkload,
  scoreHrSync,
  type AthleteCalibration,
  type SafetyEnvelope,
} from "../src/index.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const athlete: AthleteCalibration = {
  restingHrBpm: 60,
  workingMaxHrBpm: 190,
  adaptiveScale: 0.82,
};

const target = planTargetHr({ tMs: 10_000, effort01: 0.75 }, athlete, 80);
assert(Math.abs(target.scaledEffort01 - 0.6) < 1e-9, "80% intensity should scale effort to 0.6");
assert(Math.abs(target.targetHrBpm - 138) < 1e-9, "target HR should use HR reserve");
assert(scoreHrSync(150, 150, athlete) === 100, "exact HR match should score 100");
assert(scoreHrSync(190, 60, athlete) === 0, "full reserve error should score 0");

const workload = requestWorkload(target, 128, {
  minSpeedKph: 4,
  maxSpeedKph: 18,
  effortSpeedRangeKph: 10,
  hrFeedbackGainKphPerBpm: 0.1,
  inclinePct: 1,
});
assert(Math.abs(workload.speedKph - 11) < 1e-9, "workload should combine effort feed-forward and HR feedback");
assert(workload.inclinePct === 1, "workload should carry configured incline");

const envelope: SafetyEnvelope = {
  maxSpeedKph: 18,
  maxInclinePct: 10,
  maxAccelerationKphPerSec: 2,
  recoverySpeedKph: 5,
  maxCommandAgeMs: 500,
};

const guarded = applySafetyGuard(
  { tMs: 1_000, speedKph: 20, inclinePct: 12 },
  {
    nowMs: 1_000,
    dtSec: 1,
    currentSpeedKph: 8,
    hrFresh: true,
    treadmillConnected: true,
    userStop: false,
  },
  envelope,
);
assert(guarded.speedKph === 10, "safety guard should slew-limit speed to 10 kph");
assert(guarded.inclinePct === 10, "safety guard should clamp incline");
assert(guarded.reasons.includes("speed-envelope"), "speed limit reason should be reported");
assert(guarded.reasons.includes("acceleration-envelope"), "acceleration limit reason should be reported");

const staleHr = applySafetyGuard(
  { tMs: 2_000, speedKph: 12, inclinePct: 0 },
  {
    nowMs: 2_000,
    dtSec: 10,
    currentSpeedKph: 8,
    hrFresh: false,
    treadmillConnected: true,
    userStop: false,
  },
  envelope,
);
assert(staleHr.speedKph === 5, "stale HR should force recovery-speed ceiling");

const staleController = applySafetyGuard(
  { tMs: 2_000, speedKph: 12, inclinePct: 0 },
  {
    nowMs: 2_700,
    dtSec: 1,
    currentSpeedKph: 8,
    hrFresh: true,
    treadmillConnected: true,
    userStop: false,
  },
  envelope,
);
assert(staleController.speedKph === 0, "stale controller command should fail closed");
assert(staleController.reasons.includes("stale-controller-command"), "stale controller reason should be reported");

const stopped = applySafetyGuard(
  { tMs: 3_000, speedKph: 12, inclinePct: 5 },
  {
    nowMs: 3_000,
    dtSec: 1,
    currentSpeedKph: 8,
    hrFresh: true,
    treadmillConnected: true,
    userStop: true,
  },
  envelope,
);
assert(stopped.speedKph === 0 && stopped.inclinePct === 0, "user stop should override all commands");

const simulator = new TreadmillSimulator({
  maxSpeedKph: 20,
  maxInclinePct: 12,
  maxAccelerationKphPerSec: 3,
});
simulator.apply({ tMs: 4_000, speedKph: 12, inclinePct: 4 }, 1);
assert(simulator.speedKph === 3, "simulator should respect acceleration capability");
assert(simulator.inclinePct === 4, "simulator should apply safe incline");

console.log("LikeKerr control-core smoke test passed");
