import { handleChat } from "@/sse/handlers/chat.js";
import { resolveUpstreamModelForLogical } from "./lendCatalog.js";
import { getFederationSettings } from "./settings.js";
import { resolveBorrowLogicalModel } from "./borrowModelResolve.js";
import { verifyIncomingFederationToken } from "./federationToken.js";
import { executeFederationBorrow } from "./borrow.js";
import { reportLenderLedger } from "./ledgerReporter.js";

async function wrapLendResponse(response, lendCtx, upstreamModel) {
  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    try {
      const clone = response.clone();
      const data = await clone.json();
      const usage = data?.usage;
      const model = upstreamModel || data?.model;
      reportLenderLedger(lendCtx, usage, usage ? "success" : "failed", model).catch(() => {});
    } catch {
      reportLenderLedger(lendCtx, null, "failed", upstreamModel).catch(() => {});
    }
    return response;
  }

  const [client, tap] = response.body.tee();
  (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    let usage = null;
    try {
      const reader = tap.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload);
            if (chunk.usage) usage = chunk.usage;
          } catch {
            /* ignore */
          }
        }
      }
      reportLenderLedger(lendCtx, usage, usage ? "success" : "failed", upstreamModel).catch(() => {});
    } catch {
      reportLenderLedger(lendCtx, null, "failed", upstreamModel).catch(() => {});
    }
  })();

  return new Response(client, { status: response.status, headers: response.headers });
}

/**
 * Federation entry: lend (incoming federation token) or borrow (逻辑模型 / federation:模型).
 * Returns Response if handled, null to fall through to normal chat.
 */
export async function maybeHandleFederationChat(request) {
  const auth = request.headers.get("authorization") || "";
  const lendCtx = await verifyIncomingFederationToken(auth);
  if (lendCtx?.error) {
    return new Response(JSON.stringify({ error: { message: lendCtx.error } }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (lendCtx) {
    const upstreamModel = await resolveUpstreamModelForLogical(lendCtx.logicalModel);
    let lendRequest = request;
    try {
      const body = await request.json();
      lendRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify({ ...body, model: upstreamModel }),
      });
    } catch {
      /* use original request */
    }
    const response = await handleChat(lendRequest);
    if (response instanceof Response) {
      return wrapLendResponse(response, lendCtx, upstreamModel);
    }
    return response;
  }

  let modelStr = null;
  try {
    const body = await request.clone().json();
    modelStr = body?.model;
  } catch {
    return null;
  }

  const settings = await getFederationSettings();
  const logicalModel = await resolveBorrowLogicalModel(modelStr, settings);
  if (!logicalModel) return null;
  if (!settings.federationEnabled || !settings.hubUrl || !settings.hubAccessToken) {
    return new Response(
      JSON.stringify({ error: { message: "Federation not configured on this node" } }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!settings.federationBorrowEnabled) {
    return new Response(
      JSON.stringify({ error: { message: "Federation borrow disabled" } }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return executeFederationBorrow(request, logicalModel, settings);
}
