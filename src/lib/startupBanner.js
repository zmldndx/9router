import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { DATA_DIR } from "@/lib/dataDir.js";
import { getLedgerAuditLogPaths } from "@/lib/federation/ledgerAuditLog.js";
import { getSettings, getApiKeys } from "@/lib/localDb";
import { getFederationSettings, getLocalDeviceId, resolvePublicEndpointUrl } from "@/lib/federation/settings.js";
import { getRawMachineId } from "@/shared/utils/machineId.js";
import { resolveBaseUrl, resolveListenHostname, resolveServicePort, isBaseUrlConfigured } from "@/lib/baseUrl.mjs";
import { TAILSCALE_SOCKET } from "@/lib/tunnel/tailscale/tailscale.js";
import { getTailscaledBin } from "@/lib/tunnel/tailscale/tailscale.js";

const LINE = "─".repeat(56);

export function maskSecret(value, { head = 4, tail = 4 } = {}) {
  if (value == null || value === "") return "(unset)";
  const s = String(value);
  if (s.length <= head + tail + 1) return `${"*".repeat(Math.min(s.length, 8))} (${s.length} chars)`;
  return `${s.slice(0, head)}…${s.slice(-tail)} (${s.length} chars)`;
}

export function secretFingerprint(value) {
  if (value == null || value === "") return "(unset)";
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function detectInstanceLabel() {
  if (process.env.INSTANCE_NAME?.trim()) return process.env.INSTANCE_NAME.trim();
  const port = resolveServicePort();
  const dataDir = process.env.DATA_DIR || DATA_DIR;
  if (port === 20129 || String(dataDir).includes("borrower2")) return "9router-dev2";
  if (port === 20128) return "9router";
  return `9router (port ${port})`;
}

function readFunnelProxyPort() {
  const bin = getTailscaledBin();
  if (!bin || !existsSync(TAILSCALE_SOCKET)) {
    return { funnelUrl: null, proxyPort: null, note: "tailscale socket not found" };
  }
  try {
    const out = execSync(`"${bin}" --socket="${TAILSCALE_SOCKET}" funnel status`, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const urlMatch = out.match(/https:\/\/[^\s/]+\.ts\.net/i);
    const portMatch = out.match(/proxy\s+http:\/\/127\.0\.0\.1:(\d+)/i);
    return {
      funnelUrl: urlMatch ? urlMatch[0] : null,
      proxyPort: portMatch ? Number(portMatch[1]) : null,
      note: null,
    };
  } catch (e) {
    return { funnelUrl: null, proxyPort: null, note: e.message || "funnel status failed" };
  }
}

function portCheck(expected, actual) {
  if (actual == null) return "—";
  return actual === expected ? `OK (→ ${actual})` : `MISMATCH (funnel→${actual}, expect ${expected})`;
}

/**
 * 服务启动时打印端口、DATA_DIR、联邦/Hub、Tailscale Funnel 等，便于人工核对。
 * 每个 Node 进程只打印一次（避免 HMR 刷屏）。
 */
export async function print9routerStartupBanner() {
  if (global.__9routerStartupBannerDone) return;
  global.__9routerStartupBannerDone = true;

  const envPath = path.join(process.cwd(), ".env");
  const label = detectInstanceLabel();
  const port = resolveServicePort();
  const settings = await getSettings();
  const fed = await getFederationSettings();
  const deviceId = await getLocalDeviceId();
  const endpointUrl = await resolvePublicEndpointUrl();
  const funnel = readFunnelProxyPort();
  const apiKeys = await getApiKeys().catch(() => []);

  const fedSecret = process.env.FEDERATION_JWT_SECRET || "dev-federation-jwt-secret-change-me";
  const lines = [
    "",
    LINE,
    `  ${label} — startup diagnostics`,
    LINE,
    `  .env file              ${envPath}${existsSync(envPath) ? " (present)" : " (missing, using defaults)"}`,
    `  PORT (listen)           ${port}`,
    `  HOSTNAME (listen)       ${resolveListenHostname()}`,
    `  DATA_DIR                ${process.env.DATA_DIR || DATA_DIR}`,
    `  MACHINE_ID_SALT         ${process.env.MACHINE_ID_SALT ? maskSecret(process.env.MACHINE_ID_SALT, { head: 3, tail: 3 }) : "(unset, hardware-derived deviceId)"}`,
    `  BASE_URL                ${resolveBaseUrl()}${isBaseUrlConfigured() ? " (from env)" : " (auto)"}`,
    `  deviceId (federation)   ${deviceId}`,
    `  rawMachineId            ${await getRawMachineId()}`,
    "",
    "  Secrets (compare fingerprints across 9router / dev2 / hub):",
    `  FEDERATION_JWT_SECRET   ${maskSecret(fedSecret)}`,
    `  federationJwtFp         ${secretFingerprint(fedSecret)}`,
    `  JWT_SECRET (dashboard)  ${maskSecret(process.env.JWT_SECRET || "(env unset, use data dir file)")}`,
    "",
    "  Federation:",
    `  federationEnabled       ${fed.federationEnabled}`,
    `  hubUrl                  ${fed.hubUrl || "(unset)"}`,
    `  hubEmail                ${fed.federationHubEmail || "(unset)"}`,
    `  hubUserId               ${fed.federationUserId || "(unset)"}`,
    `  hubAccessToken          ${maskSecret(fed.hubAccessToken)}`,
    `  hubTokenFp              ${secretFingerprint(fed.hubAccessToken)}`,
    `  borrowEnabled           ${fed.federationBorrowEnabled}`,
    `  lendEnabled             ${fed.federationLendEnabled}`,
    `  exposeModels            ${(fed.federationExposeModels || []).join(", ") || "(none)"}`,
    `  publicEndpoint (saved)  ${endpointUrl || "(none)"}`,
    `  ledgerAudit dir         ${getLedgerAuditLogPaths().dir} (day=${getLedgerAuditLogPaths().day})`,
    `  ledgerAudit (borrow)    ${getLedgerAuditLogPaths().borrow}`,
    `  ledgerAudit (lend)      ${getLedgerAuditLogPaths().lend}`,
    "",
    "  Tailscale:",
    `  tailscaleEnabled        ${!!settings.tailscaleEnabled}`,
    `  tailscaleUrl (settings) ${settings.tailscaleUrl || "(none)"}`,
    `  funnelPublicUrl (cli)   ${funnel.funnelUrl || "(off)"}`,
    `  funnelProxyPort         ${funnel.proxyPort ?? "(n/a)"} ${portCheck(port, funnel.proxyPort)}`,
    ...(funnel.note ? [`  funnelNote              ${funnel.note}`] : []),
    "",
    `  API keys (${apiKeys.length}):`,
    ...(apiKeys.length
      ? apiKeys.slice(0, 5).map((k) => `    - ${k.name || k.id}: ${maskSecret(k.key)}`)
      : ["    (none)"]),
    ...(apiKeys.length > 5 ? [`    … +${apiKeys.length - 5} more`] : []),
    "",
    `  OpenAI-compatible API   http://127.0.0.1:${port}/v1`,
    LINE,
    "",
  ];

  for (const line of lines) console.log(line);
}
