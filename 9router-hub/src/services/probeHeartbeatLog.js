import fs from "node:fs";
import path from "node:path";
import { HUB_DATA_DIR } from "../config.js";
import { getDb } from "../db/index.js";

/** 固定：$HUB_DATA_DIR/log/heartbeat/heartbeat-YYYY-MM-DD.log */
const LOG_SUBDIR = path.join("log", "heartbeat");
const FILE_PREFIX = "heartbeat";

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function ensureLogDir() {
  const dir = path.join(HUB_DATA_DIR, LOG_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getProbeHeartbeatLogPaths(day = dayKey()) {
  const dir = path.join(HUB_DATA_DIR, LOG_SUBDIR);
  return {
    dir,
    day,
    file: path.join(dir, `${FILE_PREFIX}-${day}.log`),
  };
}

export function resolveDeviceUser(deviceId) {
  if (!deviceId) return null;
  const row = getDb()
    .prepare(
      `SELECT d.device_id, d.user_id, u.email
       FROM devices d JOIN users u ON u.id = d.user_id
       WHERE d.device_id = ?`
    )
    .get(deviceId);
  if (!row) return { userId: null, email: null, deviceId };
  return { userId: row.user_id, email: row.email, deviceId: row.device_id };
}

/**
 * 借出探活结果（边缘 POST /v1/metrics/federation，source=*_probe）
 */
export function appendProbeHeartbeatLog({
  deviceId,
  logicalModel,
  requestId,
  source,
  ok,
  ttftMs,
  tps,
}) {
  const user = resolveDeviceUser(deviceId);
  const at = new Date().toISOString();
  const line = JSON.stringify({
    at,
    userId: user?.userId ?? null,
    email: user?.email ?? null,
    deviceId: deviceId || null,
    logicalModel: logicalModel || null,
    requestId: requestId || null,
    source: source || null,
    ok: !!ok,
    ttftMs: ttftMs ?? null,
    tps: tps ?? null,
  });
  try {
    const { file } = getProbeHeartbeatLogPaths();
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    /* best effort */
  }
  const email = user?.email || "?";
  const shortDevice = (deviceId || "?").slice(0, 8);
  const shortReq = (requestId || "?").slice(0, 12);
  console.log(
    `[hub][probe] ${email} device=${shortDevice}… model=${logicalModel} source=${source} ok=${!!ok} ttftMs=${ttftMs ?? "—"} req=${shortReq}…`
  );
}
