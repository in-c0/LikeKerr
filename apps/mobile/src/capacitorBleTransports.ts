import {
  BleClient,
  numberToUUID,
  type BleDevice,
} from "@capacitor-community/bluetooth-le";

import type { BleHeartRateNotificationTransport } from "../../../packages/control-core/src/bleHeartRate.js";
import type { FtmsControlTransport } from "../../../packages/control-core/src/ftms.js";
import {
  FITNESS_MACHINE_CONTROL_POINT_UUID,
  FITNESS_MACHINE_SERVICE_UUID,
} from "../../../packages/control-core/src/ftms.js";
import {
  HEART_RATE_MEASUREMENT_UUID,
  HEART_RATE_SERVICE_UUID,
} from "../../../packages/control-core/src/bleHeartRate.js";

let initialization: Promise<void> | null = null;

export function initializeLikeKerrBle(): Promise<void> {
  initialization ??= BleClient.initialize();
  return initialization;
}

function uuid16(value: string): string {
  const parsed = Number.parseInt(value, 16);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) {
    throw new Error(`Expected Bluetooth 16-bit UUID, received ${value}`);
  }
  return numberToUUID(parsed);
}

function copyBytes(value: DataView): Uint8Array {
  return Uint8Array.from(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  );
}

function toDataView(value: Uint8Array): DataView {
  const copy = Uint8Array.from(value);
  return new DataView(copy.buffer);
}

function monotonicNowMs(): number {
  if (typeof performance !== "undefined" && Number.isFinite(performance.now())) {
    return performance.now();
  }
  return Date.now();
}

abstract class CapacitorBlePeripheral {
  protected device: BleDevice | null = null;
  protected _connected = false;

  get connected(): boolean {
    return this._connected && this.device !== null;
  }

  get deviceId(): string | null {
    return this.device?.deviceId ?? null;
  }

  get deviceName(): string | null {
    return this.device?.name ?? null;
  }

  protected async chooseAndConnect(requiredServiceUuid: string): Promise<BleDevice> {
    await initializeLikeKerrBle();

    const device = await BleClient.requestDevice({
      services: [requiredServiceUuid],
    });

    await BleClient.connect(device.deviceId, () => {
      this._connected = false;
    });

    this.device = device;
    this._connected = true;
    return device;
  }

  async disconnectPeripheral(): Promise<void> {
    const deviceId = this.device?.deviceId;
    this._connected = false;
    this.device = null;

    if (deviceId !== undefined) {
      await BleClient.disconnect(deviceId).catch(() => undefined);
    }
  }
}

/**
 * Native iOS/Android (and supported web) transport for the Bluetooth Heart Rate
 * Service. Packet decoding and freshness semantics remain in control-core.
 */
export class CapacitorHeartRateTransport
  extends CapacitorBlePeripheral
  implements BleHeartRateNotificationTransport
{
  private notificationActive = false;

  async connect(
    serviceUuid: string,
    characteristicUuid: string,
    onNotification: (bytes: Uint8Array, receivedAtMs: number) => void,
  ): Promise<void> {
    if (serviceUuid.toLowerCase() !== HEART_RATE_SERVICE_UUID) {
      throw new Error(`Unexpected heart-rate service UUID: ${serviceUuid}`);
    }
    if (characteristicUuid.toLowerCase() !== HEART_RATE_MEASUREMENT_UUID) {
      throw new Error(`Unexpected heart-rate characteristic UUID: ${characteristicUuid}`);
    }

    const service = uuid16(serviceUuid);
    const characteristic = uuid16(characteristicUuid);
    const device = await this.chooseAndConnect(service);

    await BleClient.startNotifications(
      device.deviceId,
      service,
      characteristic,
      (value) => onNotification(copyBytes(value), monotonicNowMs()),
    );
    this.notificationActive = true;
  }

  async disconnect(): Promise<void> {
    const deviceId = this.device?.deviceId;
    if (deviceId && this.notificationActive) {
      await BleClient.stopNotifications(
        deviceId,
        uuid16(HEART_RATE_SERVICE_UUID),
        uuid16(HEART_RATE_MEASUREMENT_UUID),
      ).catch(() => undefined);
    }
    this.notificationActive = false;
    await this.disconnectPeripheral();
  }
}

/**
 * Native FTMS transport. LikeKerr's FtmsControlClient still owns Request Control
 * and fail-closed actuator authority; this class only maps GATT notifications and
 * writes onto Capacitor BLE.
 */
export class CapacitorFtmsTreadmillTransport
  extends CapacitorBlePeripheral
  implements FtmsControlTransport
{
  private indicationActive = false;

  async connectTreadmill(): Promise<void> {
    await this.chooseAndConnect(uuid16(FITNESS_MACHINE_SERVICE_UUID));
  }

  async subscribeToControlPoint(
    onIndication: (value: Uint8Array) => void,
  ): Promise<void> {
    const deviceId = this.requireDeviceId();

    await BleClient.startNotifications(
      deviceId,
      uuid16(FITNESS_MACHINE_SERVICE_UUID),
      uuid16(FITNESS_MACHINE_CONTROL_POINT_UUID),
      (value) => onIndication(copyBytes(value)),
    );
    this.indicationActive = true;
  }

  async writeControlPoint(value: Uint8Array): Promise<void> {
    const deviceId = this.requireDeviceId();
    await BleClient.write(
      deviceId,
      uuid16(FITNESS_MACHINE_SERVICE_UUID),
      uuid16(FITNESS_MACHINE_CONTROL_POINT_UUID),
      toDataView(value),
    );
  }

  async disconnectTreadmill(): Promise<void> {
    const deviceId = this.device?.deviceId;
    if (deviceId && this.indicationActive) {
      await BleClient.stopNotifications(
        deviceId,
        uuid16(FITNESS_MACHINE_SERVICE_UUID),
        uuid16(FITNESS_MACHINE_CONTROL_POINT_UUID),
      ).catch(() => undefined);
    }
    this.indicationActive = false;
    await this.disconnectPeripheral();
  }

  private requireDeviceId(): string {
    if (!this.connected || !this.device) {
      throw new Error("BLE treadmill is disconnected");
    }
    return this.device.deviceId;
  }
}
