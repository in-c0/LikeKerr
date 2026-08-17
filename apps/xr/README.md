# LikeKerr XR client

Unity 6 + OpenXR, intentionally **read-only**.

The XR application receives the same session telemetry as the Accessible UI and renders:

- 3D pitch;
- selected-player position/ghost;
- player effort and speed;
- target HR and current HR;
- HR Sync;
- treadmill state;
- upcoming effort;
- safety-envelope status;
- end-of-session summary.

There is no FTMS/treadmill-control code under `apps/xr`. CI fails if actuator-control references are introduced here.

## Versions

The project is pinned to Unity `6000.0.65f1` with:

- `com.unity.inputsystem` `1.17.0`;
- `com.unity.xr.management` `4.5.3`;
- `com.unity.xr.openxr` `1.16.1`;
- `com.unity.xr.interaction.toolkit` `3.3.0`.

## First validation target: Editor / PC VR / Quest Link

1. From the repository root, start the session simulator:

   ```bash
   npm install
   npm run demo:accessible
   ```

2. Open `apps/xr` as a Unity project using Unity `6000.0.65f1`.
3. In **Edit → Project Settings → XR Plug-in Management**, enable **OpenXR** for the current desktop build target.
4. Run XR **Project Validation** and apply required fixes for the selected target.
5. Enter Play mode. The runtime bootstrap automatically creates the tracked camera, pitch, player ghost, HUD and telemetry client. No authored scene is required for the Editor prototype.
6. The default stream is `http://127.0.0.1:4173/events`.

Unity package installation alone does not enable an XR provider for a target platform; that setting is intentionally left to Unity's XR Plug-in Management / Project Validation flow so it can be validated by the actual editor and target runtime.

## Remote PC / trusted-LAN development

For another machine or later standalone-XR testing, run:

```bash
npm run demo:xr
```

This keeps the real backend on localhost and exposes a separate development proxy on port `4174`. Use only on a trusted local network.

Set the XR stream explicitly before launching Unity/player:

```text
LIKEKERR_ENDPOINT=http://<HOST-LAN-IP>:4174/events
```

or for desktop player command-line launches:

```text
-likekerrEndpoint http://<HOST-LAN-IP>:4174/events
```

Standalone Quest is **not yet validated**. Android network policy, OpenXR target configuration, build settings and headset runtime behavior remain part of issue #7's physical/runtime validation.

## Architecture boundary

```text
Mobile/control hub
  ├─ HR sensor
  ├─ target-HR planner
  ├─ workload controller
  ├─ safety guard
  ├─ treadmill adapter
  └─ session telemetry
             │
             │ read-only SSE
             ▼
          XR client
  ├─ pitch
  ├─ player ghost
  ├─ HR Sync HUD
  └─ presentation only
```

Disconnecting or crashing the XR client cannot issue a treadmill command and must not affect the control session.
