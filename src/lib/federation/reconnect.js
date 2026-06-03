import { HubError } from "./hubError.js";
import { hubFetch } from "./hubClient.js";
import { loadHubCredentials } from "./credentials.js";
import {
  getFederationSettings,
  getLocalDeviceId,
} from "./settings.js";
import { connectToHub } from "./hubJoin.js";

let reconnectPromise = null;

export function shouldAutoReconnectHub(err) {
  if (!(err instanceof HubError)) return false;
  if (err.status === 401) return true;
  if (err.status === 404 && /device not found/i.test(err.message || "")) return true;
  return false;
}

/** 将本地借入/借出策略推回 Hub（重连后 device 可能是新记录） */
export async function syncHubPoliciesFromLocal(settings = null) {
  const s = settings || (await getFederationSettings());
  if (!s.hubAccessToken || !s.hubUrl || !s.federationEnabled) return;

  const deviceId = await getLocalDeviceId();
  const hubOn = s.federationEnabled;
  await hubFetch(`/v1/devices/${deviceId}/lend-policy`, {
    method: "PUT",
    settings: s,
    body: {
      lendEnabled: hubOn && s.federationLendEnabled,
      exposeModels: s.federationExposeModels || [],
      lendAllowed: {},
    },
    _skipReconnect: true,
  });
  await hubFetch(`/v1/devices/${deviceId}/borrow-policy`, {
    method: "PUT",
    settings: s,
    body: {
      borrowEnabled: hubOn && s.federationBorrowEnabled,
    },
    _skipReconnect: true,
  });

  if (s.federationLendEnabled && s.federationExposeModels?.length) {
    const { scheduleLendProbeWithRetry } = await import("./lendProbe.js");
    scheduleLendProbeWithRetry("recovery");
  }
}

/**
 * Hub 用户/device 失效时，用已保存的邮箱密码自动重新登录并注册。
 * 并发调用会合并为同一次重连。
 */
export async function ensureHubConnection(reason = "recovery") {
  if (reconnectPromise) return reconnectPromise;

  reconnectPromise = (async () => {
    const settings = await getFederationSettings();
    const creds = await loadHubCredentials();
    if (!settings.hubUrl || !creds) {
      throw new HubError(
        "Hub 会话已失效且无本地凭证，请在联邦页重新连接",
        401
      );
    }

    console.log(`[Federation] auto-reconnect to Hub (${reason}) email=${creds.email}`);
    const result = await connectToHub({
      hubUrl: settings.hubUrl,
      email: creds.email,
      password: creds.password,
      saveCredentials: false,
      scheduleProbe: false,
    });

    await syncHubPoliciesFromLocal(result.settings);
    console.log(`[Federation] auto-reconnect ok device=${result.deviceId.slice(0, 8)}…`);
    return result;
  })();

  try {
    return await reconnectPromise;
  } finally {
    reconnectPromise = null;
  }
}
