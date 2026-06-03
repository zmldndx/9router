import * as jose from "jose";
import { getLocalDeviceId } from "./settings.js";

function federationJwtSecret() {
  return process.env.FEDERATION_JWT_SECRET || "dev-federation-jwt-secret-change-me";
}

export async function verifyIncomingFederationToken(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  try {
    const secret = new TextEncoder().encode(federationJwtSecret());
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.typ !== "federation") return null;
    const localDeviceId = await getLocalDeviceId();
    if (payload.lenderDeviceId !== localDeviceId) {
      return { error: "Token lenderDeviceId does not match this device" };
    }
    return {
      requestId: payload.requestId,
      borrowerDeviceId: payload.borrowerDeviceId,
      lenderDeviceId: payload.lenderDeviceId,
      logicalModel: payload.logicalModel,
      jti: payload.jti,
    };
  } catch {
    return null;
  }
}
