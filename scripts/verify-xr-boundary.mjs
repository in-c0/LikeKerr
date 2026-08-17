import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const xrRoot = "apps/xr";
const scriptsRoot = join(xrRoot, "Assets/Scripts");
const forbidden = [
  /\bFTMS\b/i,
  /FtmsControlClient/,
  /TreadmillAdapter/,
  /setTargetSpeed/i,
  /setTargetInclination/i,
  /requestControl/i,
];

const files = (await readdir(scriptsRoot)).filter((name) => name.endsWith(".cs"));
if (files.length < 3) throw new Error("XR runtime scaffold is incomplete");

for (const file of files) {
  const content = await readFile(join(scriptsRoot, file), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      throw new Error(`XR read-only boundary violated by ${file}: ${pattern}`);
    }
  }
}

const client = await readFile(join(scriptsRoot, "SseTelemetryClient.cs"), "utf8");
if (!client.includes("text/event-stream") || !client.includes("UnityWebRequest.kHttpVerbGET")) {
  throw new Error("XR client must consume the read-only SSE GET stream");
}

const manifest = JSON.parse(await readFile(join(xrRoot, "Packages/manifest.json"), "utf8"));
const deps = manifest.dependencies ?? {};
for (const dependency of [
  "com.unity.inputsystem",
  "com.unity.xr.management",
  "com.unity.xr.openxr",
  "com.unity.xr.interaction.toolkit",
]) {
  if (!deps[dependency]) throw new Error(`Missing XR dependency: ${dependency}`);
}

console.log(`LikeKerr XR read-only boundary verified across ${files.length} C# files`);
