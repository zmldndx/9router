import { hubFetch } from "./hubClient.js";
import { afterHeartbeatLendProbe } from "./lendProbe.js";
import {
  getFederationSettings,
  getLocalDeviceId,
  resolvePublicEndpointUrl,
} from "./settings.js";

let intervalId = null;
let probeFollowupBusy = false;
let policiesSynced = false;

export async function sendFederationHeartbeat() {
  const settings = await getFederationSettings();
  if (!settings.federationEnabled || !settings.hubUrl || !settings.hubAccessToken) {
    return { skipped: true };
  }
  const deviceId = await getLocalDeviceId();
  const endpointUrl = await resolvePublicEndpointUrl();
  const result = await hubFetch("/v1/devices/heartbeat", {
    method: "POST",
    settings,
    body: {
      deviceId,
      deviceLabel: "9router",
      endpointUrl: endpointUrl || null,
    },
  });

  if (!policiesSynced) {
    try {
      const { syncHubPoliciesFromLocal } = await import("./reconnect.js");
      await syncHubPoliciesFromLocal(settings);
      policiesSynced = true;
      console.log(`[Federation] hub lend/borrow policy synced device=${deviceId.slice(0, 8)}…`);
    } catch (e) {
      console.warn(`[Federation] hub policy sync failed: ${e.message}`);
    }
  }

  if (endpointUrl) {
    console.log(`[Federation] heartbeat ok device=${deviceId.slice(0, 8)}… endpoint=${endpointUrl}`);
  }
  if (settings.federationLendEnabled && !probeFollowupBusy) {
    probeFollowupBusy = true;
    afterHeartbeatLendProbe()
      .catch(() => {})
      .finally(() => {
        probeFollowupBusy = false;
      });
  }
  return result;
}

export function startFederationHeartbeat(intervalMs = 60000) {
  if (intervalId) return;
  const tick = () =>
    sendFederationHeartbeat().catch((e) => {
      console.warn(`[Federation] heartbeat failed: ${e.message}`);
    });
  tick();
  intervalId = setInterval(tick, intervalMs);
}

/** Tailscale/Tunnel 连接成功后立即同步 Hub（避免仅依赖 60s 心跳） */
export async function syncFederationEndpointToHub() {
  return sendFederationHeartbeat();
}

export function stopFederationHeartbeat() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}
