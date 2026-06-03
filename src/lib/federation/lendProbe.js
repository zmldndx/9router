import { hubFetch } from "./hubClient.js";
import { buildFederationLendCatalog } from "./lendCatalog.js";
import {
  getFederationSettings,
  getLocalDeviceId,
  resolvePublicEndpointUrl,
} from "./settings.js";

const PROBE_SOURCE = {
  startup: "startup_probe",
  join: "join_probe",
  recovery: "recovery_probe",
  periodic: "periodic_probe",
};

const RETRY_INTERVAL_MS = 30000;
const RETRY_MAX_ATTEMPTS = 24;
const PERIODIC_PROBE_MS = 30 * 60 * 1000;

let probeInFlight = null;
let retryTimer = null;
let lastPeriodicProbeAt = 0;
let lastEndpointUrl = "";

const lastProbeOkByModel = new Map();

async function resolveUpstreamModelId(logicalModel) {
  const cat = await buildFederationLendCatalog();
  for (const p of cat.providers) {
    for (const m of p.models) {
      if (m.logicalModel === logicalModel) return m.fullModel;
    }
  }
  return logicalModel;
}

async function measureStreamTtft(endpointUrl, federationToken, upstreamModel) {
  const base = endpointUrl.replace(/\/$/, "");
  const url = `${base}/v1/chat/completions`;
  const start = Date.now();
  let ttftMs = null;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${federationToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: upstreamModel,
      messages: [{ role: "user", content: "." }],
      max_tokens: 8,
      stream: true,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 240)}`);
  }

  if (!res.body) {
    return { ttftMs: Date.now() - start, ok: true };
  }

  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length && ttftMs == null) ttftMs = Date.now() - start;
  }

  return { ttftMs: ttftMs ?? Date.now() - start, ok: true };
}

async function reportProbeMetric(settings, deviceId, payload) {
  return hubFetch("/v1/metrics/federation", {
    method: "POST",
    settings,
    body: payload,
  });
}

/**
 * 对暴露的借出模型做一次 TTFT 探测（经公网 endpoint + Hub 签发的 federation token）
 */
export async function runLendCapabilityProbe(reason = "startup") {
  if (probeInFlight) return probeInFlight;

  probeInFlight = (async () => {
    const settings = await getFederationSettings();
    if (settings.federationEnabled && settings.hubAccessToken) {
      const deviceId = await getLocalDeviceId();
      const endpointUrl = await resolvePublicEndpointUrl();
      await hubFetch("/v1/devices/heartbeat", {
        method: "POST",
        settings,
        body: { deviceId, endpointUrl: endpointUrl || null },
      }).catch(() => {});
    }

    const settingsAfter = await getFederationSettings();
    if (!settingsAfter.federationEnabled || !settingsAfter.hubUrl || !settingsAfter.hubAccessToken) {
      return { skipped: true, reason: "federation_off" };
    }
    if (!settingsAfter.federationLendEnabled) {
      return { skipped: true, reason: "lend_disabled" };
    }
    const models = settingsAfter.federationExposeModels || [];
    if (!models.length) {
      return { skipped: true, reason: "no_expose_models" };
    }

    const endpointUrl = await resolvePublicEndpointUrl();
    if (!endpointUrl) {
      return { skipped: true, reason: "no_endpoint" };
    }

    const deviceId = await getLocalDeviceId();
    const source = PROBE_SOURCE[reason] || PROBE_SOURCE.startup;

    const issued = await hubFetch(`/v1/devices/${deviceId}/lend-probe`, {
      method: "POST",
      settings: settingsAfter,
      body: { logicalModels: models },
    });

    const probeEndpoint = issued.endpointUrl || endpointUrl;
    const results = [];

    for (const { logicalModel, requestId, federationToken } of issued.tokens || []) {
      const upstreamModel = await resolveUpstreamModelId(logicalModel);
      try {
        const { ttftMs, ok } = await measureStreamTtft(
          probeEndpoint,
          federationToken,
          upstreamModel
        );
        await reportProbeMetric(settingsAfter, deviceId, {
          deviceId,
          logicalModel,
          requestId,
          ttftMs,
          ok,
          source,
        });
        lastProbeOkByModel.set(logicalModel, ok);
        results.push({ logicalModel, ok, ttftMs });
      } catch (e) {
        lastProbeOkByModel.set(logicalModel, false);
        await reportProbeMetric(settingsAfter, deviceId, {
          deviceId,
          logicalModel,
          requestId,
          ok: false,
          source,
        }).catch(() => {});
        results.push({ logicalModel, ok: false, error: e.message });
      }
    }

    return { ok: true, reason, results };
  })().finally(() => {
    probeInFlight = null;
  });

  return probeInFlight;
}

function shouldRetryProbe(result) {
  if (!result?.skipped) return false;
  return result.reason === "no_endpoint" || result.reason === "federation_off";
}

/**
 * 启动/接入后：无 endpoint 时每 30s 重试，最多约 12 分钟；成功后停止
 */
export function scheduleLendProbeWithRetry(initialReason = "startup") {
  if (retryTimer) clearTimeout(retryTimer);
  let attempt = 0;

  const tick = async () => {
    attempt += 1;
    const reason =
      attempt === 1
        ? initialReason
        : attempt <= 3
          ? initialReason
          : "recovery";
    const result = await runLendCapabilityProbe(reason).catch((e) => ({
      skipped: true,
      reason: e.message,
    }));

    if (shouldRetryProbe(result) && attempt < RETRY_MAX_ATTEMPTS) {
      retryTimer = setTimeout(tick, RETRY_INTERVAL_MS);
      return;
    }
    retryTimer = null;
  };

  setTimeout(tick, 5000);
}

/** @deprecated 使用 scheduleLendProbeWithRetry */
export function scheduleStartupLendProbe(delayMs = 8000) {
  scheduleLendProbeWithRetry("startup");
  void delayMs;
}

/** 心跳后：endpoint 刚就绪、周期重探、或上次探测失败 */
export async function afterHeartbeatLendProbe() {
  const settings = await getFederationSettings();
  if (!settings.federationLendEnabled) return { skipped: true };

  const endpointUrl = await resolvePublicEndpointUrl();
  const now = Date.now();
  const endpointJustReady = endpointUrl && !lastEndpointUrl;
  lastEndpointUrl = endpointUrl || "";

  if (!endpointUrl) return { skipped: true, reason: "no_endpoint" };

  if (endpointJustReady) {
    return runLendCapabilityProbe("recovery");
  }

  const failed = (settings.federationExposeModels || []).filter(
    (m) => lastProbeOkByModel.get(m) === false
  );
  if (failed.length) {
    return runLendCapabilityProbe("recovery");
  }

  if (now - lastPeriodicProbeAt >= PERIODIC_PROBE_MS) {
    lastPeriodicProbeAt = now;
    return runLendCapabilityProbe("periodic");
  }

  return { skipped: true };
}

export async function maybeRunRecoveryLendProbe() {
  return afterHeartbeatLendProbe();
}
