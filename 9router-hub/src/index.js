import "./loadEnv.js";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PORT, UI_REFRESH_MS, DB_PATH } from "./config.js";
import { printHubStartupBanner } from "./startupBanner.js";
import { getDb } from "./db/index.js";
import { expireStalePending } from "./services/ledger.js";
import { getHubLedgerAuditLogPaths } from "./services/ledgerAuditLog.js";
import { getProbeHeartbeatLogPaths } from "./services/probeHeartbeatLog.js";
import { authRouter } from "./routes/auth.js";
import { devicesRouter } from "./routes/devices.js";
import { devicesPublicRouter } from "./routes/devicesPublic.js";
import { federationRouter } from "./routes/federation.js";
import { ledgerRouter } from "./routes/ledger.js";
import { metricsRouter } from "./routes/metrics.js";
import { meRouter } from "./routes/me.js";
import { pricingRouter } from "./routes/pricing.js";
import { adminRouter } from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");

getDb();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "9router-hub",
    dbPath: DB_PATH,
    ledgerAuditLogs: getHubLedgerAuditLogPaths(),
    probeHeartbeatLog: getProbeHeartbeatLogPaths(),
  });
});

app.use(express.static(publicDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use("/v1/admin", adminRouter);
app.use("/v1/auth", authRouter);
app.use("/v1/devices", devicesPublicRouter);
app.use("/v1/devices", devicesRouter);
app.use("/v1/federation", federationRouter);
app.use("/v1/ledger", ledgerRouter);
app.use("/v1/metrics", metricsRouter);
app.use("/v1/me", meRouter);
app.use("/v1/pricing", pricingRouter);

app.use((err, _req, res, _next) => {
  console.error("[hub]", err);
  res.status(500).json({ error: "Internal server error" });
});

setInterval(() => {
  try {
    expireStalePending();
  } catch (e) {
    console.error("[hub] expireStalePending", e.message);
  }
}, 3600000);

app.listen(PORT, () => {
  printHubStartupBanner();
  console.log(`9router-hub listening on http://127.0.0.1:${PORT}`);
  console.log(`Dashboard UI: http://127.0.0.1:${PORT}/ (refresh ${UI_REFRESH_MS}ms)`);
});
