import { getDb } from "../db/index.js";
import { HOLD_USD, OFFICIAL_DEVICE_IDS } from "../config.js";
import { newId, nowIso } from "../utils/ids.js";
import { signFederationToken } from "../utils/tokens.js";
import { getModelPricing, computeChargeUSD } from "./pricing.js";
import {
  getDevice,
  listUserDevices,
  deviceCanLend,
  isDeviceOnline,
} from "./devices.js";
import { getUserById } from "./auth.js";
import { countPendingReports } from "./ledger.js";
import { getUserFederationBreakdown } from "./analytics.js";

export function findLenders(logicalModel, excludeDeviceIds = []) {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM devices WHERE lend_enabled = 1`).all();
  const lenders = [];
  for (const row of rows) {
    const device = {
      deviceId: row.device_id,
      endpointUrl: row.endpoint_url,
      lendEnabled: !!row.lend_enabled,
      online: isDeviceOnline(row.last_seen_at),
      exposeModels: JSON.parse(row.expose_models || "[]"),
      lendAllowed: JSON.parse(row.lend_allowed || "{}"),
    };
    if (excludeDeviceIds.includes(device.deviceId)) continue;
    if (!deviceCanLend(device, logicalModel)) continue;
    lenders.push({
      deviceId: device.deviceId,
      endpointUrl: device.endpointUrl,
    });
  }
  for (const officialId of OFFICIAL_DEVICE_IDS) {
    if (excludeDeviceIds.includes(officialId)) continue;
    const official = getDevice(officialId);
    if (official?.endpointUrl) {
      lenders.unshift({ deviceId: officialId, endpointUrl: official.endpointUrl, official: true });
    }
  }
  return lenders;
}

export async function createSchedule(userId, { logicalModel, borrowerDeviceId }) {
  const pricing = getModelPricing(logicalModel);
  if (!pricing) {
    const err = new Error(`No pricing for logical model: ${logicalModel}`);
    err.status = 400;
    throw err;
  }

  const borrower = getDevice(borrowerDeviceId);
  if (!borrower || borrower.userId !== userId) {
    const err = new Error("borrower device not found");
    err.status = 404;
    throw err;
  }
  if (!borrower.borrowEnabled) {
    const err = new Error("Borrow disabled on device");
    err.status = 403;
    throw err;
  }

  const user = getUserById(userId);
  if (!user || user.credit_usd <= HOLD_USD) {
    const err = new Error("Insufficient creditUSD");
    err.status = 402;
    throw err;
  }

  const lenders = findLenders(logicalModel);
  if (!lenders.length) {
    const err = new Error("No lenders available");
    err.status = 503;
    throw err;
  }

  const primary = lenders[0];
  const fallbacks = lenders.slice(1, 6);
  const requestId = newId("req");
  const jti = newId("jti");
  const federationToken = await signFederationToken({
    requestId,
    borrowerDeviceId,
    lenderDeviceId: primary.deviceId,
    logicalModel,
    jti,
  });

  const now = nowIso();
  const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO federation_schedules(request_id, borrower_device_id, lender_device_id, logical_model, hold_usd, federation_jti, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(requestId, borrowerDeviceId, primary.deviceId, logicalModel, HOLD_USD, jti, now, expiresAt);

  return {
    requestId,
    holdUSD: HOLD_USD,
    primary: {
      deviceId: primary.deviceId,
      endpointUrl: primary.endpointUrl,
      federationToken,
    },
    fallbacks: await Promise.all(
      fallbacks.map(async (l) => ({
        deviceId: l.deviceId,
        endpointUrl: l.endpointUrl,
        federationToken: await signFederationToken({
          requestId,
          borrowerDeviceId,
          lenderDeviceId: l.deviceId,
          logicalModel,
          jti: newId("jti"),
        }),
      }))
    ),
  };
}

export async function refreshSchedule(userId, { requestId, logicalModel, lenderDeviceId }) {
  const db = getDb();
  const sched = db
    .prepare(`SELECT * FROM federation_schedules WHERE request_id = ?`)
    .get(requestId);
  if (!sched) {
    const err = new Error("Schedule not found");
    err.status = 404;
    throw err;
  }
  const borrower = getDevice(sched.borrower_device_id);
  if (!borrower || borrower.userId !== userId) {
    const err = new Error("Forbidden");
    err.status = 403;
    throw err;
  }
  const lender = getDevice(lenderDeviceId || sched.lender_device_id);
  if (!lender?.endpointUrl) {
    const err = new Error("Lender not available");
    err.status = 503;
    throw err;
  }
  const jti = newId("jti");
  const federationToken = await signFederationToken({
    requestId,
    borrowerDeviceId: sched.borrower_device_id,
    lenderDeviceId: lender.deviceId,
    logicalModel: logicalModel || sched.logical_model,
    jti,
  });
  db.prepare(`UPDATE federation_schedules SET federation_jti = ?, lender_device_id = ? WHERE request_id = ?`).run(
    jti,
    lender.deviceId,
    requestId
  );
  return {
    requestId,
    deviceId: lender.deviceId,
    endpointUrl: lender.endpointUrl,
    federationToken,
  };
}

export function getFallbackRoutes(logicalModel) {
  return findLenders(logicalModel).map((l) => ({
    deviceId: l.deviceId,
    endpointUrl: l.endpointUrl,
  }));
}

export function estimateHoldCharge(logicalModel, inputTokens = 1000, outputTokens = 500) {
  return computeChargeUSD(logicalModel, inputTokens, 0, outputTokens);
}

export function buildUserSummary(userId, thisDeviceId) {
  const user = getUserById(userId);
  const devices = listUserDevices(userId);

  const stats = getDb()
    .prepare(
      `SELECT
        SUM(CASE WHEN settlement_status = 'confirmed' AND borrower_device_id IN (SELECT device_id FROM devices WHERE user_id = ?) THEN charge_usd ELSE 0 END) AS borrowed,
        SUM(CASE WHEN settlement_status = 'confirmed' AND lender_device_id IN (SELECT device_id FROM devices WHERE user_id = ?) THEN charge_usd ELSE 0 END) AS lent
       FROM federation_ledger`
    )
    .get(userId, userId);

  const pending = countPendingReports(userId);
  const breakdown = getUserFederationBreakdown(userId);

  return {
    userId,
    thisDeviceId: thisDeviceId || devices[0]?.deviceId || null,
    creditUSD: user?.credit_usd ?? 0,
    devices,
    lifetimeBorrowedUSD: stats?.borrowed || 0,
    lifetimeLentUSD: stats?.lent || 0,
    ledgerPending: pending.pending,
    ledgerMismatch: pending.mismatch,
    ...breakdown,
  };
}
