// Derive the compact LikeKerr M001 player fixture from the Metrica/Kloppy test sample.
// Source: https://github.com/PySport/kloppy/blob/master/kloppy/tests/files/metrica_home.csv
// Metrica pitch dimensions: 105 x 68 m.

const pitchWidthM = 105;
const pitchHeightM = 68;
const maxBaselineSpeedMps = 7.5;

// Player11, period 1, frames 1-3 from the cited source.
const source = [
  { timeS: 0.04, x01: 0.00082, y01: 0.48238 },
  { timeS: 0.08, x01: 0.00096, y01: 0.48238 },
  { timeS: 0.12, x01: 0.00114, y01: 0.48238 },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const t0 = source[0].timeS;

const rows = source.map((sample, i) => {
  const xM = sample.x01 * pitchWidthM;
  const yM = sample.y01 * pitchHeightM;
  let speedMps = 0;

  if (i > 0) {
    const previous = source[i - 1];
    const previousXM = previous.x01 * pitchWidthM;
    const previousYM = previous.y01 * pitchHeightM;
    const dt = sample.timeS - previous.timeS;
    speedMps = Math.hypot(xM - previousXM, yM - previousYM) / dt;
  }

  // Deliberately weak/auditable H1 baseline. We do not use acceleration yet:
  // finite differences over tiny tracking windows can produce edge spikes.
  const effort01 = clamp(speedMps / maxBaselineSpeedMps, 0, 1);

  return {
    tMs: Math.round((sample.timeS - t0) * 1000),
    xM,
    yM,
    speedMps,
    effort01,
  };
});

console.log("t_ms,x_m,y_m,speed_mps,effort_0_1");
for (const r of rows) {
  console.log([
    r.tMs,
    r.xM.toFixed(5),
    r.yM.toFixed(5),
    r.speedMps.toFixed(5),
    r.effort01.toFixed(5),
  ].join(","));
}
