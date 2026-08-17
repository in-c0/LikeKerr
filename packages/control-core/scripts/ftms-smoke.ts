import {
  FITNESS_MACHINE_CONTROL_POINT_UUID,
  FITNESS_MACHINE_SERVICE_UUID,
  FtmsControlClient,
  FtmsOpCode,
  FtmsResultCode,
  decodeFtmsControlPointResponse,
  encodeFtmsPause,
  encodeFtmsRequestControl,
  encodeFtmsStartOrResume,
  encodeFtmsStop,
  encodeFtmsTargetInclination,
  encodeFtmsTargetSpeed,
  type FtmsControlTransport,
} from "../src/ftms.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function expectReject(fn: () => Promise<void>, message: string): Promise<void> {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  assert(rejected, message);
}

assert(FITNESS_MACHINE_SERVICE_UUID === "1826", "FTMS service UUID should be standard");
assert(FITNESS_MACHINE_CONTROL_POINT_UUID === "2ad9", "FTMS control point UUID should be standard");
assert([...encodeFtmsRequestControl()].join(",") === "0", "request-control encoding should be 0x00");
assert([...encodeFtmsStartOrResume()].join(",") === "7", "start encoding should be 0x07");
assert([...encodeFtmsStop()].join(",") === "8,1", "stop should use stop/pause opcode + stop parameter");
assert([...encodeFtmsPause()].join(",") === "8,2", "pause should use stop/pause opcode + pause parameter");

const speed = encodeFtmsTargetSpeed(12.34);
assert([...speed].join(",") === "2,210,4", "12.34 kph should encode as uint16 1234 little-endian");

const inclinePositive = encodeFtmsTargetInclination(3.5);
assert([...inclinePositive].join(",") === "3,35,0", "3.5% should encode as signed tenths");
const inclineNegative = encodeFtmsTargetInclination(-1.5);
assert([...inclineNegative].join(",") === "3,241,255", "negative inclination should use sint16 LE");

const ok = decodeFtmsControlPointResponse(
  Uint8Array.from([FtmsOpCode.ResponseCode, FtmsOpCode.RequestControl, FtmsResultCode.Success]),
);
assert(ok.success && ok.requestOpCode === FtmsOpCode.RequestControl, "success response should decode");

class FakeFtmsTransport implements FtmsControlTransport {
  connected = true;
  writes: Uint8Array[] = [];
  private indication: ((value: Uint8Array) => void) | null = null;

  async subscribeToControlPoint(onIndication: (value: Uint8Array) => void): Promise<void> {
    this.indication = onIndication;
  }

  async writeControlPoint(value: Uint8Array): Promise<void> {
    if (!this.connected) throw new Error("disconnected");
    this.writes.push(Uint8Array.from(value));
  }

  respond(requestOpCode: number, resultCode = FtmsResultCode.Success): void {
    if (!this.indication) throw new Error("not subscribed");
    this.indication(Uint8Array.from([FtmsOpCode.ResponseCode, requestOpCode, resultCode]));
  }
}

const transport = new FakeFtmsTransport();
const client = new FtmsControlClient(transport);

await expectReject(
  () => client.setTargetSpeed(10),
  "physical speed writes must fail before explicit control is granted",
);

await client.requestControl();
assert(transport.writes.length === 1, "request control should be written after indication subscription");
assert(!client.hasControl, "write alone must not grant control");
transport.respond(FtmsOpCode.RequestControl);
assert(client.hasControl, "successful Request Control response should grant control");

await client.startOrResume();
await client.setTargetSpeed(9.5);
await client.setTargetInclination(2);
assert(transport.writes.length === 4, "controlled actuator commands should be emitted");

transport.respond(FtmsOpCode.SetTargetInclination, FtmsResultCode.OperationFailed);
assert(!client.hasControl, "failed actuator procedure should conservatively revoke local control");
await expectReject(
  () => client.setTargetSpeed(8),
  "writes should fail closed after a failed control-point operation",
);

await client.requestControl();
transport.respond(FtmsOpCode.RequestControl);
await client.stop();
assert([...transport.writes.at(-1)!].join(",") === "8,1", "controlled stop command should encode correctly");

transport.connected = false;
await expectReject(
  () => client.setTargetSpeed(8),
  "disconnect should revoke effective actuator authority",
);

console.log("LikeKerr FTMS control-point smoke test passed");
