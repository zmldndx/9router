import { resolvePublicEndpointUrl } from "./settings.js";
import { syncFederationEndpointToHub } from "./heartbeat.js";
import { resolveServicePort } from "@/lib/baseUrl.mjs";

/**
 * Ensure Cloudflare tunnel is up for federation Hub communication.
 * Uses stable public URL: https://r{shortId}.abc-tunnel.us (shortId persisted in ~/.9router/tunnel/state.json).
 */
export async function ensureFederationTunnel(localPort) {
  const port = localPort || resolveServicePort();
  let endpointUrl = await resolvePublicEndpointUrl();
  if (endpointUrl) {
    return { endpointUrl, alreadyRunning: true };
  }

  const { enableTunnel } = await import("@/lib/tunnel/cloudflare/manager.js");
  const result = await enableTunnel(port);
  endpointUrl =
    result.publicUrl ||
    (result.shortId ? `https://r${result.shortId}.abc-tunnel.us` : "") ||
    (await resolvePublicEndpointUrl());

  if (!endpointUrl) {
    throw new Error("Tunnel enabled but public URL unavailable");
  }

  await syncFederationEndpointToHub().catch((e) => {
    console.warn(`[Federation] hub sync after tunnel: ${e.message}`);
  });

  return { endpointUrl, alreadyRunning: !!result.alreadyRunning };
}
