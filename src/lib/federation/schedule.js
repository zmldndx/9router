import { hubFetch } from "./hubClient.js";
import { getLocalDeviceId } from "./settings.js";

export async function federationSchedule(logicalModel, settings) {
  const borrowerDeviceId = await getLocalDeviceId();
  return hubFetch("/v1/federation/schedule", {
    method: "POST",
    settings,
    body: { logicalModel, borrowerDeviceId },
  });
}

export async function federationScheduleRefresh(requestId, lenderDeviceId, logicalModel, settings) {
  return hubFetch("/v1/federation/schedule/refresh", {
    method: "POST",
    settings,
    body: { requestId, lenderDeviceId, logicalModel },
  });
}
