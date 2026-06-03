import * as jose from "jose";
import {
  HUB_JWT_SECRET,
  FEDERATION_JWT_SECRET,
  HUB_TOKEN_TTL,
  FEDERATION_TOKEN_TTL_SEC,
} from "../config.js";

const hubSecret = new TextEncoder().encode(HUB_JWT_SECRET);
const fedSecret = new TextEncoder().encode(FEDERATION_JWT_SECRET);

export async function signHubAccessToken(payload) {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(HUB_TOKEN_TTL)
    .sign(hubSecret);
}

export async function verifyHubAccessToken(token) {
  const { payload } = await jose.jwtVerify(token, hubSecret);
  return payload;
}

export async function signFederationToken({
  requestId,
  borrowerDeviceId,
  lenderDeviceId,
  logicalModel,
  jti,
}) {
  return new jose.SignJWT({
    requestId,
    borrowerDeviceId,
    lenderDeviceId,
    logicalModel,
    jti,
    typ: "federation",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${FEDERATION_TOKEN_TTL_SEC}s`)
    .sign(fedSecret);
}

export async function verifyFederationToken(token) {
  const { payload } = await jose.jwtVerify(token, fedSecret);
  if (payload.typ !== "federation") {
    throw new Error("Invalid federation token type");
  }
  return payload;
}
