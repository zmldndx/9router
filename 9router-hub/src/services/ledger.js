import { getDb } from "../db/index.js";
import {
  LEDGER_MATCH_TOLERANCE_USD,
  LEDGER_PENDING_EXPIRE_DAYS,
} from "../config.js";
import { newId, nowIso } from "../utils/ids.js";
import { computeChargeUSD } from "./pricing.js";
import { getDevice } from "./devices.js";

function tokensMatch(a, b) {
  return (
    a.input_tokens === b.input_tokens &&
    a.cache_tokens === b.cache_tokens &&
    a.output_tokens === b.output_tokens
  );
}

function chargeClose(a, b) {
  return Math.abs(a - b) <= LEDGER_MATCH_TOLERANCE_USD;
}

function normalizeReport(body) {
  return {
    requestId: body.requestId,
    reporterRole: body.reporterRole,
    reportedAt: body.reportedAt || nowIso(),
    borrowerDeviceId: body.borrowerDeviceId,
    lenderDeviceId: body.lenderDeviceId,
    logicalModel: body.logicalModel,
    upstreamModel: body.upstreamModel || null,
    inputTokens: Number(body.inputTokens || 0),
    cacheTokens: Number(body.cacheTokens || 0),
    outputTokens: Number(body.outputTokens || 0),
    chargeUSD: Number(body.chargeUSD || 0),
    outcome: body.outcome || "success",
    source: body.source || "live",
  };
}

export function submitLedgerReport(reporterDeviceId, body) {
  const r = normalizeReport(body);
  if (!["lender", "borrower"].includes(r.reporterRole)) {
    const err = new Error("Invalid reporterRole");
    err.status = 400;
    throw err;
  }
  const expected =
    r.reporterRole === "lender" ? r.lenderDeviceId : r.borrowerDeviceId;
  if (reporterDeviceId !== expected) {
    const err = new Error("reporterDeviceId does not match reporterRole");
    err.status = 403;
    throw err;
  }

  if (r.source === "recovery_probe") {
    return { requestId: r.requestId, settlementStatus: "skipped", reason: "recovery_probe" };
  }

  const db = getDb();
  const existingLedger = db
    .prepare(`SELECT settlement_status FROM federation_ledger WHERE request_id = ?`)
    .get(r.requestId);

  if (existingLedger?.settlement_status === "confirmed") {
    return { requestId: r.requestId, settlementStatus: "confirmed", idempotent: true };
  }

  db.prepare(
    `INSERT INTO federation_ledger_reports(
      request_id, reporter_role, reported_at, borrower_device_id, lender_device_id,
      logical_model, upstream_model, input_tokens, cache_tokens, output_tokens,
      charge_usd, outcome, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(request_id, reporter_role) DO UPDATE SET
      reported_at = excluded.reported_at,
      borrower_device_id = excluded.borrower_device_id,
      lender_device_id = excluded.lender_device_id,
      logical_model = excluded.logical_model,
      upstream_model = excluded.upstream_model,
      input_tokens = excluded.input_tokens,
      cache_tokens = excluded.cache_tokens,
      output_tokens = excluded.output_tokens,
      charge_usd = excluded.charge_usd,
      outcome = excluded.outcome,
      source = excluded.source`
  ).run(
    r.requestId,
    r.reporterRole,
    r.reportedAt,
    r.borrowerDeviceId,
    r.lenderDeviceId,
    r.logicalModel,
    r.upstreamModel,
    r.inputTokens,
    r.cacheTokens,
    r.outputTokens,
    r.chargeUSD,
    r.outcome,
    r.source
  );

  return trySettle(r.requestId);
}

