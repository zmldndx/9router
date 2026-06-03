import { hubFetch } from "./hubClient.js";
import { getFederationSettings, getLocalDeviceId } from "./settings.js";
import { getAdapter } from "@/lib/db/driver.js";
import { stringifyJson, parseJson } from "@/lib/db/helpers/jsonCol.js";

const KV_SCOPE = "federation";
const QUEUE_KEY = "ledger_queue";

function usageToLedgerFields(usage) {
  const prompt = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
  const completion = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
  const cacheRead =
    usage?.cache_read_input_tokens ??
    usage?.cached_tokens ??
    usage?.prompt_tokens_details?.cached_tokens ??
    0;
  const cacheCreate = usage?.cache_creation_input_tokens ?? 0;
  const inputTokens = Math.max(0, prompt - cacheRead);
  return {
    inputTokens,
    cacheTokens: cacheRead + cacheCreate,
    outputTokens: completion,
  };
}

export function buildLedgerPayload({
  requestId,
  reporterRole,
  borrowerDeviceId,
  lenderDeviceId,
  logicalModel,
  upstreamModel,
  usage,
  chargeUSD,
  outcome = "success",
  source = "live",
}) {
  const tokens = usageToLedgerFields(usage || {});
  return {
    requestId,
    reporterRole,
    reportedAt: new Date().toISOString(),
    borrowerDeviceId,
    lenderDeviceId,
    logicalModel,
    upstreamModel: upstreamModel || null,
    inputTokens: tokens.inputTokens,
    cacheTokens: tokens.cacheTokens,
    outputTokens: tokens.outputTokens,
    chargeUSD: chargeUSD ?? 0,
    outcome,
    source,
  };
}

export async function reportLedger(payload, settings) {
  try {
    const result = await hubFetch("/v1/ledger/report", {
      method: "POST",
      settings,
      body: payload,
    });
    return { ok: true, result };
  } catch (e) {
    await enqueueLedger(payload);
    return { ok: false, error: e.message };
  }
}

async function enqueueLedger(payload) {
  try {
    const db = await getAdapter();
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [KV_SCOPE, QUEUE_KEY]);
    const queue = row ? parseJson(row.value, []) : [];
    queue.push({ ...payload, queuedAt: new Date().toISOString() });
    if (queue.length > 500) queue.splice(0, queue.length - 500);
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [KV_SCOPE, QUEUE_KEY, stringifyJson(queue)]
    );
  } catch {
    /* best effort */
  }
}

export async function flushLedgerQueue(settings) {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [KV_SCOPE, QUEUE_KEY]);
  const queue = row ? parseJson(row.value, []) : [];
  if (!queue.length) return { flushed: 0 };

  const remaining = [];
  let flushed = 0;
  for (const item of queue) {
    try {
      await hubFetch("/v1/ledger/report", { method: "POST", settings, body: item });
      flushed += 1;
    } catch {
      remaining.push(item);
    }
  }
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [KV_SCOPE, QUEUE_KEY, stringifyJson(remaining)]
  );
  return { flushed, remaining: remaining.length };
}

export async function reportLenderLedger(ctx, usage, outcome, upstreamModel) {
  const settings = await getFederationSettings();
  const payload = buildLedgerPayload({
    requestId: ctx.requestId,
    reporterRole: "lender",
    borrowerDeviceId: ctx.borrowerDeviceId,
    lenderDeviceId: ctx.lenderDeviceId,
    logicalModel: ctx.logicalModel,
    upstreamModel,
    usage,
    outcome,
    source: "live",
  });
  return reportLedger(payload, settings);
}

export async function reportBorrowerLedger(schedule, usage, outcome, chargeUSD) {
  const settings = await getFederationSettings();
  const lenderDeviceId = schedule.primary?.deviceId;
  const payload = buildLedgerPayload({
    requestId: schedule.requestId,
    reporterRole: "borrower",
    borrowerDeviceId: await getLocalDeviceId(),
    lenderDeviceId,
    logicalModel: schedule._logicalModel,
    usage,
    chargeUSD,
    outcome,
    source: "live",
  });
  return reportLedger(payload, settings);
}
