/**
 * 本实例对外 URL 与监听端口（.env：PORT、HOSTNAME；公网用控制台 Tailscale/tunnel 设置）
 */

export function resolveServicePort(fallback = 20128) {
  const p = Number(process.env.PORT);
  return Number.isFinite(p) && p > 0 ? p : fallback;
}

/** Next 监听地址（0.0.0.0 = 局域网可访问） */
export function resolveListenHostname() {
  const h = (process.env.HOSTNAME || "127.0.0.1").trim();
  return h || "127.0.0.1";
}

/**
 * 本机访问用的根 URL（浏览器 / CLI 向导 / OIDC 回退）。
 * 默认 http://127.0.0.1:PORT；公网/联邦 endpoint 走设置里的 tailscaleUrl / tunnelUrl。
 */
export function resolveBaseUrl() {
  const explicit = (process.env.BASE_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;

  const legacy = (process.env.NEXT_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (legacy) return legacy;

  return `http://127.0.0.1:${resolveServicePort()}`;
}

/** 是否显式配置了 BASE_URL（仅兼容旧部署，.env.example 不再推荐） */
export function isBaseUrlConfigured() {
  return !!(process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL)?.trim();
}
