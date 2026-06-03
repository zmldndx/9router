import { getDb } from "../db/index.js";
import { nowIso } from "../utils/ids.js";
import { deviceCanLend, isDeviceOnline } from "./devices.js";
import { getModelPricing } from "./pricing.js";
import { getSlaCapability } from "./sla.js";

function parseJsonArray(raw) {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
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

function formatDeviceRow(row, usersById) {
  const expose = parseJsonArray(row.expose_models);
  const lendAllowed = parseJsonObject(row.lend_allowed);
  const device = {
    deviceId: row.device_id,
    userId: row.user_id,
    deviceLabel: row.device_label,
    endpointUrl: row.endpoint_url,
    lendEnabled: !!row.lend_enabled,
    exposeModels: expose,
    lendAllowed,
    lastSeenAt: row.last_seen_at,
    online: isDeviceOnline(row.last_seen_at),
  };
  const user = usersById.get(row.user_id);
  return { device, user };
}

function lendStatusReason(device, canLendNow) {
  if (!device.lendEnabled) return { key: "lend_off", label: "未开启借出" };
  if (!device.online) return { key: "offline", label: "离线（超时未心跳）" };
  if (!device.endpointUrl) return { key: "no_endpoint", label: "无公网 Endpoint" };
  if (!canLendNow) return { key: "sla_blocked", label: "SLA 暂不可调度" };
  return { key: "ready", label: "可调度" };
}

function pickDisplayTtft(cap) {
  if (cap.probe?.ttftMs != null) return { ttftMs: cap.probe.ttftMs, from: "probe", at: cap.probe.at, ok: cap.probe.ok };
  if (cap.liveTtftMs != null) return { ttftMs: cap.liveTtftMs, from: "live", at: null, ok: true };
  if (cap.probeTtftP50Ms != null) return { ttftMs: cap.probeTtftP50Ms, from: "probe_p50", at: cap.probe?.at, ok: cap.probe?.ok };
  if (cap.liveTtftP50Ms != null) return { ttftMs: cap.liveTtftP50Ms, from: "live_p50", at: null, ok: true };
  return null;
}

export function getMarketplaceCatalog() {
  const db = getDb();
  const generatedAt = nowIso();

  const users = db.prepare(`SELECT id, email, credit_usd FROM users`).all();
  const usersById = new Map(users.map((u) => [u.id, u]));

  const deviceRows = db.prepare(`SELECT * FROM devices WHERE lend_enabled = 1`).all();

  const modelMap = new Map();

  for (const row of deviceRows) {
    const { device, user } = formatDeviceRow(row, usersById);
    for (const logicalModel of device.exposeModels) {
      if (device.lendAllowed[logicalModel] === false) continue;

      const canLendNow = deviceCanLend(device, logicalModel);
      const status = lendStatusReason(device, canLendNow);
      const cap = getSlaCapability(device.deviceId, logicalModel);
      const ttft = pickDisplayTtft(cap);

      const lender = {
        deviceId: device.deviceId,
        deviceLabel: device.deviceLabel,
        userId: device.userId,
        email: user?.email || device.userId,
        online: device.online,
        endpointUrl: device.endpointUrl,
        canLendNow,
        statusKey: status.key,
        statusLabel: status.label,
        lendAllowed: cap.lendAllowed,
        liveFailRate: cap.liveFailRate,
        liveSamples: cap.liveSamples,
        ttftMs: ttft?.ttftMs ?? null,
        ttftSource: ttft?.from ?? null,
        ttftAt: ttft?.at ?? null,
        ttftOk: ttft?.ok ?? null,
        probe: cap.probe,
        liveTtftP50Ms: cap.liveTtftP50Ms,
        probeTtftP50Ms: cap.probeTtftP50Ms,
      };

      if (!modelMap.has(logicalModel)) {
        const pricing = getModelPricing(logicalModel);
        modelMap.set(logicalModel, {
          logicalModel,
          lenderCount: 0,
          onlineLenderCount: 0,
          schedulableLenderCount: 0,
          pricing: pricing
            ? {
                priceInputPer1k: pricing.price_input_per_1k,
                priceOutputPer1k: pricing.price_output_per_1k,
                requestFeeUsd: pricing.request_fee_usd,
              }
            : null,
          lenders: [],
        });
      }

      const entry = modelMap.get(logicalModel);
      entry.lenderCount += 1;
      if (device.online) entry.onlineLenderCount += 1;
      if (canLendNow) entry.schedulableLenderCount += 1;
      entry.lenders.push(lender);
    }
  }

  const models = [...modelMap.values()]
    .map((m) => {
      m.lenders.sort((a, b) => {
        if (a.canLendNow !== b.canLendNow) return a.canLendNow ? -1 : 1;
        const ta = a.ttftMs ?? 1e9;
        const tb = b.ttftMs ?? 1e9;
        if (ta !== tb) return ta - tb;
        return (a.email || "").localeCompare(b.email || "", "zh-CN");
      });
      const ttfts = m.lenders.map((l) => l.ttftMs).filter((n) => n != null);
      const sorted = [...ttfts].sort((a, b) => a - b);
      m.medianTtftMs =
        sorted.length === 0
          ? null
          : sorted.length % 2
            ? sorted[Math.floor(sorted.length / 2)]
            : Math.round(
                (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
              );
      return m;
    })
    .sort((a, b) => {
      if (b.schedulableLenderCount !== a.schedulableLenderCount) {
        return b.schedulableLenderCount - a.schedulableLenderCount;
      }
      return a.logicalModel.localeCompare(b.logicalModel, "zh-CN");
    });

  return {
    generatedAt,
    summary: {
      modelCount: models.length,
      lenderDeviceCount: deviceRows.length,
      schedulableOffers: models.reduce((s, m) => s + m.schedulableLenderCount, 0),
    },
    models,
  };
}
