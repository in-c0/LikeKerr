export type Intensity = 50 | 80 | 100 | 120 | "adaptive";

export interface AthleteCalibration {
  restingHrBpm: number;
  workingMaxHrBpm: number;
  adaptiveScale?: number;
}

export interface PlayerEffortFrame {
  tMs: number;
  effort01: number;
}

export interface TargetHrFrame {
  tMs: number;
  sourceEffort01: number;
  scaledEffort01: number;
  targetHrBpm: number;
}

export interface WorkloadRequest {
  speedKph: number;
  inclinePct: number;
}

export interface WorkloadControllerConfig {
  minSpeedKph: number;
  maxSpeedKph: number;
  effortSpeedRangeKph: number;
  hrFeedbackGainKphPerBpm: number;
  inclinePct: number;
}

export interface SafetyEnvelope {
  maxSpeedKph: number;
  maxInclinePct: number;
  maxAccelerationKphPerSec: number;
  recoverySpeedKph: number;
}

export interface SafetyState {
  dtSec: number;
  currentSpeedKph: number;
  hrFresh: boolean;
  treadmillConnected: boolean;
  userStop: boolean;
}

export interface SafeWorkloadCommand extends WorkloadRequest {
  limited: boolean;
  reasons: string[];
}

export interface TreadmillCapabilities {
  maxSpeedKph: number;
  maxInclinePct: number;
  maxAccelerationKphPerSec: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function intensityScale(intensity: Intensity, calibration: AthleteCalibration): number {
  if (intensity === "adaptive") {
    return clamp(calibration.adaptiveScale ?? 0.8, 0.3, 1.0);
  }

  if (intensity === 120) {
    // 120% is overload, not literal speed/HR multiplication. The v0 model
    // modestly raises relative effort while the athlete envelope still caps HR.
    return 1.08;
  }

  return intensity / 100;
}

export function planTargetHr(
  frame: PlayerEffortFrame,
  calibration: AthleteCalibration,
  intensity: Intensity,
): TargetHrFrame {
  if (calibration.workingMaxHrBpm <= calibration.restingHrBpm) {
    throw new Error("workingMaxHrBpm must be greater than restingHrBpm");
  }

  const sourceEffort01 = clamp(frame.effort01, 0, 1);
  const scaledEffort01 = clamp(sourceEffort01 * intensityScale(intensity, calibration), 0, 1);
  const reserve = calibration.workingMaxHrBpm - calibration.restingHrBpm;
  const targetHrBpm = calibration.restingHrBpm + scaledEffort01 * reserve;

  return {
    tMs: frame.tMs,
    sourceEffort01,
    scaledEffort01,
    targetHrBpm,
  };
}

export function scoreHrSync(
  targetHrBpm: number,
  actualHrBpm: number,
  calibration: AthleteCalibration,
): number {
  const reserve = calibration.workingMaxHrBpm - calibration.restingHrBpm;
  if (reserve <= 0) {
    throw new Error("workingMaxHrBpm must be greater than restingHrBpm");
  }

  const normalisedError = Math.abs(targetHrBpm - actualHrBpm) / reserve;
  return clamp(100 * (1 - normalisedError), 0, 100);
}

export function movingAverage(values: readonly number[], window: number): number[] {
  if (!Number.isInteger(window) || window <= 0) {
    throw new Error("window must be a positive integer");
  }

  const result: number[] = [];
  let sum = 0;
  const queue: number[] = [];

  for (const value of values) {
    queue.push(value);
    sum += value;
    if (queue.length > window) {
      sum -= queue.shift()!;
    }
    result.push(sum / queue.length);
  }

  return result;
}

export function requestWorkload(
  target: TargetHrFrame,
  actualHrBpm: number,
  config: WorkloadControllerConfig,
): WorkloadRequest {
  if (config.maxSpeedKph < config.minSpeedKph) {
    throw new Error("maxSpeedKph must be >= minSpeedKph");
  }

  const feedForwardSpeed =
    config.minSpeedKph + target.scaledEffort01 * Math.max(0, config.effortSpeedRangeKph);
  const hrErrorBpm = target.targetHrBpm - actualHrBpm;
  const feedbackCorrection = hrErrorBpm * config.hrFeedbackGainKphPerBpm;

  return {
    speedKph: clamp(feedForwardSpeed + feedbackCorrection, 0, config.maxSpeedKph),
    inclinePct: Math.max(0, config.inclinePct),
  };
}

export function applySafetyGuard(
  request: WorkloadRequest,
  state: SafetyState,
  envelope: SafetyEnvelope,
): SafeWorkloadCommand {
  const reasons: string[] = [];

  if (state.userStop) {
    return { speedKph: 0, inclinePct: 0, limited: true, reasons: ["user-stop"] };
  }

  if (!state.treadmillConnected) {
    return { speedKph: 0, inclinePct: 0, limited: true, reasons: ["treadmill-disconnected"] };
  }

  let desiredSpeed = request.speedKph;
  let desiredIncline = request.inclinePct;

  if (!state.hrFresh) {
    desiredSpeed = Math.min(desiredSpeed, envelope.recoverySpeedKph);
    reasons.push("hr-stale-recovery");
  }

  const cappedSpeed = clamp(desiredSpeed, 0, envelope.maxSpeedKph);
  if (cappedSpeed !== desiredSpeed) reasons.push("speed-envelope");

  const cappedIncline = clamp(desiredIncline, 0, envelope.maxInclinePct);
  if (cappedIncline !== desiredIncline) reasons.push("incline-envelope");

  const maxDelta = Math.max(0, envelope.maxAccelerationKphPerSec * Math.max(0, state.dtSec));
  const minReachable = Math.max(0, state.currentSpeedKph - maxDelta);
  const maxReachable = state.currentSpeedKph + maxDelta;
  const slewLimitedSpeed = clamp(cappedSpeed, minReachable, maxReachable);
  if (slewLimitedSpeed !== cappedSpeed) reasons.push("acceleration-envelope");

  return {
    speedKph: slewLimitedSpeed,
    inclinePct: cappedIncline,
    limited: reasons.length > 0,
    reasons,
  };
}

export class TreadmillSimulator {
  readonly capabilities: TreadmillCapabilities;
  speedKph = 0;
  inclinePct = 0;
  connected = true;

  constructor(capabilities: TreadmillCapabilities) {
    this.capabilities = capabilities;
  }

  disconnect(): void {
    this.connected = false;
  }

  connect(): void {
    this.connected = true;
  }

  apply(command: WorkloadRequest, dtSec: number): void {
    if (!this.connected) return;

    const maxDelta = this.capabilities.maxAccelerationKphPerSec * Math.max(0, dtSec);
    this.speedKph = clamp(
      command.speedKph,
      Math.max(0, this.speedKph - maxDelta),
      Math.min(this.capabilities.maxSpeedKph, this.speedKph + maxDelta),
    );
    this.inclinePct = clamp(command.inclinePct, 0, this.capabilities.maxInclinePct);
  }
}
