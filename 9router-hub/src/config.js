import path from "node:path";

export const HOST = process.env.HOST || "127.0.0.1";
export const PORT = Number(process.env.PORT || 30200);
export const HUB_DATA_DIR = process.env.HUB_DATA_DIR || path.join(process.cwd(), "data");
export const DB_PATH = path.join(HUB_DATA_DIR, "hub.db");

export const HUB_JWT_SECRET = process.env.HUB_JWT_SECRET || "dev-hub-jwt-secret-change-me";
export const FEDERATION_JWT_SECRET = process.env.FEDERATION_JWT_SECRET || "dev-federation-jwt-secret-change-me";
export const HUB_TOKEN_TTL = process.env.HUB_TOKEN_TTL || "7d";
export const FEDERATION_TOKEN_TTL_SEC = Number(process.env.FEDERATION_TOKEN_TTL_SEC || 900);

export const WELCOME_USD = Number(process.env.WELCOME_USD || 10);
export const HOLD_USD = Number(process.env.HOLD_USD || 0.05);
export const LEDGER_MATCH_TOLERANCE_USD = Number(process.env.LEDGER_MATCH_TOLERANCE_USD || 0.001);
export const LEDGER_PENDING_EXPIRE_DAYS = Number(process.env.LEDGER_PENDING_EXPIRE_DAYS || 7);

export const HEARTBEAT_ONLINE_MS = Number(process.env.HEARTBEAT_ONLINE_MS || 5 * 60 * 1000);

export const OFFICIAL_DEVICE_IDS = (process.env.OFFICIAL_DEVICE_IDS || "d_official_0001")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** 管理台 API/UI；空则仅本机可访问 /v1/admin/* */
export const HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || "";

export const UI_REFRESH_MS = Number(process.env.UI_REFRESH_MS || 8000);
