import fs from "node:fs";
import Database from "better-sqlite3";
import { DB_PATH, HUB_DATA_DIR } from "../config.js";
import { SCHEMA_SQL, DEFAULT_PRICING } from "./schema.js";

let db;

export function getDb() {
  if (!db) {
    fs.mkdirSync(HUB_DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA_SQL);
    seedPricing();
  }
  return db;
}

function seedPricing() {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO pricing_models(logical_model, price_input_per_1k, price_cache_per_1k, price_output_per_1k, request_fee_usd, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(logical_model) DO NOTHING
  `);
  for (const p of DEFAULT_PRICING) {
    insert.run(
      p.logical_model,
      p.price_input_per_1k,
      p.price_cache_per_1k,
      p.price_output_per_1k,
      p.request_fee_usd,
      now
    );
  }
}
