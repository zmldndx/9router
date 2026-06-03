import { federationSchedule } from "./schedule.js";
import { hubFetch } from "./hubClient.js";
import { reportBorrowerLedger } from "./ledgerReporter.js";
import { saveRequestUsage } from "@/lib/usageDb.js";
import { fedDiag, fetchErrorDetail, maskEndpoint } from "./federationLog.js";

function extractUsageFromOpenAIJson(data) {
  return data?.usage || null;
}

async function readNonStreamResponse(res) {
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return { text, data: null, usage: null };
  }
  return { text, data, usage: extractUsageFromOpenAIJson(data) };
}

async function collectStreamUsage(reader) {
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;
  const start = Date.now();
  let ttftMs = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length && ttftMs == null) ttftMs = Date.now() - start;
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
        /* ignore partial */
      }
    }
  }
  return { usage, ttftMs };
}

function reportLenderLiveSla(settings, schedule, logicalModel, lenderDeviceId, ttftMs, ok) {
  if (!lenderDeviceId) return;
  hubFetch("/v1/metrics/federation", {
    method: "POST",
    settings,
    body: {
      deviceId: lenderDeviceId,
      logicalModel,
      requestId: schedule.requestId,
      ttftMs: ttftMs ?? null,
      ok,
      source: "live",
    },
  }).catch(() => {});
}

async function callLender(endpointUrl, federationToken, logicalModel, body) {
  const url = `${endpointUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${federationToken}`,
  };
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, model: logicalModel }),
    });
  } catch (e) {
    fedDiag("call", `lender fetch error host=${maskEndpoint(endpointUrl)} (TLS/DNS/离线?)`, {
      logicalModel,
      url,
      ms: Date.now() - t0,
      ...fetchErrorDetail(e),
    });
    throw e;
  }
  fedDiag("call", `lender response host=${maskEndpoint(endpointUrl)}`, {
    logicalModel,
    status: res.status,
    ms: Date.now() - t0,
    contentType: res.headers.get("content-type") || "",
  });
  return res;
}

export async function executeFederationBorrow(request, logicalModel, settings) {
  const body = await request.clone().json();
  let schedule;
  try {
    schedule = await federationSchedule(logicalModel, settings);
    fedDiag("schedule", "Hub schedule ok", {
      requestId: schedule.requestId?.slice(0, 12),
      logicalModel,
      primaryLender: schedule.primary?.deviceId?.slice(0, 8),
      primaryHost: maskEndpoint(schedule.primary?.endpointUrl),
      fallbackCount: schedule.fallbacks?.length ?? 0,
    });
  } catch (e) {
    fedDiag("schedule", "Hub schedule failed", {
      logicalModel,
      status: e.status,
      error: e.message,
    });
    return new Response(JSON.stringify({ error: { message: e.message, type: "federation_schedule_error" } }), {
      status: e.status || 502,
      headers: { "Content-Type": "application/json" },
    });
  }
  schedule._logicalModel = logicalModel;

  const candidates = [
    schedule.primary,
    ...(schedule.fallbacks || []),
  ].filter((c) => c?.endpointUrl && c?.federationToken);

  fedDiag("borrow", `try ${candidates.length} lender(s)`, {
    requestId: schedule.requestId?.slice(0, 12),
    logicalModel,
    stream: body.stream !== false,
  });

  let lastError = null;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      fedDiag("borrow", `attempt ${i + 1}/${candidates.length}`, {
        lender: candidate.deviceId?.slice(0, 8),
        host: maskEndpoint(candidate.endpointUrl),
      });
      const res = await callLender(
        candidate.endpointUrl,
        candidate.federationToken,
        logicalModel,
        body
      );

      const contentType = res.headers.get("content-type") || "";
      const isStream = body.stream !== false && contentType.includes("text/event-stream");

      if (!res.ok) {
        lastError = await res.text();
        fedDiag("borrow", `lender HTTP ${res.status}, try next`, {
          lender: candidate.deviceId?.slice(0, 8),
          bodyPreview: lastError,
        });
        continue;
      }

      fedDiag("borrow", "lender ok", {
        lender: candidate.deviceId?.slice(0, 8),
        stream: isStream,
      });

      if (!isStream) {
        const t0 = Date.now();
        const { text, usage } = await readNonStreamResponse(res);
        reportLenderLiveSla(
          settings,
          schedule,
          logicalModel,
          candidate.deviceId,
          Date.now() - t0,
          true
        );
        reportBorrowerLedger(schedule, usage, "success").catch(() => {});
        if (usage) {
          saveRequestUsage({
            provider: "federation",
            model: logicalModel,
            tokens: usage,
            meta: { usageKind: "federation_borrow", requestId: schedule.requestId },
          }).catch(() => {});
        }
        return new Response(text, {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      const [clientStream, tapStream] = res.body.tee();
      (async () => {
        try {
          const { usage, ttftMs } = await collectStreamUsage(tapStream.getReader());
          reportLenderLiveSla(
            settings,
            schedule,
            logicalModel,
            candidate.deviceId,
            ttftMs,
            !!usage
          );
          reportBorrowerLedger(schedule, usage, usage ? "success" : "failed").catch(() => {});
          if (usage) {
            saveRequestUsage({
              provider: "federation",
              model: logicalModel,
              tokens: usage,
              meta: { usageKind: "federation_borrow", requestId: schedule.requestId },
            }).catch(() => {});
          }
        } catch {
          reportLenderLiveSla(
            settings,
            schedule,
            logicalModel,
            candidate.deviceId,
            null,
            false
          );
          reportBorrowerLedger(schedule, null, "failed").catch(() => {});
        }
      })();

      return new Response(clientStream, {
        status: res.status,
        headers: res.headers,
      });
    } catch (e) {
      lastError = e.message;
      fedDiag("borrow", "lender attempt exception", {
        lender: candidate.deviceId?.slice(0, 8),
        error: e.message,
      });
    }
  }

  fedDiag("borrow", "all lenders failed → 502", {
    requestId: schedule.requestId?.slice(0, 12),
    logicalModel,
    lastError,
  });

  return new Response(
    JSON.stringify({
      error: {
        message: lastError || "All federation lenders failed",
        type: "federation_borrow_failed",
      },
    }),
    { status: 502, headers: { "Content-Type": "application/json" } }
  );
}