function trySettle(requestId) {
  const db = getDb();
  const lender = db
    .prepare(`SELECT * FROM federation_ledger_reports WHERE request_id = ? AND reporter_role = 'lender'`)
    .get(requestId);
  const borrower = db
    .prepare(`SELECT * FROM federation_ledger_reports WHERE request_id = ? AND reporter_role = 'borrower'`)
    .get(requestId);

  if (!lender || !borrower) {
    ensurePendingLedger(requestId, lender, borrower);
    return { requestId, settlementStatus: "pending" };
  }

  const identityMismatch =
    lender.borrower_device_id !== borrower.borrower_device_id ||
    lender.lender_device_id !== borrower.lender_device_id ||
    lender.logical_model !== borrower.logical_model;

  if (identityMismatch) {
    return finalizeLedger(requestId, lender, borrower, "mismatch", 0);
  }

  if (lender.outcome === "failed" && borrower.outcome === "failed") {
    return finalizeLedger(requestId, lender, borrower, "failed", 0);
  }

  if (lender.outcome !== borrower.outcome) {
    return finalizeLedger(requestId, lender, borrower, "mismatch", 0);
  }

  if (lender.outcome !== "success") {
    return finalizeLedger(requestId, lender, borrower, "failed", 0);
  }

  const tokenOk = tokensMatch(lender, borrower);
  const hubCharge = computeChargeUSD(
    lender.logical_model,
    lender.input_tokens,
    lender.cache_tokens,
    lender.output_tokens
  );
  if (hubCharge == null) {
    return finalizeLedger(requestId, lender, borrower, "mismatch", 0);
  }

  const chargeOk =
    tokenOk ||
    (chargeClose(lender.charge_usd, hubCharge) && chargeClose(borrower.charge_usd, hubCharge));

  if (!chargeOk) {
    return finalizeLedger(requestId, lender, borrower, "mismatch", hubCharge);
  }

  return applyConfirmedSettlement(requestId, lender, borrower, hubCharge);
}

function ensurePendingLedger(requestId, lender, borrower) {
  const db = getDb();
  const row = db.prepare(`SELECT id FROM federation_ledger WHERE request_id = ?`).get(requestId);
  if (row) return;
  const ref = lender || borrower;
  if (!ref) return;
  const now = nowIso();
  db.prepare(
    `INSERT INTO federation_ledger(
      id, request_id, confirmed_at, borrower_device_id, lender_device_id, logical_model,
      upstream_model, input_tokens, cache_tokens, output_tokens, charge_usd,
      settlement_status, source, lender_reported_at, borrower_reported_at, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 0, 0, 0, 0, 'pending', ?, ?, ?, ?)`
  ).run(
    newId("fl"),
    requestId,
    ref.borrower_device_id,
    ref.lender_device_id,
    ref.logical_model,
    lender?.upstream_model || null,
    ref.source,
    lender?.reported_at || null,
    borrower?.reported_at || null,
    now
  );
}

