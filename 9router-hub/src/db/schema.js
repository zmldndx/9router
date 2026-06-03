export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  credit_usd REAL NOT NULL DEFAULT 0,
  identity_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_label TEXT,
  endpoint_url TEXT,
  lend_enabled INTEGER NOT NULL DEFAULT 0,
  borrow_enabled INTEGER NOT NULL DEFAULT 1,
  expose_models TEXT NOT NULL DEFAULT '[]',
  lend_allowed TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS federation_schedules (
  request_id TEXT PRIMARY KEY,
  borrower_device_id TEXT NOT NULL,
  lender_device_id TEXT NOT NULL,
  logical_model TEXT NOT NULL,
  hold_usd REAL NOT NULL DEFAULT 0,
  federation_jti TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS federation_ledger_reports (
  request_id TEXT NOT NULL,
  reporter_role TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  borrower_device_id TEXT NOT NULL,
  lender_device_id TEXT NOT NULL,
  logical_model TEXT NOT NULL,
  upstream_model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  charge_usd REAL NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (request_id, reporter_role)
);

CREATE TABLE IF NOT EXISTS federation_ledger (
  id TEXT PRIMARY KEY,
  request_id TEXT UNIQUE NOT NULL,
  confirmed_at TEXT,
  borrower_device_id TEXT NOT NULL,
  lender_device_id TEXT NOT NULL,
  logical_model TEXT NOT NULL,
  upstream_model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  charge_usd REAL NOT NULL DEFAULT 0,
  borrower_credit_usd_after REAL,
  lender_credit_usd_after REAL,
  settlement_status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'live',
  lender_reported_at TEXT,
  borrower_reported_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS welcome_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  identity_key TEXT NOT NULL UNIQUE,
  amount_usd REAL NOT NULL,
  granted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing_models (
  logical_model TEXT PRIMARY KEY,
  price_input_per_1k REAL NOT NULL,
  price_cache_per_1k REAL NOT NULL DEFAULT 0,
  price_output_per_1k REAL NOT NULL,
  request_fee_usd REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS federation_sla_samples (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  logical_model TEXT NOT NULL,
  request_id TEXT,
  ttft_ms INTEGER,
  tps REAL,
  ok INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'live',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_borrower ON federation_ledger(borrower_device_id);
CREATE INDEX IF NOT EXISTS idx_ledger_lender ON federation_ledger(lender_device_id);
CREATE INDEX IF NOT EXISTS idx_sla_device_model ON federation_sla_samples(device_id, logical_model);
`;

export const DEFAULT_PRICING = [
  { logical_model: "glm-4", price_input_per_1k: 0.001, price_cache_per_1k: 0.0002, price_output_per_1k: 0.002, request_fee_usd: 0 },
  { logical_model: "claude-sonnet", price_input_per_1k: 0.003, price_cache_per_1k: 0.0003, price_output_per_1k: 0.015, request_fee_usd: 0 },
  { logical_model: "fast-local", price_input_per_1k: 0.0005, price_cache_per_1k: 0, price_output_per_1k: 0.001, request_fee_usd: 0 },
];
