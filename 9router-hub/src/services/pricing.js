import { getDb } from "../db/index.js";

export function getModelPricing(logicalModel) {
  const db = getDb();
  return db
    .prepare(
      `SELECT logical_model, price_input_per_1k, price_cache_per_1k, price_output_per_1k, request_fee_usd
       FROM pricing_models WHERE logical_model = ?`
    )
    .get(logicalModel);
}

export function listPricedModels() {
  const db = getDb();
  return db
    .prepare(
      `SELECT logical_model, price_input_per_1k, price_cache_per_1k, price_output_per_1k
       FROM pricing_models ORDER BY logical_model ASC`
    )
    .all()
    .map((r) => ({
      logicalModel: r.logical_model,
      priceInputPer1k: r.price_input_per_1k,
      priceCachePer1k: r.price_cache_per_1k,
      priceOutputPer1k: r.price_output_per_1k,
    }));
}

export function ensurePricingForModel(logicalModel) {
  const existing = getModelPricing(logicalModel);
  if (existing) return existing;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pricing_models(logical_model, price_input_per_1k, price_cache_per_1k, price_output_per_1k, request_fee_usd, updated_at)
     VALUES (?, 0.001, 0.0002, 0.002, 0, ?)`
  ).run(logicalModel, now);
  return getModelPricing(logicalModel);
}

export function ensurePricingForModels(logicalModels) {
  for (const m of logicalModels || []) {
    if (m) ensurePricingForModel(m);
  }
}

export function computeChargeUSD(logicalModel, inputTokens, cacheTokens, outputTokens) {
  const p = getModelPricing(logicalModel);
  if (!p) return null;
  const charge =
    (inputTokens / 1000) * p.price_input_per_1k +
    (cacheTokens / 1000) * p.price_cache_per_1k +
    (outputTokens / 1000) * p.price_output_per_1k +
    p.request_fee_usd;
  return Math.round(charge * 1e6) / 1e6;
}
