import { machineIdSync } from 'node-machine-id';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '@/lib/dataDir';

const MACHINE_ID_FILE = path.join(DATA_DIR, 'machine-id');
const AUTH_DIR = path.join(DATA_DIR, 'auth');
const CLI_SECRET_FILE = path.join(AUTH_DIR, 'cli-secret');
const CLI_AUTH_SALT = '9r-cli-auth';
let cachedRawId = null;
let cachedCliSecret = null;

// Persist raw machine ID to file → guarantees CLI/server/middleware see same value
// even when machineIdSync fails or returns inconsistent values across runtimes.
function loadRawMachineId() {
  if (cachedRawId) return cachedRawId;
  try {
    cachedRawId = fs.readFileSync(MACHINE_ID_FILE, 'utf8').trim();
    if (cachedRawId) return cachedRawId;
  } catch {}
  try {
    cachedRawId = machineIdSync();
  } catch {
    cachedRawId = crypto.randomUUID();
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MACHINE_ID_FILE, cachedRawId, { mode: 0o600 });
  } catch {}
  return cachedRawId;
}

// Random secret persisted on first run → unpredictable CLI token even when machineId leaks.
function loadCliSecret() {
  if (cachedCliSecret) return cachedCliSecret;
  try {
    cachedCliSecret = fs.readFileSync(CLI_SECRET_FILE, 'utf8').trim();
    if (cachedCliSecret) return cachedCliSecret;
  } catch {}
  cachedCliSecret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(CLI_SECRET_FILE, cachedCliSecret, { mode: 0o600 });
  } catch {}
  return cachedCliSecret;
}

/**
 * 设备 ID：联邦 Hub deviceId、API keys 等。
 * - 未设 MACHINE_ID_SALT：仅由本机硬件 ID 稳定推导（单实例）
 * - 设 MACHINE_ID_SALT：同机多实例须用不同盐，避免 Hub 上 deviceId 冲突
 * - salt === CLI_AUTH_SALT：CLI 本地令牌专用，与联邦 deviceId 分离
 */
export async function getConsistentMachineId(salt = null) {
  const raw = loadRawMachineId();

  if (salt === CLI_AUTH_SALT) {
    return crypto
      .createHash("sha256")
      .update(raw + CLI_AUTH_SALT + loadCliSecret())
      .digest("hex")
      .substring(0, 16);
  }

  const custom = (salt ?? process.env.MACHINE_ID_SALT ?? "").trim();
  if (custom) {
    return crypto.createHash("sha256").update(raw + custom).digest("hex").substring(0, 16);
  }

  return crypto.createHash("sha256").update(raw).digest("hex").substring(0, 16);
}

export async function getRawMachineId() {
  return loadRawMachineId();
}

/**
 * Check if we're running in browser or server environment
 * @returns {boolean} True if in browser, false if in server
 */
export function isBrowser() {
  return typeof window !== 'undefined';
}
