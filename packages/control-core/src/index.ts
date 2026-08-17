export type Intensity = 50 | 80 | 100 | 120 | "adaptive";

export interface AthleteCalibration {
  restingHrBpm: number;
  workingMaxHrBpm: number;
  adaptiveScale?: number;
}

export interface HeartRateSample {
  tMs: number;
  bpm: number;
  connected: boolean;
}

export interface HeartRateSource {
  readonly connected: boolean;
  connect(): void | Promise<void>;
  disconnect(): void | Promise<void>;
  sample(tMs: number): HeartRateSample | null;
}

export class HeartRateSimulator implements HeartRateSource {
  connected = false;
  private readonly samples: readonly HeartRateSample[];

  constructor(samples: readonly Omit<HeartRateSample, "connected">[]) {
    this.samples = [...samples]
      .sort((a, b) => a.tMs - b.tMs)
      .map((sample) => ({ ...sample, connected: true }));
  }

  connect(): void {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  sample(tMs: number): HeartRateSample | null {
    if (!this.connected || !Number.isFinite(tMs)) return null;

    let match: HeartRateSample | null = null;
    for (const sample of this.samples) {
      if (sample.tMs > tMs) break;
      match = sample;
    }
    return match ? { ...match, connected: true } : null;
  }
}

export interface PlayerEffortFrame {
  tMs: number;
  effort01: number;
}

export interface PlayerTracePoint extends PlayerEffortFrame {
  xM: number;
  yM: number;
  speedMps: number;
  accelMps2: number;
}

export interface PlayerTraceSource {
  sample(tMs: number): PlayerTracePoint | null;
}

export class ArrayPlayerTraceSource implements PlayerTraceSource {
  private readonly points: readonly PlayerTracePoint[];

  constructor(points: readonly PlayerTracePoint[]) {
    this.points = [...points].sort((a, b) => a.tMs - b.tMs);
  }

  sample(tMs: number): PlayerTracePoint | null {
    if (!Number.isFinite(tMs)) return null;

    let match: PlayerTracePoint | null = null;
    for (const point of this.points) {
      if (point.tMs > tMs) break;
      match = point;
    }
    return match ? { ...match } : null;
  }
}

export interface TargetHrFrame {
  tMs: number;
  sourceEffort01: number;
  scaledEffort01: number;
  targetHrBpm: number;
}

export interface WorkloadRequest {
  tMs: number;
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

export interface HrSyncConfig {
  smoothingWindowSamples: number;
  lagSamples: number;
  currentWindowSamples: number;
}

export interface HrSyncSnapshot {
  currentSync: number | null;
  sessionSync: number | null;
  validSamples: number;
}

export class HrSyncTracker {
  private readonly targetHistory: number[] = [];
  private readonly actualHistory: number[] = [];
  private readonly scores: number[] = [];

  constructor(
    private readonly calibration: AthleteCalibration,
    private readonly config: HrSyncConfig,
  ) {
    if (!Number.isInteger(config.smoothingWindowSamples) || config.smoothingWindowSamples <= 0) {
      throw new Error("smoothingWindowSamples must be a positive integer");
    }
    if (!Number.isInteger(config.lagSamples) || config.lagSamples < 0) {
      throw new Error("lagSamples must be a non-negative integer");
    }
    if (!Number.isInteger(config.currentWindowSamples) || config.currentWindowSamples <= 0) {
      throw new Error("currentWindowSamples must be a positive integer");
    }
  }

  push(targetHrBpm: number, actualHrBpm: number): HrSyncSnapshot {
    if (!Number.isFinite(targetHrBpm) || !Number.isFinite(actualHrBpm)) {
      throw new Error("HR samples must be finite");
    }

    this.targetHistory.push(targetHrBpm);
    this.actualHistory.push(actualHrBpm);

    const index = this.actualHistory.length - 1;
    const targetIndex = index - this.config.lagSamples;
    if (targetIndex >= 0) {
      const smoothedTarget = trailingMean(
        this.targetHistory,
        targetIndex,
        this.config.smoothingWindowSamples,
      );
      const smoothedActual = trailingMean(
        this.actualHistory,
        index,
        this.config.smoothingWindowSamples,
      );
      this.scores.push(scoreHrSync(smoothedTarget, smoothedActual, this.calibration));
    }

    const recent = this.scores.slice(-this.config.currentWindowSamples);
    return {
      currentSync: recent.length > 0 ? mean(recent) : null,
      sessionSync: this.scores.length > 0 ? mean(this.scores) : null,
      validSamples: this.scores.length,
    };
  }
}

export interface SafetyEnvelope {
  maxSpeedKph: number;
  maxInclinePct: number;
  maxAccelerationKphPerSec: number;
  recoverySpeedKph: number;
  maxCommandAgeMs: number;
}

export interface SafetyState {
  nowMs: number;
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

export interface TreadmillCommandLogEntry {
  command: WorkloadRequest;
  accepted: boolean;
  reason: string | null;
  resultingSpeedKph: number;
  resultingInclinePct: number;
}

export interface TreadmillAdapter {
  readonly capabilities: TreadmillCapabilities;
  readonly connected: boolean;
  apply(command: WorkloadRequest, dtSec: number): boolean;
  stop(tMs: number): void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

function trailingMean(values: readonly number[], endIndex: number, window: number): number {
  const start = Math.max(0, endIndex - window + 1);
  return mean(values.slice(start, endIndex + 1));
}

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

