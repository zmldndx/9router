import { NextResponse } from "next/server";
import { hubFetch } from "@/lib/federation/hubClient";
import {
  getFederationSettings,
  getLocalDeviceId,
  updateFederationSettings,
} from "@/lib/federation/settings";

export async function GET() {
  const settings = await getFederationSettings();
  const deviceId = await getLocalDeviceId();
  return NextResponse.json({ ...settings, deviceId, hubAccessToken: settings.hubAccessToken ? "***" : "" });
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const allowed = [
      "federationEnabled",
      "federationBorrowEnabled",
      "federationLendEnabled",
      "federationExposeModels",
      "federationExposeProviderIds",
    ];
    const patch = {};
    for (const k of allowed) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    if (body.lendExpose?.logicalModels) {
      patch.federationExposeModels = body.lendExpose.logicalModels;
      if (body.lendExpose.providerIds) {
        patch.federationExposeProviderIds = body.lendExpose.providerIds;
      }
    }

    const prev = await getFederationSettings();
    const settings = await updateFederationSettings(patch);
    const deviceId = await getLocalDeviceId();

    const lendConfigChanged =
      body.federationLendEnabled !== undefined ||
      body.federationExposeModels !== undefined ||
      body.lendExpose?.logicalModels ||
      body.lendPolicy?.exposeModels;

    if (settings.hubAccessToken && settings.hubUrl) {
      const hubOn = settings.federationEnabled;
      const lendOn = hubOn && settings.federationLendEnabled;
      const borrowOn = hubOn && settings.federationBorrowEnabled;
      if (
        body.lendExpose?.logicalModels ||
        body.lendPolicy ||
        body.federationLendEnabled !== undefined ||
        body.federationExposeModels !== undefined
      ) {
        await hubFetch(`/v1/devices/${deviceId}/lend-policy`, {
          method: "PUT",
          settings,
          body: {
            lendEnabled: lendOn,
            exposeModels:
              body.lendPolicy?.exposeModels ||
              body.federationExposeModels ||
              settings.federationExposeModels,
            lendAllowed: body.lendPolicy?.lendAllowed || {},
          },
        });
      }
      if (body.borrowPolicy || body.federationBorrowEnabled !== undefined) {
        await hubFetch(`/v1/devices/${deviceId}/borrow-policy`, {
          method: "PUT",
          settings,
          body: {
            borrowEnabled: borrowOn,
          },
        });
      }
    }

    if (
      lendConfigChanged &&
      settings.federationEnabled &&
      settings.federationLendEnabled &&
      settings.federationExposeModels?.length
    ) {
      const { scheduleLendProbeWithRetry } = await import("@/lib/federation/lendProbe.js");
      scheduleLendProbeWithRetry(
        prev.federationLendEnabled && settings.federationLendEnabled ? "recovery" : "join"
      );
    }

    return NextResponse.json({ ok: true, settings: await getFederationSettings(), deviceId });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
