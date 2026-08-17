# RIP-002 — First real player-trace fixture

## Question

Can LikeKerr replay a real footballer's tracked locomotion through the same effort/HR/control pipeline used by the simulator?

## Source

Metrica Sports sample tracking data, accessed through Kloppy's compact Metrica test fixture:

- https://github.com/PySport/kloppy/blob/master/kloppy/tests/files/metrica_home.csv
- original data project: https://github.com/metrica-sports/sample-data

The fixture uses anonymised **Home Player11**, period 1, frames 1–3. Metrica coordinates are normalised and the pitch dimensions are 105 x 68 m.

## Measured

From the source:

- timestamp;
- normalised x/y player position.

## Derived

- metres: `x_m = x01 * 105`, `y_m = y01 * 68`;
- speed: Euclidean frame-to-frame displacement / elapsed time;
- M001 effort baseline: `effort_0_1 = clamp(speed_mps / 7.5, 0, 1)`.

## Why speed-only first

Acceleration is deliberately excluded from the first public baseline. Differentiating short position traces twice creates large edge/quantisation spikes unless filtering and windowing are specified. A weak, transparent baseline is preferable to a more sophisticated-looking unstable one.

This does **not** claim speed alone is a validated estimate of physiological effort. It is the first reproducible H1 baseline against which later models can be compared.

## Reproduction

Run:

```bash
node scripts/derive-demo-player-trace.mjs
```

The output must match `data/demo/metrica-kloppy-player11.csv`.

## Result

M001 now has a real, attributable player-motion fixture that can be deterministically replayed by the control pipeline. This proves ingestion/plumbing only; it does not validate H1 physiologically.

## Next

1. Feed the fixture through target-HR planning and treadmill simulation.
2. Replace the three-frame parser fixture with a longer/full-match trace when the full source blob is available to the execution environment.
3. Add filtered acceleration and accumulated-load features as explicit competing H1 models rather than silently changing the baseline.
