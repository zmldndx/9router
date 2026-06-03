const http = require("http");
const https = require("https");

function requestJson(url, { method = "GET", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = { raw };
          }
          if (res.statusCode >= 400) {
            reject(new Error(parsed?.error || raw || res.statusMessage));
          } else {
            resolve(parsed);
          }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function routerBase(port) {
  return `http://127.0.0.1:${port}`;
}

async function cmdDeviceId(port) {
  const data = await requestJson(`${routerBase(port)}/api/federation/device-id`);
  console.log(data.deviceId);
}

async function cmdStatus(port) {
  const data = await requestJson(`${routerBase(port)}/api/federation/status`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdJoin(port, argv) {
  const hub = argv[1] || process.env.HUB_URL;
  const email = argv[3] || process.env.FEDERATION_EMAIL;
  const password = argv[5] || process.env.FEDERATION_PASSWORD;
  if (!hub || argv[0] !== "--hub" || !email || argv[2] !== "--email" || !password || argv[4] !== "--password") {
    console.log("Usage: 9router federate join --hub <url> --email <e> --password <p>");
    process.exit(1);
  }
  const data = await requestJson(`${routerBase(port)}/api/federation/join`, {
    method: "POST",
    body: { hubUrl: hub, email, password },
  });
  console.log(JSON.stringify(data, null, 2));
}

async function cmdLend(port, argv) {
  const on = argv.includes("--on");
  const off = argv.includes("--off");
  const modelsIdx = argv.indexOf("--models");
  const models =
    modelsIdx >= 0 && argv[modelsIdx + 1]
      ? argv[modelsIdx + 1].split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
  await requestJson(`${routerBase(port)}/api/federation/settings`, {
    method: "PATCH",
    body: {
      federationLendEnabled: off ? false : on || true,
      federationExposeModels: models,
      lendPolicy: {
        lendEnabled: off ? false : on || true,
        exposeModels: models,
      },
    },
  });
  console.log("Lend policy updated");
}

async function cmdBorrow(port, argv) {
  const on = argv.includes("--on");
  const off = argv.includes("--off");
  await requestJson(`${routerBase(port)}/api/federation/settings`, {
    method: "PATCH",
    body: {
      federationBorrowEnabled: off ? false : on || true,
      borrowPolicy: { borrowEnabled: off ? false : on || true },
    },
  });
  console.log("Borrow policy updated");
}

function printHelp() {
  console.log(`9router federate commands:
  device-id              Show this machine's federation deviceId
  status                 Hub credit + ledger summary (server must run)
  join --hub URL --email E --password P
  lend [--on|--off] [--models m1,m2]
  borrow [--on|--off]`);
}

async function run(argv, { port }) {
  const sub = argv[0];
  try {
    if (!sub || sub === "help" || sub === "-h") {
      printHelp();
      return;
    }
    if (sub === "device-id") return cmdDeviceId(port);
    if (sub === "status") return cmdStatus(port);
    if (sub === "join") return cmdJoin(port, argv);
    if (sub === "lend") return cmdLend(port, argv.slice(1));
    if (sub === "borrow") return cmdBorrow(port, argv.slice(1));
    printHelp();
    process.exit(1);
  } catch (e) {
    console.error(`federate error: ${e.message}`);
    console.error("(Is 9router server running on port", port, "?)");
    process.exit(1);
  }
}

module.exports = { run };
