import fs from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/dataDir.js";

/** 固定：$DATA_DIR/log/federation/<name>-YYYY-MM-DD.jsonl */
const FEDERATION_LOG_DIR = path.join("log", "federation");

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function ensureFederationLogDir() {
  const dir = path.join(DATA_DIR, FEDERATION_LOG_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dailyFile(baseName, day = dayKey()) {
  return path.join(ensureFederationLogDir(), `${baseName}-${day}.jsonl`);
}

export function getLedgerAuditLogPaths(day = dayKey()) {
  const dir = path.join(DATA_DIR, FEDERATION_LOG_DIR);
  return {
    dir,
    day,
    borrow: dailyFile("borrow-ledger", day),
    lend: dailyFile("lend-ledger", day),
  };
}

function fileForRole(reporterRole) {
  const { borrow, lend } = getLedgerAuditLogPaths();
  if (reporterRole === "borrower") return borrow;
  if (reporterRole === "lender") return lend;
  return dailyFile("unknown-ledger");
}

function summarizePayload(payload) {
  if (!payload) return {};
  return {
    requestId: payload.requestId,
    reporterRole: payload.reporterRole,
    borrowerDeviceId: payload.borrowerDeviceId,
    lenderDeviceId: payload.lenderDeviceId,
    logicalModel: payload.logicalModel,
    upstreamModel: payload.upstreamModel ?? null,
    inputTokens: payload.inputTokens,
    cacheTokens: payload.cacheTokens,
    outputTokens: payload.outputTokens,
    chargeUSD: payload.chargeUSD,
    outcome: payload.outcome,
    source: payload.source,
    reportedAt: payload.reportedAt,
  };
}

/**
 * 借入/借出各自写入独立 JSONL（按 UTC 日切分），便于与 Hub 对账。
 */
export function appendLedgerAudit(side, phase, payload, extra = {}) {
  const role = side === "lender" ? "lender" : "borrower";
  const line = JSON.stringify({
    at: new Date().toISOString(),
    side: role,
    phase,
    ...summarizePayload(payload),
    ...extra,
  });
  try {
    fs.appendFileSync(fileForRole(role), `${line}\n`);
  } catch {
    /* best effort */
  }
  const shortId = payload?.requestId?.slice(0, 8) || "?";
  console.log(`[Federation][ledger][${role}] ${phase} request=${shortId}…`);
}
