# M001 hardware validation protocol

This protocol is intentionally split into **sensor validation** and **read-only treadmill discovery** before any treadmill actuation is attempted.

## Preconditions

- Use the `LikeKerr BLE Diagnostics` Android debug build from GitHub Actions.
- The diagnostics app contains no UI action for FTMS Request Control, Start/Resume, target speed, or target incline.
- Record the exact hardware model and firmware version where available.
- Do not treat a successful BLE connection as evidence that automatic treadmill control is safe or supported.

## A — Heart-rate sensor validation

Physical HR streaming is allowed in this stage.

1. Wear the HR sensor according to its manufacturer instructions.
2. Open **LikeKerr BLE Diagnostics**.
3. Tap **Connect HR sensor** and select the intended device.
4. Confirm that live BPM appears and updates continuously.
5. Compare several readings against the sensor's normal companion app or device display where practical.
6. Walk around / change posture and confirm the stream remains connected.
7. Disconnect the sensor from LikeKerr and verify the UI stops reporting live HR.

Record:

- sensor make/model;
- phone model + Android version;
- whether the device advertised the standard Heart Rate Service;
- approximate update cadence;
- any dropouts/reconnections;
- observed BPM plausibility;
- any pairing/permission problems.

### Pass condition for M001.2 physical validation

A real sensor supplies sustained standard-HRS measurements to LikeKerr with timestamps/dropout behavior sufficient for the session controller's freshness checks.

## B — Treadmill compatibility probe (NO BELT MOVEMENT)

**Do not stand on the treadmill for this step. Do not start the belt.**

1. Keep the treadmill stopped.
2. Open **LikeKerr BLE Diagnostics**.
3. Tap **Connect treadmill** and select the treadmill.
4. Allow the app to enumerate GATT services/characteristics.
5. Save the displayed diagnostic result.
6. Disconnect from the treadmill.

The app should report whether the device exposes:

- Fitness Machine Service `0x1826`;
- Fitness Machine Control Point `0x2AD9`;
- whether the Control Point is writable;
- whether the Control Point supports indications.

The diagnostics app must print:

> No control request or actuator write was sent.

Record:

- treadmill manufacturer/model;
- firmware/version if exposed;
- phone model + Android version;
- FTMS present: yes/no;
- Control Point present: yes/no;
- write property: yes/no;
- indicate property: yes/no;
- full characteristic summary;
- disconnect/reconnect behavior.

### Pass condition for the M001.3 compatibility-probe stage

A real treadmill can be connected and its FTMS capabilities can be identified without moving the belt.

This does **not** close M001.3's real-control validation by itself.

## C — Gate before the first actuator test

Do not enable LikeKerr treadmill actuation until all of the following are known:

1. exact treadmill make/model and documented or measured control behavior;
2. whether standard FTMS Request Control is supported;
3. what occurs when control is lost/disconnected;
4. treadmill's physical speed/incline/acceleration limits;
5. location of the machine's physical emergency stop;
6. a test plan beginning at zero/very low speed with no runner on the belt;
7. independent command limits configured below the machine limits;
8. observer/operator access to the emergency stop during first motion tests.

The first actuator test is a **machine interoperability test**, not an athlete training session.

## Evidence boundary

Passing A shows that LikeKerr can receive a real physiological input stream.

Passing B shows that a particular treadmill exposes discoverable FTMS capabilities.

Neither establishes medical safety, cardiovascular safety, sports-training efficacy, or safe closed-loop treadmill actuation. Those require later staged validation.
