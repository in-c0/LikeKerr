import {
  applySafetyGuard,
  type SafeWorkloadCommand,
  type SafetyEnvelope,
  type SafetyState,
  type WorkloadRequest,
} from "./index.js";

export interface AthleteWorkloadLimits {
  maxSpeedKph: number;
  maxInclinePct: number;
  maxAccelerationKphPerSec: number;
  recoverySpeedKph: number;
}

export interface MachineWorkloadLimits {
  maxSpeedKph: number;
  maxInclinePct: number;
  maxAccelerationKphPerSec: number;
}

export interface SafetyTimingLimits {
  maxCommandAgeMs: number;
  minCommandIntervalMs: number;
}

export interface SafetyPolicyState extends SafetyState {
  currentInclinePct: number;
}

export interface SafetyDecision {
  command: SafeWorkloadCommand;
  shouldSend: boolean;
}

const requireNonNegativeFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
};

export function composeSafetyEnvelope(
  athlete: AthleteWorkloadLimits,
  machine: MachineWorkloadLimits,
  timing: SafetyTimingLimits,
): SafetyEnvelope {
  for (const [name, value] of Object.entries({
    athleteMaxSpeedKph: athlete.maxSpeedKph,
    athleteMaxInclinePct: athlete.maxInclinePct,
    athleteMaxAccelerationKphPerSec: athlete.maxAccelerationKphPerSec,
    athleteRecoverySpeedKph: athlete.recoverySpeedKph,
    machineMaxSpeedKph: machine.maxSpeedKph,
    machineMaxInclinePct: machine.maxInclinePct,
    machineMaxAccelerationKphPerSec: machine.maxAccelerationKphPerSec,
    maxCommandAgeMs: timing.maxCommandAgeMs,
    minCommandIntervalMs: timing.minCommandIntervalMs,
  })) {
    requireNonNegativeFinite(value, name);
  }

  const maxSpeedKph = Math.min(athlete.maxSpeedKph, machine.maxSpeedKph);
  return {
    maxSpeedKph,
    maxInclinePct: Math.min(athlete.maxInclinePct, machine.maxInclinePct),
    maxAccelerationKphPerSec: Math.min(
      athlete.maxAccelerationKphPerSec,
      machine.maxAccelerationKphPerSec,
    ),
    recoverySpeedKph: Math.min(athlete.recoverySpeedKph, maxSpeedKph),
    maxCommandAgeMs: timing.maxCommandAgeMs,
  };
}

/**
 * Stateful outer safety policy.
 *
 * `applySafetyGuard` remains the deterministic physical clamp. This wrapper
 * additionally owns command-rate limiting and explicitly composes independent
 * athlete and machine limits. Emergency stop bypasses rate limiting.
 */
export class SafetyPolicy {
  private lastSentAtMs: number | null = null;
  readonly envelope: SafetyEnvelope;

  constructor(
    athlete: AthleteWorkloadLimits,
    machine: MachineWorkloadLimits,
    private readonly timing: SafetyTimingLimits,
  ) {
    this.envelope = composeSafetyEnvelope(athlete, machine, timing);
  }

  evaluate(request: WorkloadRequest, state: SafetyPolicyState): SafetyDecision {
    const guarded = applySafetyGuard(request, state, this.envelope);

    // User stop is never suppressed by rate limiting.
    if (state.userStop) {
      this.lastSentAtMs = state.nowMs;
      return { command: guarded, shouldSend: true };
    }

    // There is no useful actuator write while disconnected.
    if (!state.treadmillConnected) {
      return { command: guarded, shouldSend: false };
    }

    if (
      this.lastSentAtMs !== null &&
      state.nowMs - this.lastSentAtMs < this.timing.minCommandIntervalMs
    ) {
      return {
        command: {
          ...request,
          speedKph: state.currentSpeedKph,
          inclinePct: state.currentInclinePct,
          limited: true,
          reasons: [...guarded.reasons, "command-rate-envelope"],
        },
        shouldSend: false,
      };
    }

    this.lastSentAtMs = state.nowMs;
    return { command: guarded, shouldSend: true };
  }

  reset(): void {
    this.lastSentAtMs = null;
  }
}
