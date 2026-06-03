import { verifyHubAccessToken } from "../utils/tokens.js";
import { getUserById } from "../services/auth.js";

export async function requireHubAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: "Missing Authorization Bearer token" });
    }
    const payload = await verifyHubAccessToken(token);
    const user = getUserById(payload.sub);
    if (!user) {
      return res.status(401).json({
        error: "Hub user not found; database may have been reset — please sign in again",
      });
    }
    req.userId = payload.sub;
    req.userEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function optionalDeviceAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
      const payload = await verifyHubAccessToken(token);
      req.userId = payload.sub;
    }
  } catch {
    /* ignore */
  }
  next();
}
