import { getFederationSettings, getLocalDeviceId } from "./settings.js";
import { HubError } from "./hubError.js";
import { ensureHubConnection, shouldAutoReconnectHub } from "./reconnect.js";

export { HubError } from "./hubError.js";

export async function hubFetch(
  path,
  { method = "GET", body, settings: injected, _retried, _skipReconnect } = {}
) {
  const settings = injected || (await getFederationSettings());
  const base = (settings.hubUrl || "").replace(/\/$/, "");
  if (!base) throw new HubError("hubUrl not configured", 400);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.hubAccessToken}`,
  };
  const deviceId = await getLocalDeviceId();
  if (deviceId) headers["X-Device-Id"] = deviceId;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const err = new HubError(data?.error || res.statusText, res.status, data);
    if (!_retried && !_skipReconnect && shouldAutoReconnectHub(err)) {
      await ensureHubConnection(`hubFetch ${method} ${path}`);
      const fresh = await getFederationSettings();
      return hubFetch(path, {
        method,
        body,
        settings: fresh,
        _retried: true,
        _skipReconnect,
      });
    }
    throw err;
  }
  return data;
}
