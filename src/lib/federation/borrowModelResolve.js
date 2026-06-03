import { getModelInfo, getComboModels } from "@/sse/services/model.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { lookupFederationModelIdentity } from "./lendCatalog.js";
import { hubFetch } from "./hubClient.js";
import {
  getFederationSettings,
  getLocalDeviceId,
  parseFederationModel,
} from "./settings.js";

/**
 * 在本机目录中按「绝对名 → 逻辑名」找第一个可调度的模型 id。
 * 用于把 gemini-3-flash 解析到 ag/gemini-3-flash 等。
 */
export async function pickLocalServicableModel(modelStr) {
  const trimmed = (modelStr || "").trim();
  if (!trimmed || parseFederationModel(trimmed)) return null;

  const identity = await lookupFederationModelIdentity(trimmed);
  for (const key of buildLocalTryOrder(trimmed, identity)) {
    if (await canServeModelLocally(key)) return key;
  }
  return null;
}

/**
 * 解析联邦借入用的逻辑模型名；不借入则返回 null（走本机 handleChat）。
 */
export async function resolveBorrowLogicalModel(modelStr, settings = null) {
  const s = settings || (await getFederationSettings());
  const forced = parseFederationModel(modelStr);
  if (forced) return forced;

  if (!s.federationEnabled || !s.hubUrl || !s.hubAccessToken || !s.federationBorrowEnabled) {
    return null;
  }

  const trimmed = (modelStr || "").trim();
  if (!trimmed) return null;

  if (await pickLocalServicableModel(trimmed)) return null;

  const identity = await lookupFederationModelIdentity(trimmed);
  const borrowLogical =
    identity?.logicalModel ||
    (trimmed.includes("/") ? trimmed.slice(trimmed.indexOf("/") + 1) : trimmed);
  if (!borrowLogical) return null;
  if (await hasRemoteLendersFor(borrowLogical, s)) return borrowLogical;
  return null;
}

/** 本地探测顺序：目录绝对名优先，再原始输入，再逻辑名 */
export function buildLocalTryOrder(trimmed, identity) {
  const order = [];
  const push = (v) => {
    const k = (v || "").trim();
    if (k && !order.includes(k)) order.push(k);
  };

  if (identity?.fullModel) push(identity.fullModel);
  push(trimmed);
  if (identity?.logicalModel && identity.logicalModel !== trimmed) push(identity.logicalModel);
  if (trimmed.includes("/")) {
    const suffix = trimmed.slice(trimmed.indexOf("/") + 1);
    if (suffix !== trimmed && suffix !== identity?.logicalModel) push(suffix);
  }

  return order;
}

export async function canServeModelLocally(modelStr) {
  try {
    const comboModels = await getComboModels(modelStr);
    if (comboModels?.length) return true;

    const info = await getModelInfo(modelStr);
    if (!info?.provider) return false;

    const creds = await getProviderCredentials(info.provider, new Set(), info.model);
    return !!creds;
  } catch {
    return false;
  }
}

async function hasRemoteLendersFor(logicalModel, settings) {
  try {
    const deviceId = await getLocalDeviceId();
    const data = await hubFetch(
      `/v1/federation/fallback-routes?logicalModel=${encodeURIComponent(logicalModel)}`,
      { settings }
    );
    const routes = data.routes || [];
    return routes.some((r) => r.deviceId !== deviceId && r.endpointUrl);
  } catch {
    return false;
  }
}
