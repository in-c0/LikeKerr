import {
  HrSyncTracker,
  planTargetHr,
  type AthleteCalibration,
} from "../src/index.js";
import {
  SafetyPolicy,
  composeSafetyEnvelope,
} from "../src/safetyPolicy.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const athlete: AthleteCalibration = {
  restingHrBpm: 60,
  workingMaxHrBpm: 190,
  adaptiveScale: 0.82,
};

const effort = { tMs: 0, effort01: 1 };
assert(planTargetHr(effort, athlete, 50).targetHrBpm === 125, "50% should map to half HR reserve");
assert(planTargetHr(effort, athlete, 80).targetHrBpm === 164, "80% should map to 80% HR reserve");
assert(planTargetHr(effort, athlete, 100).targetHrBpm === 190, "100% should reach calibrated working max");
assert(planTargetHr(effort, athlete, 120).targetHrBpm === 190, "120% overload must remain bounded by working max");
assert(
  Math.abs(planTargetHr(effort, athlete, "adaptive").targetHrBpm - 166.6) < 1e-9,
  "Adaptive should use configured relative-effort scale",
);

const lagged = new HrSyncTracker(athlete, {
  smoothingWindowSamples: 1,
  lagSamples: 1,
  currentWindowSamples: 2,
});
let snapshot = lagged.push(100, 70);
assert(snapshot.validSamples === 0, "lagged sync should wait for comparable samples");
snapshot = lagged.push(120, 100);
assert(snapshot.currentSync === 100, "one-sample lag should align delayed HR with prior target");
snapshot = lagged.push(140, 120);
assert(snapshot.currentSync === 100 && snapshot.sessionSync === 100, "aligned delayed trace should stay fully synced");

const smoothed = new HrSyncTracker(athlete, {
  smoothingWindowSamples: 2,
  lagSamples: 0,
  currentWindowSamples: 2,
});
smoothed.push(100, 100);
const smoothSnapshot = smoothed.push(140, 120);
assert(
  smoothSnapshot.sessionSync !== null && smoothSnapshot.sessionSync > 90,
  "smoothing should score the averaged trajectories rather than only the latest spike",
);

const envelope = composeSafetyEnvelope(
  {
    maxSpeedKph: 16,
    maxInclinePct: 6,
    maxAccelerationKphPerSec: 1.2,
    recoverySpeedKph: 5,
  },
  {
    maxSpeedKph: 20,
    maxInclinePct: 4,
    maxAccelerationKphPerSec: 2,
  },
  { maxCommandAgeMs: 500, minCommandIntervalMs: 200 },
);
assert(envelope.maxSpeedKph === 16, "athlete speed ceiling should beat a looser machine ceiling");
assert(envelope.maxInclinePct === 4, "machine incline ceiling should beat a looser athlete ceiling");
assert(envelope.maxAccelerationKphPerSec === 1.2, "strictest acceleration ceiling should win");

const safety = new SafetyPolicy(
  {
    maxSpeedKph: 16,
    maxInclinePct: 6,
    maxAccelerationKphPerSec: 2,
    recoverySpeedKph: 5,
  },
  {
    maxSpeedKph: 18,
    maxInclinePct: 10,
    maxAccelerationKphPerSec: 3,
  },
  { maxCommandAgeMs: 500, minCommandIntervalMs: 200 },
);

let decision = safety.evaluate(
  { tMs: 1_000, speedKph: 8, inclinePct: 1 },
  {
    nowMs: 1_000,
    dtSec: 1,
    currentSpeedKph: 6,
    currentInclinePct: 1,
    hrFresh: true,
    treadmillConnected: true,
    userStop: false,
  },
);
assert(decision.shouldSend, "first safe command should be sent");

decision = safety.evaluate(
  { tMs: 1_100, speedKph: 9, inclinePct: 2 },
  {
    nowMs: 1_100,
    dtSec: 0.1,
    currentSpeedKph: 8,
    currentInclinePct: 1,
    hrFresh: true,
    treadmillConnected: true,
    userStop: false,
  },
);
assert(!decision.shouldSend, "commands inside minimum interval should be suppressed");
assert(decision.command.reasons.includes("command-rate-envelope"), "rate suppression should be explicit");

const emergency = safety.evaluate(
  { tMs: 1_150, speedKph: 9, inclinePct: 2 },
  {
    nowMs: 1_150,
    dtSec: 0.05,
    currentSpeedKph: 8,
    currentInclinePct: 1,
    hrFresh: true,
    treadmillConnected: true,
    userStop: true,
  },
);
assert(emergency.shouldSend, "user stop must bypass command-rate suppression");
assert(emergency.command.speedKph === 0, "user stop must command zero speed");

console.log("LikeKerr HR Sync + safety-policy smoke test passed");
