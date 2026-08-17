import {
  BleHeartRateSource,
  HEART_RATE_MEASUREMENT_UUID,
  HEART_RATE_SERVICE_UUID,
  decodeHeartRateMeasurement,
  type BleHeartRateNotificationTransport,
} from "../src/bleHeartRate.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectThrow(fn: () => void, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

const uint8 = decodeHeartRateMeasurement(Uint8Array.from([0x00, 72]));
assert(uint8.bpm === 72, "UINT8 HR should decode");
assert(uint8.sensorContactDetected === null, "unsupported contact should be null");

const uint16 = decodeHeartRateMeasurement(Uint8Array.from([0x01, 0x2c, 0x01]));
assert(uint16.bpm === 300, "UINT16 HR should decode little-endian");

const rich = decodeHeartRateMeasurement(
  Uint8Array.from([0x1e, 150, 0x34, 0x12, 0x00, 0x04, 0x00, 0x02]),
);
assert(rich.bpm === 150, "rich measurement HR should decode");
assert(rich.sensorContactSupported, "contact support flag should decode");
assert(rich.sensorContactDetected === true, "contact detected flag should decode");
assert(rich.energyExpendedKJ === 0x1234, "energy expended should decode little-endian");
assert(rich.rrIntervalsMs.length === 2, "all RR intervals should decode");
assert(rich.rrIntervalsMs[0] === 1000, "1024 RR units should equal 1000 ms");
assert(rich.rrIntervalsMs[1] === 500, "512 RR units should equal 500 ms");

expectThrow(
  () => decodeHeartRateMeasurement(Uint8Array.from([0x01, 0x48])),
  "truncated UINT16 HR should fail",
);
expectThrow(
  () => decodeHeartRateMeasurement(Uint8Array.from([0x10, 70, 0x00])),
  "partial RR value should fail",
);

class FakeTransport implements BleHeartRateNotificationTransport {
  connected = false;
  private notification: ((bytes: Uint8Array, receivedAtMs: number) => void) | null = null;

  async connect(
    serviceUuid: string,
    characteristicUuid: string,
    onNotification: (bytes: Uint8Array, receivedAtMs: number) => void,
  ): Promise<void> {
    assert(serviceUuid === HEART_RATE_SERVICE_UUID, "source should request standard HR service");
    assert(
      characteristicUuid === HEART_RATE_MEASUREMENT_UUID,
      "source should request standard HR measurement characteristic",
    );
    this.notification = onNotification;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  emit(bytes: Uint8Array, receivedAtMs: number): void {
    if (!this.notification) throw new Error("transport is not connected");
    this.notification(bytes, receivedAtMs);
  }
}

const transport = new FakeTransport();
const source = new BleHeartRateSource(transport);
await source.connect();
transport.emit(Uint8Array.from([0x00, 146]), 1234);
const sample = source.sample(1300);
assert(sample?.bpm === 146, "BLE notification should reach HeartRateSource");
assert(sample?.tMs === 1234, "source should preserve receive timestamp for freshness checks");
await source.disconnect();
assert(source.sample(1400) === null, "disconnected BLE source should not return stale HR");

console.log("LikeKerr BLE heart-rate smoke test passed");
