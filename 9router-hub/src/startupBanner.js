import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOST,
  PORT,
  DB_PATH,
  HUB_DATA_DIR,
  HUB_JWT_SECRET,
  FEDERATION_JWT_SECRET,
  HUB_ADMIN_TOKEN,
  OFFICIAL_DEVICE_IDS,
} from "./config.js";
import { getHubLedgerAuditLogPaths } from "./services/ledgerAuditLog.js";
import { getProbeHeartbeatLogPaths } from "./services/probeHeartbeatLog.js";

const hubRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const hubEnvPath = join(hubRoot, ".env");

const LINE = "─".repeat(56);

function maskSecret(value, { head = 4, tail = 4 } = {}) {
  if (value == null || value === "") return "(unset)";
  const s = String(value);
  if (s.length <= head + tail + 1) return `${"*".repeat(Math.min(s.length, 8))} (${s.length} chars)`;
  return `${s.slice(0, head)}…${s.slice(-tail)} (${s.length} chars)`;
}

function secretFingerprint(value) {
  if (value == null || value === "") return "(unset)";
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

let printed = false;

/** Hub 启动时打印端口与密钥指纹（与边缘 9router 的 federationJwtFp 应对齐） */
export function printHubStartupBanner() {
  if (printed) return;
  printed = true;

  const lines = [
    "",
    LINE,
    "  9router-hub — startup diagnostics",
    LINE,
    `  .env file              ${hubEnvPath}${existsSync(hubEnvPath) ? " (present)" : " (missing, using defaults)"}`,
    `  HOST                    ${HOST}`,
    `  PORT                    ${PORT}`,
    `  HUB_DATA_DIR            ${HUB_DATA_DIR}`,
    `  Database                ${DB_PATH}`,
    "",
    "  Secrets (federationJwtFp must match 9router & 9router-dev2):",
    `  HUB_JWT_SECRET          ${maskSecret(HUB_JWT_SECRET)}`,
    `  hubJwtFp                ${secretFingerprint(HUB_JWT_SECRET)}`,
    `  FEDERATION_JWT_SECRET   ${maskSecret(FEDERATION_JWT_SECRET)}`,
    `  federationJwtFp         ${secretFingerprint(FEDERATION_JWT_SECRET)}`,
    `  HUB_ADMIN_TOKEN         ${HUB_ADMIN_TOKEN ? maskSecret(HUB_ADMIN_TOKEN) : "(unset, localhost admin only)"}`,
    "",
    `  OFFICIAL_DEVICE_IDS     ${OFFICIAL_DEVICE_IDS.join(", ") || "(none)"}`,
    "",
    "  Federation ledger audit (Hub callbacks, daily JSONL):",
    `  log dir                 ${getHubLedgerAuditLogPaths().dir} (day=${getHubLedgerAuditLogPaths().day})`,
    `  borrow-callback         ${getHubLedgerAuditLogPaths().borrow}`,
    `  lend-callback           ${getHubLedgerAuditLogPaths().lend}`,
    "",
    "  Lend probe log (daily, not federation ledger):",
    `  probe heartbeat         ${getProbeHeartbeatLogPaths().file}`,
    "",
    `  Dashboard               http://${HOST}:${PORT}/`,
    `  Health                  http://${HOST}:${PORT}/health`,
    LINE,
    "",
  ];

  for (const line of lines) console.log(line);
}