  return values.map((_, index) => trailingMean(values, index, window));
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
    tMs: target.tMs,
    speedKph: clamp(feedForwardSpeed + feedbackCorrection, 0, config.maxSpeedKph),
    inclinePct: Math.max(0, config.inclinePct),
  };
}

export function applySafetyGuard(
  request: WorkloadRequest,
  state: SafetyState,
  envelope: SafetyEnvelope,
): SafeWorkloadCommand {
  if (state.userStop) {
    return { ...request, speedKph: 0, inclinePct: 0, limited: true, reasons: ["user-stop"] };
  }

  if (!state.treadmillConnected) {
    return {
      ...request,
      speedKph: 0,
      inclinePct: 0,
      limited: true,
      reasons: ["treadmill-disconnected"],
    };
  }

  if (
    !Number.isFinite(request.tMs) ||
    !Number.isFinite(request.speedKph) ||
    !Number.isFinite(request.inclinePct)
  ) {
    return { ...request, speedKph: 0, inclinePct: 0, limited: true, reasons: ["invalid-command"] };
  }

  const commandAgeMs = state.nowMs - request.tMs;
  if (!Number.isFinite(commandAgeMs) || commandAgeMs < 0 || commandAgeMs > envelope.maxCommandAgeMs) {
    return {
      ...request,
      speedKph: 0,
      inclinePct: 0,
      limited: true,
      reasons: ["stale-controller-command"],
    };
  }

  const reasons: string[] = [];
  let desiredSpeed = request.speedKph;
  const desiredIncline = request.inclinePct;

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
    ...request,
    speedKph: slewLimitedSpeed,
    inclinePct: cappedIncline,
    limited: reasons.length > 0,
    reasons,
  };
}

export class TreadmillSimulator implements TreadmillAdapter {
  readonly commandLog: TreadmillCommandLogEntry[] = [];
  speedKph = 0;
  inclinePct = 0;
  connected = true;

  constructor(readonly capabilities: TreadmillCapabilities) {}

  disconnect(): void {
    this.connected = false;
  }

  connect(): void {
    this.connected = true;
  }

  apply(command: WorkloadRequest, dtSec: number): boolean {
    const valid =
      Number.isFinite(command.tMs) &&
      Number.isFinite(command.speedKph) &&
      Number.isFinite(command.inclinePct) &&
      Number.isFinite(dtSec) &&
      dtSec >= 0;

    if (!this.connected || !valid) {
      if (valid && !this.connected) {
        this.commandLog.push({
          command: { ...command },
          accepted: false,
          reason: "disconnected",
          resultingSpeedKph: this.speedKph,
          resultingInclinePct: this.inclinePct,
        });
      } else {
        this.speedKph = 0;
        this.inclinePct = 0;
        this.commandLog.push({
          command: { ...command },
          accepted: false,
          reason: "invalid-command",
          resultingSpeedKph: 0,
          resultingInclinePct: 0,
        });
      }
      return false;
    }

    const maxDelta = this.capabilities.maxAccelerationKphPerSec * dtSec;
    this.speedKph = clamp(
      command.speedKph,
      Math.max(0, this.speedKph - maxDelta),
      Math.min(this.capabilities.maxSpeedKph, this.speedKph + maxDelta),
    );
    this.inclinePct = clamp(command.inclinePct, 0, this.capabilities.maxInclinePct);
    this.commandLog.push({
      command: { ...command },
      accepted: true,
      reason: null,
      resultingSpeedKph: this.speedKph,
      resultingInclinePct: this.inclinePct,
    });
    return true;
  }

  stop(tMs: number): void {
    const command = { tMs, speedKph: 0, inclinePct: 0 };
    this.speedKph = 0;
    this.inclinePct = 0;
    this.commandLog.push({
      command,
      accepted: true,
      reason: "stop",
      resultingSpeedKph: 0,
      resultingInclinePct: 0,
    });
  }
}
