# control-core

Platform-neutral control concepts.

Initial interfaces:

```text
HeartRateSource
  connect()
  stream() -> HeartRateSample

TreadmillAdapter
  capabilities()
  requestControl()
  setSpeed(kph)
  setIncline(percent)
  stop()

PlayerTraceSource
  sample(matchTime) -> PlayerEffortFrame

TargetPlanner
  plan(playerTrace, calibration, intensity) -> TargetTrajectory

WorkloadController
  update(target, liveState) -> WorkloadRequest

SafetyGuard
  apply(request, liveState, envelopes) -> SafeWorkloadCommand
```

The safety guard is authoritative. Presentation clients are not.
