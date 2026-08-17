import { readFile, writeFile } from "node:fs/promises";

const PITCH_LENGTH_M = 105;
const PITCH_WIDTH_M = 68;
const SOURCE_HZ = 25;
const OUTPUT_HZ = 1;
const SPEED_WINDOW_SAMPLES = SOURCE_HZ;
const MAX_PLAUSIBLE_SPEED_MPS = 12;
const EFFORT_REFERENCE_SPEED_MPS = 7.5;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function parseArgs(argv) {
  const args = { input: null, output: null, player: "Player2" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--player") args.player = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.input) throw new Error("--input is required");
  if (!args.output) throw new Error("--output is required");
  return args;
}

function finiteNumber(value) {
  if (value === "" || value === "NaN" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function deriveTrace(csvText, playerName) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 4) throw new Error("Metrica CSV is too short");

  const header = lines[2].split(",");
  const playerXIndex = header.findIndex((value) => value === playerName);
  if (playerXIndex < 0) {
    throw new Error(`${playerName} was not found in the Metrica header`);
  }
  const playerYIndex = playerXIndex + 1;

  const output = [];
  const speedWindow = [];
  let previous = null;
  let lastOutputSecond = null;
  let validSourceSamples = 0;
  let missingSourceSamples = 0;

  for (let lineIndex = 3; lineIndex < lines.length; lineIndex += 1) {
    const columns = lines[lineIndex].split(",");
    const period = finiteNumber(columns[0]);
    const frame = finiteNumber(columns[1]);
    const timeS = finiteNumber(columns[2]);
    const x01 = finiteNumber(columns[playerXIndex]);
    const y01 = finiteNumber(columns[playerYIndex]);

    if (period === null || frame === null || timeS === null) continue;
    if (x01 === null || y01 === null) {
      missingSourceSamples += 1;
      previous = null;
      speedWindow.length = 0;
      continue;
    }

    validSourceSamples += 1;
    const xM = x01 * PITCH_LENGTH_M;
    const yM = y01 * PITCH_WIDTH_M;

    let instantaneousSpeedMps = 0;
    if (previous && previous.period === period) {
      const dt = timeS - previous.timeS;
      // Only differentiate genuinely adjacent tracking samples. This avoids
      // creating huge pseudo-sprints across substitutions, gaps or halftime.
      if (dt > 0 && dt <= 0.08) {
        instantaneousSpeedMps = Math.hypot(xM - previous.xM, yM - previous.yM) / dt;
        instantaneousSpeedMps = clamp(instantaneousSpeedMps, 0, MAX_PLAUSIBLE_SPEED_MPS);
      }
    }

    previous = { period, timeS, xM, yM };
    speedWindow.push(instantaneousSpeedMps);
    if (speedWindow.length > SPEED_WINDOW_SAMPLES) speedWindow.shift();

    const second = Math.floor(timeS);
    if (second === lastOutputSecond) continue;
    lastOutputSecond = second;

    const speedMps = mean(speedWindow);
    const effort01 = clamp(speedMps / EFFORT_REFERENCE_SPEED_MPS, 0, 1);
    output.push({
      tMs: Math.round(timeS * 1000),
      period,
      frame,
      xM,
      yM,
      speedMps,
      effort01,
    });
  }

  if (!output.length) throw new Error(`No valid ${playerName} tracking samples were derived`);

  return {
    playerName,
    validSourceSamples,
    missingSourceSamples,
    output,
  };
}

function toCsv(result) {
  const rows = ["t_ms,period,frame,x_m,y_m,speed_mps,effort_0_1"];
  for (const row of result.output) {
    rows.push([
      row.tMs,
      row.period,
      row.frame,
      row.xM.toFixed(5),
      row.yM.toFixed(5),
      row.speedMps.toFixed(5),
      row.effort01.toFixed(5),
    ].join(","));
  }
  return `${rows.join("\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const source = await readFile(args.input, "utf8");
  const result = deriveTrace(source, args.player);
  await writeFile(args.output, toCsv(result), "utf8");

  const first = result.output[0];
  const last = result.output.at(-1);
  console.log(JSON.stringify({
    player: result.playerName,
    validSourceSamples: result.validSourceSamples,
    missingSourceSamples: result.missingSourceSamples,
    outputSamples: result.output.length,
    firstTimeS: first.tMs / 1000,
    lastTimeS: last.tMs / 1000,
    durationMinutes: (last.tMs - first.tMs) / 60000,
    outputHz: OUTPUT_HZ,
    speedSmoothingWindowSeconds: SPEED_WINDOW_SAMPLES / SOURCE_HZ,
    effortReferenceSpeedMps: EFFORT_REFERENCE_SPEED_MPS,
  }, null, 2));
}
