import { NextResponse } from "next/server";
import { connectToHub } from "@/lib/federation/hubJoin";

export async function POST(request) {
  try {
    const body = await request.json();
    const { hubUrl, email, password, deviceLabel } = body || {};
    if (!hubUrl || !email || !password) {
      return NextResponse.json({ error: "hubUrl, email, password required" }, { status: 400 });
    }

    const result = await connectToHub({
      hubUrl,
      email,
      password,
      deviceLabel,
      saveCredentials: true,
      scheduleProbe: true,
    });

    return NextResponse.json({
      ok: true,
      userId: result.auth.userId,
      creditUSD: result.auth.creditUSD,
      deviceId: result.deviceId,
      device: result.device,
      endpointUrl: result.endpointUrl,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
