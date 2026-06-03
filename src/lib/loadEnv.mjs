import fs from "node:fs";
import path from "node:path";

const loadedRoots = new Set();

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/**
 * 从项目根目录读取 `.env`（不覆盖已有 process.env）。
 * @param {string} rootDir 项目根（含 package.json 的目录）
 * @returns {{ loaded: boolean, path: string | null, keys: string[] }}
 */
export function loadEnvFromRoot(rootDir) {
  const root = path.resolve(rootDir);
  if (loadedRoots.has(root)) {
    return { loaded: false, path: path.join(root, ".env"), keys: [] };
  }
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) {
    loadedRoots.add(root);
    return { loaded: false, path: envPath, keys: [] };
  }

  const keys = [];
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
      keys.push(parsed.key);
    }
  }
  loadedRoots.add(root);
  return { loaded: true, path: envPath, keys };
}

/** 9router / 9router-dev2：以进程 cwd 为根（请在项目目录执行 npm run dev） */
export function load9routerEnv() {
  return loadEnvFromRoot(process.cwd());
}
