# M001 — Run one real football match

## Goal

Produce the first end-to-end LikeKerr session:

> Player match trace -> personalised target effort -> live HR feedback -> treadmill command -> HR Sync -> recorded session -> mobile and XR visualisation.

A/B/C are validated *inside* this milestone rather than treated as prerequisite research phases.

## Demo data

Use an open full-pitch tracking sample for development (e.g. Metrica Sports sample tracking data). The first demo may use an anonymised player; famous-player/NIL/broadcast-rights work is not required for the control-loop proof.

## User flow

1. Choose demo player.
2. Choose intensity: 50 / 80 / 100 / 120 / Adaptive.
3. Connect HR tracker.
4. Connect supported treadmill or simulator.
5. Complete short calibration.
6. Start match.
7. Display:
   - player effort;
   - target HR;
   - current HR;
   - HR Sync;
   - speed/incline;
   - next effort change;
   - elapsed match time.
8. Stop instantly from the app / machine.
9. Show session analysis.

## Control model

Do **not** attempt instantaneous equality between player movement and user HR.

Inputs:
- precomputed player effort `E_p(t)`;
- user calibration;
- selected intensity;
- live HR;
- recent workload;
- treadmill capabilities.

Outputs:
- target HR trajectory;
- requested speed/incline trajectory.

The entire source match is known in advance, so the planner may anticipate upcoming exertion.

## HR Sync v0

For M001, define a transparent baseline:

- smooth both target and observed HR over a configurable window;
- compensate for learned/estimated HR response lag;
- compute normalised absolute error over the user's calibrated HR reserve;
- convert to 0–100 score;
- report both current-window sync and session sync.

This is deliberately simple. Later experiments may replace it with a dynamic physiological model.

## Safety requirements

- treadmill adapter defaults to simulator unless explicitly enabled;
- independent speed, incline, acceleration and command-rate limits;
- stale-command timeout -> safe slowdown/stop policy;
- HR dropout -> conservative workload policy;
- treadmill disconnect -> no further actuator commands;
- app stop always overrides controller;
- XR client cannot send treadmill commands;
- full command/telemetry log for every session.

## M001 acceptance criteria

### End-to-end
- [ ] One player trace runs from start to finish.
- [ ] Real HR sensor can stream continuously into the session engine.
- [ ] Simulator treadmill responds to controller commands.
- [ ] One real treadmill adapter can be enabled once hardware is selected.
- [ ] Live target HR / actual HR / HR Sync are visible.
- [ ] Every controller decision is logged.
- [ ] Session summary includes time, distance estimate, max speed, HR metrics and Sync.

### XR
- [ ] Unity OpenXR client receives the same live session telemetry.
- [ ] 3D pitch and selected-player marker/ghost are rendered.
- [ ] XR disconnect does not affect the running session.
- [ ] XR has no treadmill-control path.

### Research
- [ ] H1–H4 are tagged in recorded measurements.
- [ ] Results distinguish assumed, measured and inferred quantities.
- [ ] Public demo uses data whose public use is permitted.

## Explicit non-goals

- medically validating HR thresholds;
- proving sports-performance improvement;
- exact player HR reconstruction;
- broadcast-footage redistribution;
- famous-player licensing;
- omnidirectional treadmill hardware;
- perfect biomechanical reproduction.
