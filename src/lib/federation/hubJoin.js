import {
  getFederationSettings,
  getLocalDeviceId,
  resolvePublicEndpointUrl,
  updateFederationSettings,
} from "./settings.js";
import { saveHubCredentials } from "./credentials.js";
import { HubError } from "./hubError.js";

export async function fetchDeviceBindStatus(hubBase, deviceId) {
  const res = await fetch(
    `${hubBase}/v1/devices/bind-status?deviceId=${encodeURIComponent(deviceId)}`,
    { headers: { Accept: "application/json" } }
  );
  const data = await res.json();
  if (!res.ok) throw new HubError(data.error || res.statusText, res.status, data);
  return data;
}

async function hubAuthRequest(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export async function authenticateWithHub(base, { email, password, deviceId }) {
  const bind = await fetchDeviceBindStatus(base, deviceId);
  const normalizedEmail = email.trim().toLowerCase();

  const tok = await hubAuthRequest(base, "/v1/auth/token", {
    email: normalizedEmail,
    password,
  });

  let auth;
  if (tok.ok) {
    auth = tok.data;
  } else if (bind.bound) {
    const err = new HubError(
      `本机 device 已绑定账号 ${bind.email}，请使用该邮箱登录（一机一账号）`,
      409
    );
    throw err;
  } else {
    const reg = await hubAuthRequest(base, "/v1/auth/register", {
      email: normalizedEmail,
      password,
      identityKey: normalizedEmail,
    });
    if (!reg.ok) {
      throw new HubError(reg.data.error || "Auth failed", reg.status, reg.data);
    }
    auth = reg.data;
  }

  if (bind.bound && auth.userId !== bind.userId) {
    throw new HubError(
      `本机 device 已绑定 ${bind.email}，与当前登录账号不一致（一机一账号）`,
      409
    );
  }

  return { auth, bind };
}

async function registerDeviceOnHub(settings, { deviceId, deviceLabel, endpointUrl }) {
  const base = settings.hubUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/v1/devices/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.hubAccessToken}`,
    },
    body: JSON.stringify({
      deviceId,
      deviceLabel: deviceLabel || "9router",
      endpointUrl: endpointUrl || undefined,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new HubError(data.error || res.statusText, res.status, data);
  }
  return data;
}

/**
 * 登录/注册 Hub、写入本地 token、注册 device。
 * 供联邦页 join 与后台自动重连共用。
 */
export async function connectToHub({
  hubUrl,
  email,
  password,
  deviceLabel = "9router",
  saveCredentials = true,
  scheduleProbe = true,
}) {
  const base = hubUrl.replace(/\/$/, "");
  const deviceId = await getLocalDeviceId();
  const { auth } = await authenticateWithHub(base, { email, password, deviceId });

  await updateFederationSettings({
    federationEnabled: true,
    hubUrl: base,
    hubAccessToken: auth.accessToken,
    federationUserId: auth.userId,
    federationHubEmail: email.trim().toLowerCase(),
  });

  if (saveCredentials) {
    await saveHubCredentials({ email, password });
  }

  const settings = await getFederationSettings();
  const endpointUrl = await resolvePublicEndpointUrl();
  const registered = await registerDeviceOnHub(settings, {
    deviceId,
    deviceLabel,
    endpointUrl,
  });

  if (scheduleProbe) {
    const { scheduleLendProbeWithRetry } = await import("./lendProbe.js");
    scheduleLendProbeWithRetry("join");
  }

  return {
    auth,
    deviceId,
    device: registered.device,
    settings: await getFederationSettings(),
    endpointUrl: endpointUrl || null,
  };
}
