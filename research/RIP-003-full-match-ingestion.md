# RIP-003 — Full-match player-trace ingestion

## Question

Can the M001 pipeline replay a real player's match-scale locomotion trace rather than a short parser fixture, without committing the ~33 MB provider source file into LikeKerr?

## Source

Metrica Sports Sample Game 1, Home Team tracking:

- source repository: `metrica-sports/sample-data`;
- source file: `data/Sample_Game_1/Sample_Game_1_RawTrackingData_Home_Team.csv`;
- anonymised players;
- 25 Hz tracking;
- normalised pitch coordinates;
- Metrica sample pitch dimensions: 105 × 68 m.

The source repository asks public users to acknowledge Metrica Sports.

## Execution constraint

The agent execution environment cannot ingest the provider's ~33 MB raw CSV through its normal GitHub/file interfaces. This is an execution-environment transfer limit, not a LikeKerr architecture limitation.

The reproducible workaround is `.github/workflows/full-match-trace.yml`: a GitHub-hosted runner downloads the original file directly, derives a compact trace, validates it, and uploads only the derived result as an Actions artifact.

## Selected trace

Initial full-match target: anonymised `Home Player2`.

The small upstream parser fixture shows Player2 is present near both the beginning and end of Sample Game 1, making it a reasonable initial outfield/full-match candidate. The workflow still validates that the derived trace spans periods 1 and 2 and at least 80 minutes before accepting it.

## Derivation

`scripts/derive-metrica-full-match.mjs`:

1. converts normalised x/y to metres on a 105 × 68 m pitch;
2. computes speed only across adjacent same-period source frames;
3. caps raw finite-difference spikes at 12 m/s;
4. smooths speed over the preceding ~1 second of 25 Hz samples;
5. downsamples output to 1 Hz;
6. retains source time, period and frame for auditability;
7. applies the existing weak H1 baseline:

   `effort_0_1 = clamp(speed_mps / 7.5, 0, 1)`.

1 Hz is intentional for the first HR-synchronisation product trace: preserving 25 Hz positional variation would add data volume/noise without adding meaningful temporal resolution to the cardiovascular target.

## Acceptance

The workflow fails unless the derived trace:

- contains at least 4,000 samples;
- spans both periods;
- covers at least 80 minutes of source match time;
- contains only finite values;
- keeps speed within 0–12 m/s;
- keeps effort within 0–1.

## Evidence boundary

Passing this experiment establishes reproducible **match-scale ingestion and replay input**. It does not establish that the speed-only effort baseline is physiologically valid.
