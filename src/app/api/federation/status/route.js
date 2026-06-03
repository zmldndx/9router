import { NextResponse } from "next/server";
import { hubFetch } from "@/lib/federation/hubClient";
import {
  getFederationSettings,
  getLocalDeviceId,
} from "@/lib/federation/settings";
import { flushLedgerQueue, getLedgerAuditLogPaths } from "@/lib/federation/ledgerReporter";

function basePayload(settings, deviceId) {
  return {
    federationEnabled: settings.federationEnabled,
    hubUrl: settings.hubUrl,
    federationHubEmail: settings.federationHubEmail || "",
    deviceId,
    federationBorrowEnabled: settings.federationBorrowEnabled,
    federationLendEnabled: settings.federationLendEnabled,
    federationExposeModels: settings.federationExposeModels,
    generatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const settings = await getFederationSettings();
    const deviceId = await getLocalDeviceId();

    if (!settings.hubAccessToken) {
      return NextResponse.json({
        ...basePayload(settings, deviceId),
        hubConnected: false,
        federationEnabled: false,
        message: "Not joined — configure Hub below",
      });
    }

    await flushLedgerQueue(settings).catch(() => {});
    const summary = await hubFetch("/v1/me/summary");

    return NextResponse.json({
      ...basePayload(settings, deviceId),
      hubConnected: true,
      message: settings.federationEnabled
        ? undefined
        : "Hub 对接已关闭，可在下方重新开启",
      creditUSD: summary.creditUSD,
      lifetimeBorrowedUSD: summary.lifetimeBorrowedUSD,
      lifetimeLentUSD: summary.lifetimeLentUSD,
      ledgerPending: summary.ledgerPending,
      ledgerMismatch: summary.ledgerMismatch,
      devices: summary.devices,
      recentLedger: summary.recentLedger,
      lendableModels: summary.lendableModels,
      totals: summary.totals,
      topModels: summary.topModels,
      ledgerAuditLogs: getLedgerAuditLogPaths(),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
