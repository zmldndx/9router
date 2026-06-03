import { NextResponse } from "next/server";
import { getLocalDeviceId } from "@/lib/federation/settings";

export async function GET() {
  const deviceId = await getLocalDeviceId();
  return NextResponse.json({ deviceId });
}
