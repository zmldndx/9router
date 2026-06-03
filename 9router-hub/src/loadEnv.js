import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFromRoot } from "../../src/lib/loadEnv.mjs";

const hubRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 9router-hub：读取 hub 根目录下的 .env */
export function loadHubEnv() {
  return loadEnvFromRoot(hubRoot);
}

// 在 import config 之前执行（index.js 首行 import 本文件即可）
loadHubEnv();
