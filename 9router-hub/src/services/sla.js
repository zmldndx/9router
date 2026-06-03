import { getDb } from "../db/index.js";
import { newId, nowIso } from "../utils/ids.js";

const FAIL_THRESHOLD = 0.35;
const MIN_SAMPLES = 10;

export const PROBE_SOURCES = new Set([
  "startup_probe",
  "join_probe",
  "recovery_probe",
  "periodic_probe",
]);

function isProbeSource(source) {
  return PROBE_SOURCES.has(source);
}

function median(nums) {
  const arr = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}

export function recordSlaSample({ deviceId, logicalModel, requestId, ttftMs, tps, ok, source }) {
  const src = source || "live";
  const db = getDb();
  db.prepare(
    `INSERT INTO federation_sla_samples(id, device_id, logical_model, request_id, ttft_ms, tps, ok, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId("sla"),
    deviceId,
    logicalModel,
    requestId || null,
    ttftMs ?? null,
    tps ?? null,
    ok ? 1 : 0,
    src,
    nowIso()
  );

  if (isProbeSource(src)) {
    return { recorded: true, lendAllowed: true, probe: true };
  }

  const recent = db
    .prepare(
      `SELECT ok FROM federation_sla_samples
       WHERE device_id = ? AND logical_model = ? AND source = 'live'
       ORDER BY created_at DESC LIMIT 30`
    )
    .all(deviceId, logicalModel);

  if (recent.length < MIN_SAMPLES) return { recorded: true, lendAllowed: true };

  const failRate = recent.filter((r) => !r.ok).length / recent.length;
  const lendAllowed = failRate < FAIL_THRESHOLD;
  const device = db.prepare(`SELECT lend_allowed FROM devices WHERE device_id = ?`).get(deviceId);
  if (device) {
    const map = JSON.parse(device.lend_allowed || "{}");
    map[logicalModel] = lendAllowed;
    db.prepare(`UPDATE devices SET lend_allowed = ? WHERE device_id = ?`).run(
      JSON.stringify(map),
      deviceId
    );
  }
  return { recorded: true, lendAllowed, failRate: Math.round(failRate * 1000) / 1000 };
}

export function getSlaCapability(deviceId, logicalModel) {
  const db = getDb();
  const probeRows = db
    .prepare(
      `SELECT ok, ttft_ms, tps, source, created_at FROM federation_sla_samples
       WHERE device_id = ? AND logical_model = ? AND source IN ('startup_probe','join_probe','recovery_probe','periodic_probe')
       ORDER BY created_at DESC LIMIT 5`
    )
    .all(deviceId, logicalModel);

  const liveRows = db
    .prepare(
      `SELECT ok, ttft_ms, tps, created_at FROM federation_sla_samples
       WHERE device_id = ? AND logical_model = ? AND source = 'live'
       ORDER BY created_at DESC LIMIT 30`
    )
    .all(deviceId, logicalModel);

  const liveTtfts = liveRows.map((r) => r.ttft_ms).filter((n) => n != null);
  const probeTtfts = probeRows.map((r) => r.ttft_ms).filter((n) => n != null);
  const latestProbe = probeRows[0] || null;
  const latestLive = liveRows[0] || null;

  const failRate = liveRows.length
    ? liveRows.filter((r) => !r.ok).length / liveRows.length
    : 0;

  const device = db.prepare(`SELECT lend_allowed FROM devices WHERE device_id = ?`).get(deviceId);
  const map = device ? JSON.parse(device.lend_allowed || "{}") : {};

  return {
    deviceId,
    logicalModel,
    lendAllowed: map[logicalModel] !== false,
    liveSamples: liveRows.length,
    liveFailRate: Math.round(failRate * 1000) / 1000,
    liveTtftMs: latestLive?.ttft_ms ?? null,
    liveTtftP50Ms: median(liveTtfts),
    probe: latestProbe
      ? {
          ok: !!latestProbe.ok,
          ttftMs: latestProbe.ttft_ms,
          tps: latestProbe.tps,
          source: latestProbe.source,
          at: latestProbe.created_at,
        }
      : null,
    probeTtftP50Ms: median(probeTtfts),
  };
}

export function getDeviceSla(deviceId, logicalModel) {
  const cap = getSlaCapability(deviceId, logicalModel);
  return {
    deviceId: cap.deviceId,
    logicalModel: cap.logicalModel,
    samples: cap.liveSamples,
    failRate: cap.liveFailRate,
    lendAllowed: cap.lendAllowed,
    capability: cap,
  };
}
