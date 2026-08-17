# Architecture

## Principle

The **mobile app is the control and safety hub**, including in VR mode.

```text
Match / tracking data
        |
        v
Player Effort Trace
        |
        v
Target HR Planner <----- athlete calibration / selected intensity
        |
        v
Session Controller <----- live HR
        |
        +----> Safety Guard ----> Treadmill Adapter ----> treadmill
        |
        +----> Session Telemetry ----> Mobile / TV UI
                                |
                                +----> LAN/WebSocket ----> XR client
```

The XR client has **no actuator authority**. Loss of XR connectivity must not affect treadmill safety.

## Components

### Mobile control hub
- BLE Heart Rate Service adapter; Polar SDK adapter may expose richer H10 signals.
- FTMS treadmill adapter where the treadmill exposes compatible control characteristics.
- simulator treadmill adapter for deterministic development.
- target-HR planner.
- workload controller.
- independent safety guard.
- live HR Sync metric.
- append-only session telemetry.

### XR client
- Unity 6 + OpenXR.
- consumes session state over local network.
- renders pitch, selected-player ghost, effort state, HR Sync, upcoming workload.
- later: reconstructed POV / MR / ODT spatial mapping.

### Offline preprocessing
- ingest legal/open/licensed tracking or reconstructed match data.
- output a player trace: timestamp, planar position, velocity, acceleration and inferred effort.
- never require raw broadcast footage at runtime.

## Safety boundary

The research controller may request workload changes. A deterministic safety layer clamps commands and handles:
- HR dropout
- treadmill disconnect
- app/background failure
- implausible speed/acceleration commands
- user stop / E-stop
- stale controller output
- configured user and machine envelopes

For M001, HR is an input/control sensor, **not claimed as a medical safety device**.
