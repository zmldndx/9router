import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";

/** 与 Providers 页 ConnectionRow / getProviderStats 一致 */
export function getEffectiveConnectionStatus(conn) {
  const isCooldown = Object.entries(conn || {}).some(
    ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now()
  );
  return conn?.testStatus === "unavailable" && !isCooldown ? "active" : conn?.testStatus;
}

export function isConnectionUsable(conn) {
  if (!conn || conn.isActive === false) return false;
  const status = getEffectiveConnectionStatus(conn);
  return status === "active" || status === "success";
}

/** 与 buildModelsList 中 outputAlias 一致 */
export function getConnectionOutputAlias(conn) {
  const providerId = conn.provider;
  const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return (
    conn?.providerSpecificData?.prefix || getProviderAlias(providerId) || staticAlias
  ).trim();
}

export function summarizeConnectionsForAlias(connections, outputAlias) {
  const relevant = connections.filter(
    (c) => getConnectionOutputAlias(c) === outputAlias
  );
  let usable = 0;
  let error = 0;
  let inactive = 0;
  for (const c of relevant) {
    if (c.isActive === false) {
      inactive += 1;
      continue;
    }
    const status = getEffectiveConnectionStatus(c);
    if (status === "active" || status === "success") usable += 1;
    else if (status === "error" || status === "expired" || status === "unavailable") error += 1;
  }
  return {
    total: relevant.length,
    usable,
    error,
    inactive,
    hasUsable: usable > 0,
    allInactive: relevant.length > 0 && relevant.every((c) => c.isActive === false),
  };
}
