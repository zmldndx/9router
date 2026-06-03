import { HUB_ADMIN_TOKEN } from "../config.js";

/** 未配置 HUB_ADMIN_TOKEN 时仅允许本机访问管理 API */
export function requireAdminAccess(req, res, next) {
  if (!HUB_ADMIN_TOKEN) {
    const ip = req.ip || req.socket?.remoteAddress || "";
    const local =
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "::ffff:127.0.0.1" ||
      ip.endsWith("127.0.0.1");
    if (!local) {
      return res.status(403).json({ error: "Admin API only available on localhost without HUB_ADMIN_TOKEN" });
    }
    return next();
  }
  const token =
    req.headers["x-admin-token"] ||
    req.query.token ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null);
  if (token !== HUB_ADMIN_TOKEN) {
    return res.status(401).json({ error: "Invalid admin token" });
  }
  next();
}
