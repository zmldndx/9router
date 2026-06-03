import { NextResponse } from "next/server";
import { buildFederationLendCatalog } from "@/lib/federation/lendCatalog";
import { hubFetch, HubError } from "@/lib/federation/hubClient";
import { getFederationSettings } from "@/lib/federation/settings";

export async function GET() {
  try {
    const catalog = await buildFederationLendCatalog();
    let hubPricedModels = [];
    const settings = await getFederationSettings();
    if (settings.hubUrl && settings.hubAccessToken) {
      try {
        const priced = await hubFetch("/v1/pricing/models", { settings });
        hubPricedModels = (priced.models || []).map((m) => m.logicalModel);
      } catch (e) {
        if (!(e instanceof HubError)) throw e;
      }
    }

    const pricedSet = new Set(hubPricedModels);
    for (const p of catalog.providers) {
      for (const m of p.models) {
        m.hubPriced = pricedSet.has(m.logicalModel);
      }
    }

    return NextResponse.json({
      ...catalog,
      hubPricedModels,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
