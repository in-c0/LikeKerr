import { BleClient, numberToUUID } from "@capacitor-community/bluetooth-le";
import { BleHeartRateSource } from "../../../../packages/control-core/src/bleHeartRate.js";
import {
  FITNESS_MACHINE_CONTROL_POINT_UUID,
  FITNESS_MACHINE_SERVICE_UUID,
} from "../../../../packages/control-core/src/ftms.js";
import {
  CapacitorFtmsTreadmillTransport,
  CapacitorHeartRateTransport,
} from "../../src/capacitorBleTransports.js";

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

const bpm = $("bpm");
const hrStatus = $("hrStatus");
const treadmillStatus = $("treadmillStatus");
const gatt = $("gatt");
const logElement = $("log");
const connectHr = $<HTMLButtonElement>("connectHr");
const disconnectHr = $<HTMLButtonElement>("disconnectHr");
const connectTreadmill = $<HTMLButtonElement>("connectTreadmill");
const disconnectTreadmill = $<HTMLButtonElement>("disconnectTreadmill");

const hrTransport = new CapacitorHeartRateTransport();
const hrSource = new BleHeartRateSource(hrTransport);
const treadmillTransport = new CapacitorFtmsTreadmillTransport();

function log(message: string): void {
  const stamp = new Date().toLocaleTimeString();
  logElement.textContent = `[${stamp}] ${message}\n${logElement.textContent ?? ""}`.slice(0, 12000);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

connectHr.addEventListener("click", async () => {
  connectHr.disabled = true;
  hrStatus.textContent = "Choose a heart-rate sensor…";
  try {
    await hrSource.connect();
    hrStatus.textContent = `Connected: ${hrTransport.deviceName ?? hrTransport.deviceId ?? "HR sensor"}`;
    disconnectHr.disabled = false;
    log("Heart-rate notifications started.");
  } catch (error) {
    hrStatus.textContent = `HR connection failed: ${describeError(error)}`;
    log(`HR error: ${describeError(error)}`);
    connectHr.disabled = false;
  }
});

disconnectHr.addEventListener("click", async () => {
  disconnectHr.disabled = true;
  await hrSource.disconnect().catch((error) => log(`HR disconnect warning: ${describeError(error)}`));
  bpm.textContent = "—";
  hrStatus.textContent = "Not connected";
  connectHr.disabled = false;
  log("Heart-rate sensor disconnected.");
});

connectTreadmill.addEventListener("click", async () => {
  connectTreadmill.disabled = true;
  treadmillStatus.textContent = "Choose an FTMS treadmill…";
  try {
    await treadmillTransport.connectTreadmill();
    const deviceId = treadmillTransport.deviceId;
    if (!deviceId) throw new Error("Treadmill connected without a device ID");

    treadmillStatus.textContent = `Connected: ${treadmillTransport.deviceName ?? deviceId}`;
    disconnectTreadmill.disabled = false;

    const services = await BleClient.getServices(deviceId);
    const ftmsService = numberToUUID(Number.parseInt(FITNESS_MACHINE_SERVICE_UUID, 16)).toLowerCase();
    const controlPoint = numberToUUID(Number.parseInt(FITNESS_MACHINE_CONTROL_POINT_UUID, 16)).toLowerCase();
    const ftms = services.find((service) => service.uuid.toLowerCase() === ftmsService);

    if (!ftms) {
      gatt.textContent = "Connected device does not expose the standard Fitness Machine Service (0x1826).";
      log("Treadmill probe: FTMS service missing.");
      return;
    }

    const lines = [
      `FTMS service: ${ftms.uuid}`,
      `Characteristics: ${ftms.characteristics.length}`,
      "",
      ...ftms.characteristics.map((characteristic) => {
        const p = characteristic.properties;
        const capabilities = [
          p.read && "read",
          p.write && "write",
          p.writeWithoutResponse && "writeWithoutResponse",
          p.notify && "notify",
          p.indicate && "indicate",
        ].filter(Boolean).join(", ") || "none";
        const marker = characteristic.uuid.toLowerCase() === controlPoint ? "  ← CONTROL POINT" : "";
        return `${characteristic.uuid}\n  ${capabilities}${marker}`;
      }),
    ];

    const cp = ftms.characteristics.find((characteristic) => characteristic.uuid.toLowerCase() === controlPoint);
    if (!cp) {
      lines.push("", "Result: FTMS present, but Fitness Machine Control Point (0x2AD9) is missing.");
    } else {
      lines.push(
        "",
        `Result: control point present; write=${cp.properties.write}, indicate=${cp.properties.indicate}.`,
        "No control request or actuator write was sent.",
      );
    }

    gatt.textContent = lines.join("\n");
    log("Treadmill FTMS GATT probe completed without actuation.");
  } catch (error) {
    treadmillStatus.textContent = `Treadmill probe failed: ${describeError(error)}`;
    gatt.textContent = describeError(error);
    log(`Treadmill error: ${describeError(error)}`);
    connectTreadmill.disabled = false;
  }
});

disconnectTreadmill.addEventListener("click", async () => {
  disconnectTreadmill.disabled = true;
  await treadmillTransport.disconnectTreadmill().catch((error) => log(`Treadmill disconnect warning: ${describeError(error)}`));
  treadmillStatus.textContent = "Not connected";
  connectTreadmill.disabled = false;
  log("Treadmill disconnected.");
});

setInterval(() => {
  const sample = hrSource.sample(performance.now());
  if (!sample) {
    if (!hrTransport.connected && !connectHr.disabled) bpm.textContent = "—";
    return;
  }

  bpm.textContent = Math.round(sample.bpm).toString();
  const ageMs = Math.max(0, performance.now() - sample.tMs);
  hrStatus.textContent = `${hrTransport.deviceName ?? "HR sensor"} · packet age ${ageMs.toFixed(0)} ms`;
}, 250);

log("Diagnostics contains no treadmill actuator action.");
