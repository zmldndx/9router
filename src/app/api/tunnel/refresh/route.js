import { NextResponse } from "next/server";
import { refreshTunnel } from "@/lib/tunnel";

const DNS_WARMUP_DELAY_MS = 8000;

export async function POST() {
  try {
    const result = await refreshTunnel();
    await new Promise((r) => setTimeout(r, DNS_WARMUP_DELAY_MS));
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel refresh error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
