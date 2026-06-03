/**
 * 在启动 Next 之前加载项目根 .env，并显式传入 -p / -H。
 * Next CLI 会在读取 next.config 之前定端口，仅靠 next.config 里 loadEnv 来不及。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFromRoot } from "../src/lib/loadEnv.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = loadEnvFromRoot(root);
if (result.loaded) {
  console.log(`[dev] loaded ${result.path} (${result.keys.length} keys)`);
}

const port = String(process.env.PORT || "20128").trim();
const hostname = (process.env.HOSTNAME || "127.0.0.1").trim();
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

const args = [nextBin, "dev", "--webpack", "-p", port, "-H", hostname];
const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
