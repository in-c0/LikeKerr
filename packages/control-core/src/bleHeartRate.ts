import type { HeartRateSample, HeartRateSource } from "./index.js";

export const HEART_RATE_SERVICE_UUID = "180d";
export const HEART_RATE_MEASUREMENT_UUID = "2a37";

export interface DecodedHeartRateMeasurement {
  bpm: number;
  sensorContactSupported: boolean;
  sensorContactDetected: boolean | null;
  energyExpendedKJ: number | null;
  rrIntervalsMs: number[];
}

export function decodeHeartRateMeasurement(bytes: Uint8Array): DecodedHeartRateMeasurement {
  if (bytes.length < 2) {
    throw new Error("heart-rate measurement is too short");
  }

  const flags = bytes[0]!;
  const isUint16 = (flags & 0x01) !== 0;
  const sensorContactSupported = (flags & 0x04) !== 0;
  const sensorContactDetected = sensorContactSupported ? (flags & 0x02) !== 0 : null;
  const hasEnergyExpended = (flags & 0x08) !== 0;
  const hasRrIntervals = (flags & 0x10) !== 0;

  let offset = 1;
  const requireBytes = (count: number, field: string): void => {
    if (offset + count > bytes.length) {
      throw new Error(`truncated heart-rate measurement while reading ${field}`);
    }
  };
  const readUint16LE = (field: string): number => {
    requireBytes(2, field);
    const value = bytes[offset]! | (bytes[offset + 1]! << 8);
    offset += 2;
    return value;
  };

  let bpm: number;
  if (isUint16) {
    bpm = readUint16LE("heart-rate value");
  } else {
    requireBytes(1, "heart-rate value");
    bpm = bytes[offset]!;
    offset += 1;
  }

  const energyExpendedKJ = hasEnergyExpended ? readUint16LE("energy expended") : null;

  const rrIntervalsMs: number[] = [];
  if (hasRrIntervals) {
    if ((bytes.length - offset) % 2 !== 0) {
      throw new Error("RR-interval payload must contain complete uint16 values");
    }
    while (offset < bytes.length) {
      const raw1024ths = readUint16LE("RR interval");
      rrIntervalsMs.push((raw1024ths * 1000) / 1024);
    }
  } else if (offset !== bytes.length) {
    throw new Error("unexpected trailing heart-rate measurement bytes");
  }

  return {
    bpm,
    sensorContactSupported,
    sensorContactDetected,
    energyExpendedKJ,
    rrIntervalsMs,
  };
}

export interface BleHeartRateNotificationTransport {
  readonly connected: boolean;
  connect(
    serviceUuid: string,
    characteristicUuid: string,
    onNotification: (bytes: Uint8Array, receivedAtMs: number) => void,
  ): Promise<void>;
  disconnect(): Promise<void>;
}

export class BleHeartRateSource implements HeartRateSource {
  private latest: HeartRateSample | null = null;

  constructor(private readonly transport: BleHeartRateNotificationTransport) {}

  get connected(): boolean {
    return this.transport.connected;
  }

  async connect(): Promise<void> {
    await this.transport.connect(
      HEART_RATE_SERVICE_UUID,
      HEART_RATE_MEASUREMENT_UUID,
      (bytes, receivedAtMs) => {
        const measurement = decodeHeartRateMeasurement(bytes);
        this.latest = {
          tMs: receivedAtMs,
          bpm: measurement.bpm,
          connected: true,
        };
      },
    );
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
  }

  sample(_tMs: number): HeartRateSample | null {
    if (!this.connected || this.latest === null) return null;
    return { ...this.latest, connected: true };
  }
}