function finalizeLedger(requestId, lender, borrower, status, chargeUsd) {
  const db = getDb();
  const now = nowIso();
  const existing = db.prepare(`SELECT id FROM federation_ledger WHERE request_id = ?`).get(requestId);
  const tokens = lender || borrower;
  if (existing) {
    db.prepare(
      `UPDATE federation_ledger SET settlement_status = ?, charge_usd = ?,
        lender_reported_at = ?, borrower_reported_at = ? WHERE request_id = ?`
    ).run(status, chargeUsd, lender?.reported_at, borrower?.reported_at, requestId);
  } else {
    db.prepare(
      `INSERT INTO federation_ledger(
        id, request_id, confirmed_at, borrower_device_id, lender_device_id, logical_model,
        upstream_model, input_tokens, cache_tokens, output_tokens, charge_usd,
        settlement_status, source, lender_reported_at, borrower_reported_at, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId("fl"),
      requestId,
      tokens.borrower_device_id,
      tokens.lender_device_id,
      tokens.logical_model,
      lender?.upstream_model || null,
      lender?.input_tokens || 0,
      lender?.cache_tokens || 0,
      lender?.output_tokens || 0,
      chargeUsd,
      status,
      tokens.source,
      lender?.reported_at || null,
      borrower?.reported_at || null,
      now
    );
  }
  return { requestId, settlementStatus: status };
}

function applyConfirmedSettlement(requestId, lender, borrower, chargeUsd) {
  const db = getDb();
  const borrowerUser = db
    .prepare(
      `SELECT u.id, u.credit_usd FROM users u
       JOIN devices d ON d.user_id = u.id WHERE d.device_id = ?`
    )
    .get(lender.borrower_device_id);
  const lenderUser = db
    .prepare(
      `SELECT u.id, u.credit_usd FROM users u
       JOIN devices d ON d.user_id = u.id WHERE d.device_id = ?`
    )
    .get(lender.lender_device_id);

  if (!borrowerUser || !lenderUser) {
    return finalizeLedger(requestId, lender, borrower, "mismatch", chargeUsd);
  }
  if (borrowerUser.credit_usd < chargeUsd) {
    return finalizeLedger(requestId, lender, borrower, "mismatch", chargeUsd);
  }

  const now = nowIso();
  let result;
  db.transaction(() => {
    db.prepare(`UPDATE users SET credit_usd = credit_usd - ? WHERE id = ?`).run(
      chargeUsd,
      borrowerUser.id
    );
    db.prepare(`UPDATE users SET credit_usd = credit_usd + ? WHERE id = ?`).run(
      chargeUsd,
      lenderUser.id
    );
    const bAfter = db.prepare(`SELECT credit_usd FROM users WHERE id = ?`).get(borrowerUser.id);
    const lAfter = db.prepare(`SELECT credit_usd FROM users WHERE id = ?`).get(lenderUser.id);

    const existing = db.prepare(`SELECT id FROM federation_ledger WHERE request_id = ?`).get(requestId);
    if (existing) {
      db.prepare(
        `UPDATE federation_ledger SET settlement_status = 'confirmed', confirmed_at = ?,
          input_tokens = ?, cache_tokens = ?, output_tokens = ?, charge_usd = ?,
          borrower_credit_usd_after = ?, lender_credit_usd_after = ?,
          lender_reported_at = ?, borrower_reported_at = ? WHERE request_id = ?`
      ).run(
        now,
        lender.input_tokens,
        lender.cache_tokens,
        lender.output_tokens,
        chargeUsd,
        bAfter.credit_usd,
        lAfter.credit_usd,
        lender.reported_at,
        borrower.reported_at,
        requestId
      );
    } else {
      db.prepare(
        `INSERT INTO federation_ledger(
          id, request_id, confirmed_at, borrower_device_id, lender_device_id, logical_model,
          upstream_model, input_tokens, cache_tokens, output_tokens, charge_usd,
          borrower_credit_usd_after, lender_credit_usd_after, settlement_status, source,
          lender_reported_at, borrower_reported_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`
      ).run(
        newId("fl"),
        requestId,
        now,
        lender.borrower_device_id,
        lender.lender_device_id,
        lender.logical_model,
        lender.upstream_model,
        lender.input_tokens,
        lender.cache_tokens,
        lender.output_tokens,
        chargeUsd,
        bAfter.credit_usd,
        lAfter.credit_usd,
        lender.source,
        lender.reported_at,
        borrower.reported_at,
        now
      );
    }
    result = {
      requestId,
      settlementStatus: "confirmed",
      chargeUSD: chargeUsd,
      borrowerCreditUSD: bAfter.credit_usd,
      lenderCreditUSD: lAfter.credit_usd,
    };
  })();
  return result;
}

export function listLedgerEvents(userId, { days = 7, limit = 100 } = {}) {
  const db = getDb();
  const deviceIds = db
    .prepare(`SELECT device_id FROM devices WHERE user_id = ?`)
    .all(userId)
    .map((r) => r.device_id);
  if (!deviceIds.length) return [];

  const since = new Date(Date.now() - days * 86400000).toISOString();
  const placeholders = deviceIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT * FROM federation_ledger
       WHERE created_at >= ?
         AND (borrower_device_id IN (${placeholders}) OR lender_device_id IN (${placeholders}))
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(since, ...deviceIds, ...deviceIds, limit)
    .map((row) => ({
      requestId: row.request_id,
      settlementStatus: row.settlement_status,
      borrowerDeviceId: row.borrower_device_id,
      lenderDeviceId: row.lender_device_id,
      logicalModel: row.logical_model,
      chargeUSD: row.charge_usd,
      confirmedAt: row.confirmed_at,
      createdAt: row.created_at,
    }));
}

export function countPendingReports(userId) {
  const db = getDb();
  const deviceIds = db
    .prepare(`SELECT device_id FROM devices WHERE user_id = ?`)
    .all(userId)
    .map((r) => r.device_id);
  if (!deviceIds.length) return { pending: 0, mismatch: 0 };

  const placeholders = deviceIds.map(() => "?").join(",");
  const pending = db
    .prepare(
      `SELECT COUNT(*) AS c FROM federation_ledger
       WHERE settlement_status = 'pending'
         AND (borrower_device_id IN (${placeholders}) OR lender_device_id IN (${placeholders}))`
    )
    .get(...deviceIds, ...deviceIds)?.c;
  const mismatch = db
    .prepare(
      `SELECT COUNT(*) AS c FROM federation_ledger
       WHERE settlement_status = 'mismatch'
         AND (borrower_device_id IN (${placeholders}) OR lender_device_id IN (${placeholders}))`
    )
    .get(...deviceIds, ...deviceIds)?.c;
  return { pending: pending || 0, mismatch: mismatch || 0 };
}

export function expireStalePending() {
  const db = getDb();
  const cutoff = new Date(
    Date.now() - LEDGER_PENDING_EXPIRE_DAYS * 86400000
  ).toISOString();
  db.prepare(
    `UPDATE federation_ledger SET settlement_status = 'expired'
     WHERE settlement_status = 'pending' AND created_at < ?`
  ).run(cutoff);
}
