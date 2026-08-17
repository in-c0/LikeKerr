import http from "node:http";
import { spawn } from "node:child_process";

const backendPort = Number(process.env.BACKEND_PORT ?? 4173);
const lanPort = Number(process.env.XR_PORT ?? 4174);

const backend = spawn(
  process.execPath,
  ["apps/mobile/prototype-server.mjs"],
  {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(backendPort) },
    stdio: ["ignore", "inherit", "inherit"],
  },
);

backend.on("exit", (code, signal) => {
  if (code !== 0 && signal == null) {
    console.error(`LikeKerr backend exited with code ${code}`);
  }
});

const proxy = http.createServer((req, res) => {
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: backendPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end(`LikeKerr backend unavailable: ${error.message}`);
  });

  req.pipe(upstream);
});

proxy.listen(lanPort, "0.0.0.0", () => {
  console.log(`LikeKerr XR LAN bridge listening on http://0.0.0.0:${lanPort}`);
  console.log("Use this mode only on a trusted local network.");
});

function shutdown() {
  proxy.close();
  if (!backend.killed) backend.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
