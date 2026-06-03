import { handleChat } from "@/sse/handlers/chat.js";
import { maybeHandleFederationChat } from "@/lib/federation/chatBridge.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request) {
  await ensureInitialized();

  const federationResponse = await maybeHandleFederationChat(request);
  if (federationResponse) return federationResponse;

  return await handleChat(request);
}

