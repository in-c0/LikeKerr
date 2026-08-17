export const FITNESS_MACHINE_SERVICE_UUID = "1826";
export const FITNESS_MACHINE_FEATURE_UUID = "2acc";
export const SUPPORTED_SPEED_RANGE_UUID = "2ad4";
export const SUPPORTED_INCLINATION_RANGE_UUID = "2ad5";
export const FITNESS_MACHINE_CONTROL_POINT_UUID = "2ad9";
export const FITNESS_MACHINE_STATUS_UUID = "2ada";

export const enum FtmsOpCode {
  RequestControl = 0x00,
  Reset = 0x01,
  SetTargetSpeed = 0x02,
  SetTargetInclination = 0x03,
  StartOrResume = 0x07,
  StopOrPause = 0x08,
  ResponseCode = 0x80,
}

export const enum FtmsResultCode {
  Success = 0x01,
  OpCodeNotSupported = 0x02,
  InvalidParameter = 0x03,
  OperationFailed = 0x04,
  ControlNotPermitted = 0x05,
}

export interface FtmsControlPointResponse {
  requestOpCode: number;
  resultCode: number;
  success: boolean;
}

const assertFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
};

export function encodeFtmsRequestControl(): Uint8Array {
  return Uint8Array.from([FtmsOpCode.RequestControl]);
}

export function encodeFtmsStartOrResume(): Uint8Array {
  return Uint8Array.from([FtmsOpCode.StartOrResume]);
}

export function encodeFtmsStop(): Uint8Array {
  return Uint8Array.from([FtmsOpCode.StopOrPause, 0x01]);
}

export function encodeFtmsPause(): Uint8Array {
  return Uint8Array.from([FtmsOpCode.StopOrPause, 0x02]);
}

export function encodeFtmsTargetSpeed(speedKph: number): Uint8Array {
  assertFinite(speedKph, "speedKph");
  if (speedKph < 0 || speedKph > 655.35) {
    throw new Error("speedKph is outside FTMS uint16 range");
  }

  // FTMS target speed is encoded in 0.01 km/h units, little-endian.
  const raw = Math.round(speedKph * 100);
  return Uint8Array.from([FtmsOpCode.SetTargetSpeed, raw & 0xff, (raw >>> 8) & 0xff]);
}

export function encodeFtmsTargetInclination(inclinePct: number): Uint8Array {
  assertFinite(inclinePct, "inclinePct");

  // FTMS target inclination is encoded as signed 0.1% units, little-endian.
  const raw = Math.round(inclinePct * 10);
  if (raw < -32768 || raw > 32767) {
    throw new Error("inclinePct is outside FTMS sint16 range");
  }
  const encoded = raw & 0xffff;
  return Uint8Array.from([
    FtmsOpCode.SetTargetInclination,
    encoded & 0xff,
    (encoded >>> 8) & 0xff,
  ]);
}

export function decodeFtmsControlPointResponse(bytes: Uint8Array): FtmsControlPointResponse {
  if (bytes.length < 3) throw new Error("FTMS control-point response is too short");
  if (bytes[0] !== FtmsOpCode.ResponseCode) {
    throw new Error("FTMS indication is not a control-point response");
  }

  const requestOpCode = bytes[1]!;
  const resultCode = bytes[2]!;
  return {
    requestOpCode,
    resultCode,
    success: resultCode === FtmsResultCode.Success,
  };
}

export interface FtmsControlTransport {
  readonly connected: boolean;
  /** Subscribe to control-point indications before the first write. */
  subscribeToControlPoint(
    onIndication: (value: Uint8Array) => void,
  ): Promise<void>;
  writeControlPoint(value: Uint8Array): Promise<void>;
}

/**
 * Minimal FTMS control-ownership state machine.
 *
 * It does not perform safety decisions. LikeKerr's SafetyGuard must already have
 * approved speed/incline requests before they arrive here. This class adds a
 * second fail-closed boundary: actuator writes are rejected until FTMS control
 * ownership has been explicitly acknowledged by the machine.
 */
export class FtmsControlClient {
  private subscribed = false;
  private controlGranted = false;
  private pendingRequest: number | null = null;

  constructor(private readonly transport: FtmsControlTransport) {}

  get hasControl(): boolean {
    return this.transport.connected && this.controlGranted;
  }

  async initialise(): Promise<void> {
    if (!this.transport.connected) throw new Error("FTMS treadmill is disconnected");
    if (!this.subscribed) {
      await this.transport.subscribeToControlPoint((value) => this.onIndication(value));
      this.subscribed = true;
    }
  }

  async requestControl(): Promise<void> {
    await this.initialise();
    this.controlGranted = false;
    this.pendingRequest = FtmsOpCode.RequestControl;
    await this.transport.writeControlPoint(encodeFtmsRequestControl());
  }

  async startOrResume(): Promise<void> {
    this.requireControl();
    this.pendingRequest = FtmsOpCode.StartOrResume;
    await this.transport.writeControlPoint(encodeFtmsStartOrResume());
  }

  async setTargetSpeed(speedKph: number): Promise<void> {
    this.requireControl();
    this.pendingRequest = FtmsOpCode.SetTargetSpeed;
    await this.transport.writeControlPoint(encodeFtmsTargetSpeed(speedKph));
  }

  async setTargetInclination(inclinePct: number): Promise<void> {
    this.requireControl();
    this.pendingRequest = FtmsOpCode.SetTargetInclination;
    await this.transport.writeControlPoint(encodeFtmsTargetInclination(inclinePct));
  }

  async stop(): Promise<void> {
    this.requireControl();
    this.pendingRequest = FtmsOpCode.StopOrPause;
    await this.transport.writeControlPoint(encodeFtmsStop());
  }

  revokeControl(): void {
    this.controlGranted = false;
    this.pendingRequest = null;
  }

  private onIndication(value: Uint8Array): void {
    const response = decodeFtmsControlPointResponse(value);

    if (response.requestOpCode === FtmsOpCode.RequestControl) {
      this.controlGranted = response.success;
    } else if (!response.success) {
      // A failed actuator procedure is treated conservatively. The mobile layer
      // must reacquire control before issuing another physical workload command.
      this.controlGranted = false;
    }

    if (this.pendingRequest === response.requestOpCode) {
      this.pendingRequest = null;
    }
  }

  private requireControl(): void {
    if (!this.transport.connected) {
      this.controlGranted = false;
      throw new Error("FTMS treadmill is disconnected");
    }
    if (!this.controlGranted) {
      throw new Error("FTMS control has not been granted");
    }
  }
}
