import { getDb } from "../db/index.js";
import { HEARTBEAT_ONLINE_MS } from "../config.js";
import { nowIso } from "../utils/ids.js";
import { ensurePricingForModels } from "./pricing.js";

function parseJsonArray(raw, fallback = []) {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonObject(raw) {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** 本机 device 是否已绑定 Hub 用户（供 join 前校验，一机一账号） */
export function getDeviceBindStatus(deviceId) {
  if (!deviceId) return { bound: false };
  const row = getDb()
    .prepare(
      `SELECT d.device_id, d.user_id, u.email
       FROM devices d JOIN users u ON u.id = d.user_id
       WHERE d.device_id = ?`
    )
    .get(deviceId);
  if (!row) return { bound: false, deviceId };
  return {
    bound: true,
    deviceId: row.device_id,
    userId: row.user_id,
    email: row.email,
  };
}

export function registerDevice(userId, { deviceId, deviceLabel, endpointUrl }) {
  const db = getDb();
  const now = nowIso();
  const existing = db.prepare(`SELECT * FROM devices WHERE device_id = ?`).get(deviceId);
  if (existing) {
    if (existing.user_id !== userId) {
      const err = new Error("deviceId already bound to another user");
      err.status = 409;
      throw err;
    }
    db.prepare(
      `UPDATE devices SET device_label = COALESCE(?, device_label),
        endpoint_url = COALESCE(?, endpoint_url), last_seen_at = ? WHERE device_id = ?`
    ).run(deviceLabel ?? null, endpointUrl ?? null, now, deviceId);
    return getDevice(deviceId);
  }
  db.prepare(
    `INSERT INTO devices(device_id, user_id, device_label, endpoint_url, lend_enabled, borrow_enabled,
      expose_models, lend_allowed, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, 0, 1, '[]', '{}', ?, ?)`
  ).run(deviceId, userId, deviceLabel ?? null, endpointUrl ?? null, now, now);
  return getDevice(deviceId);
}

export function heartbeatDevice(userId, { deviceId, endpointUrl, deviceLabel }) {
  const existing = getDevice(deviceId);
  if (!existing) {
    return registerDevice(userId, {
      deviceId,
      deviceLabel: deviceLabel || "9router",
      endpointUrl: endpointUrl ?? null,
    });
  }
  if (existing.userId !== userId) {
    const err = new Error("deviceId already bound to another user");
    err.status = 409;
    throw err;
  }
  const now = nowIso();
  const endpointProvided = endpointUrl !== undefined && endpointUrl !== null;
  if (endpointProvided) {
    getDb()
      .prepare(
        `UPDATE devices SET last_seen_at = ?, endpoint_url = ? WHERE device_id = ?`
      )
      .run(now, String(endpointUrl).trim() || null, deviceId);
  } else {
    getDb()
      .prepare(`UPDATE devices SET last_seen_at = ? WHERE device_id = ?`)
      .run(now, deviceId);
  }
  return getDevice(deviceId);
}

export function updateLendPolicy(userId, deviceId, policy) {
  assertDeviceOwner(userId, deviceId);
  const exposeList = policy.exposeModels || [];
  ensurePricingForModels(exposeList);
  const expose = JSON.stringify(exposeList);
  const lendAllowed = JSON.stringify(policy.lendAllowed || {});
  getDb()
    .prepare(
      `UPDATE devices SET lend_enabled = ?, expose_models = ?, lend_allowed = ? WHERE device_id = ?`
    )
    .run(policy.lendEnabled ? 1 : 0, expose, lendAllowed, deviceId);
  return getDevice(deviceId);
}

export function updateBorrowPolicy(userId, deviceId, policy) {
  assertDeviceOwner(userId, deviceId);
  getDb()
    .prepare(`UPDATE devices SET borrow_enabled = ? WHERE device_id = ?`)
    .run(policy.borrowEnabled ? 1 : 0, deviceId);
  return getDevice(deviceId);
}

export function listUserDevices(userId) {
  return getDb()
    .prepare(`SELECT * FROM devices WHERE user_id = ? ORDER BY created_at ASC`)
    .all(userId)
    .map(formatDevice);
}

export function getDevice(deviceId) {
  const row = getDb().prepare(`SELECT * FROM devices WHERE device_id = ?`).get(deviceId);
  return row ? formatDevice(row) : null;
}

export function assertDeviceOwner(userId, deviceId) {
  const device = getDevice(deviceId);
  if (!device || device.userId !== userId) {
    const err = new Error("Device not found");
    err.status = 404;
    throw err;
  }
  return device;
}

function formatDevice(row) {
  return {
    deviceId: row.device_id,
    userId: row.user_id,
    deviceLabel: row.device_label,
    endpointUrl: row.endpoint_url,
    lendEnabled: !!row.lend_enabled,
    borrowEnabled: !!row.borrow_enabled,
    exposeModels: parseJsonArray(row.expose_models),
    lendAllowed: parseJsonObject(row.lend_allowed),
    lastSeenAt: row.last_seen_at,
    online: isDeviceOnline(row.last_seen_at),
  };
}

export function isDeviceOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() <= HEARTBEAT_ONLINE_MS;
}

export function deviceCanLend(device, logicalModel) {
  if (!device.lendEnabled || !device.online || !device.endpointUrl) return false;
  if (!device.exposeModels.includes(logicalModel)) return false;
  const allowed = device.lendAllowed[logicalModel];
  return allowed !== false;
}
