import fs from "node:fs";
import path from "node:path";
import { HUB_DATA_DIR } from "../config.js";

/** 固定：$HUB_DATA_DIR/log/federation/<name>-YYYY-MM-DD.jsonl */
const FEDERATION_LOG_DIR = path.join("log", "federation");

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function ensureFederationLogDir() {
  const dir = path.join(HUB_DATA_DIR, FEDERATION_LOG_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dailyFile(baseName, day = dayKey()) {
  return path.join(ensureFederationLogDir(), `${baseName}-${day}.jsonl`);
}

export function getHubLedgerAuditLogPaths(day = dayKey()) {
  const dir = path.join(HUB_DATA_DIR, FEDERATION_LOG_DIR);
  return {
    dir,
    day,
    borrow: dailyFile("borrow-callback", day),
    lend: dailyFile("lend-callback", day),
  };
}

function fileForRole(reporterRole) {
  const { borrow, lend } = getHubLedgerAuditLogPaths();
  if (reporterRole === "borrower") return borrow;
  if (reporterRole === "lender") return lend;
  return dailyFile("unknown-callback");
}

/**
 * Hub 侧记录边缘借入/借出上报回调（按 UTC 日切分）。
 */
export function appendHubLedgerCallbackAudit(reporterRole, report, reporterDeviceId, settleResult = {}) {
  const role = reporterRole === "lender" ? "lender" : "borrower";
  const line = JSON.stringify({
    at: new Date().toISOString(),
    side: role,
    phase: "callback",
    reporterDeviceId,
    requestId: report.requestId,
    reporterRole: report.reporterRole,
    reportedAt: report.reportedAt,
    borrowerDeviceId: report.borrowerDeviceId,
    lenderDeviceId: report.lenderDeviceId,
    logicalModel: report.logicalModel,
    upstreamModel: report.upstreamModel,
    inputTokens: report.inputTokens,
    cacheTokens: report.cacheTokens,
    outputTokens: report.outputTokens,
    chargeUSD: report.chargeUSD,
    outcome: report.outcome,
    source: report.source,
    settlementStatus: settleResult.settlementStatus ?? null,
    idempotent: !!settleResult.idempotent,
    reason: settleResult.reason ?? null,
    chargeUSDSettled: settleResult.chargeUSD ?? null,
    borrowerCreditUSD: settleResult.borrowerCreditUSD ?? null,
    lenderCreditUSD: settleResult.lenderCreditUSD ?? null,
  });
  try {
    fs.appendFileSync(fileForRole(role), `${line}\n`);
  } catch {
    /* best effort */
  }
  const shortId = report.requestId?.slice(0, 8) || "?";
  console.log(
    `[hub][ledger][${role}] callback request=${shortId}… status=${settleResult.settlementStatus ?? "?"}`
  );
}
