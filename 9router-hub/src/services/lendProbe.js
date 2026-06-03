import { newId } from "../utils/ids.js";
import { signFederationToken } from "../utils/tokens.js";
import { assertDeviceOwner } from "./devices.js";

const PROBE_BORROWER = "probe:hub";

export async function issueLendProbeTokens(userId, deviceId, logicalModels) {
  const device = assertDeviceOwner(userId, deviceId);
  if (!device.lendEnabled) {
    const err = new Error("Lend not enabled");
    err.status = 403;
    throw err;
  }
  const models = (logicalModels?.length ? logicalModels : device.exposeModels).filter(
    (m) => device.exposeModels.includes(m) && device.lendAllowed[m] !== false
  );
  if (!models.length) {
    const err = new Error("No models to probe");
    err.status = 400;
    throw err;
  }
  if (!device.endpointUrl) {
    const err = new Error("endpointUrl required for lend probe");
    err.status = 400;
    throw err;
  }

  const tokens = [];
  for (const logicalModel of models) {
    const requestId = newId("probe");
    const federationToken = await signFederationToken({
      requestId,
      borrowerDeviceId: PROBE_BORROWER,
      lenderDeviceId: deviceId,
      logicalModel,
      jti: newId("jti"),
    });
    tokens.push({ logicalModel, requestId, federationToken });
  }

  return {
    deviceId,
    endpointUrl: device.endpointUrl,
    tokens,
  };
}
