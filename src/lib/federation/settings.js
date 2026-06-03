import { getSettings, updateSettings } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const FEDERATION_MODEL_PREFIX = "federation:";

const FEDERATION_DEFAULTS = {
  federationEnabled: false,
  hubUrl: "",
  hubAccessToken: "",
  federationUserId: "",
  federationHubEmail: "",
  federationBorrowEnabled: true,
  federationLendEnabled: false,
  federationExposeModels: [],
  federationExposeProviderIds: [],
};

export async function getFederationSettings() {
  const s = await getSettings();
  return {
    ...FEDERATION_DEFAULTS,
    federationEnabled: !!s.federationEnabled,
    hubUrl: s.hubUrl || "",
    hubAccessToken: s.hubAccessToken || "",
    federationUserId: s.federationUserId || "",
    federationHubEmail: s.federationHubEmail || "",
    federationBorrowEnabled: s.federationBorrowEnabled !== false,
    federationLendEnabled: !!s.federationLendEnabled,
    federationExposeModels: Array.isArray(s.federationExposeModels)
      ? s.federationExposeModels
      : [],
    federationExposeProviderIds: Array.isArray(s.federationExposeProviderIds)
      ? s.federationExposeProviderIds
      : [],
  };
}

export async function updateFederationSettings(patch) {
  return updateSettings(patch);
}

export async function getLocalDeviceId() {
  return getConsistentMachineId();
}

export function parseFederationModel(modelStr) {
  if (!modelStr || typeof modelStr !== "string") return null;
  if (!modelStr.startsWith(FEDERATION_MODEL_PREFIX)) return null;
  const logicalModel = modelStr.slice(FEDERATION_MODEL_PREFIX.length).trim();
  return logicalModel || null;
}

export async function resolvePublicEndpointUrl() {
  const s = await getSettings();
  if (s.tailscaleEnabled && s.tailscaleUrl?.trim()) {
    return s.tailscaleUrl.trim().replace(/\/$/, "");
  }
  if (s.tunnelEnabled) {
    try {
      const { loadState } = await import("@/lib/tunnel/shared/state.js");
      const st = loadState();
      if (st?.shortId) {
        return `https://r${st.shortId}.abc-tunnel.us`;
      }
    } catch {
      /* ignore */
    }
    if (s.tunnelUrl?.trim()) {
      return s.tunnelUrl.trim().replace(/\/$/, "");
    }
  }
  return (s.tailscaleUrl || s.tunnelUrl || "").trim().replace(/\/$/, "");
}
