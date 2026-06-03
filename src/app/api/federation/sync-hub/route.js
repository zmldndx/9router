import { NextResponse } from "next/server";
import { syncFederationEndpointToHub } from "@/lib/federation/heartbeat";
import {
  getFederationSettings,
  getLocalDeviceId,
  resolvePublicEndpointUrl,
} from "@/lib/federation/settings";

/** 立即把本机 endpoint + 心跳同步到 Hub（端点/Tailscale 连接后可手动或自动触发） */
export async function POST() {
  let settings;
  let deviceId = "";
  try {
    settings = await getFederationSettings();
    if (!settings.hubAccessToken || !settings.hubUrl) {
      return NextResponse.json(
        { error: "未连接 Hub，请先在联邦页完成注册/登录" },
        { status: 400 }
      );
    }

    const endpointUrl = await resolvePublicEndpointUrl();
    deviceId = await getLocalDeviceId();
    const hub = await syncFederationEndpointToHub();

    return NextResponse.json({
      ok: true,
      endpointUrl: endpointUrl || null,
      deviceId,
      device: hub?.device || hub,
    });
  } catch (e) {
    deviceId = deviceId || (await getLocalDeviceId().catch(() => ""));
    settings = settings || (await getFederationSettings().catch(() => ({})));

    let bind = null;
    if (settings.hubUrl && deviceId) {
      try {
        const base = settings.hubUrl.replace(/\/$/, "");
        const res = await fetch(
          `${base}/v1/devices/bind-status?deviceId=${encodeURIComponent(deviceId)}`
        );
        bind = await res.json();
      } catch {
        /* ignore */
      }
    }

    const status = e.status || 500;
    let error = e.message;
    if (status === 401) {
      error =
        "Hub 会话已失效且无法自动恢复（缺少本地凭证）。请在联邦页重新「连接 Hub」";
    } else if (status === 409) {
      error = bind?.bound
        ? `本机 device 已绑定 ${bind.email}，请使用该邮箱连接 Hub（一机一账号）`
        : "deviceId 已绑定其他 Hub 账号";
    } else if (status === 404) {
      error = "Hub 上找不到本机 device，请在联邦页重新「连接 Hub」";
    }

    return NextResponse.json(
      { error, deviceId, bind },
      { status: status === 404 ? 409 : status }
    );
  }
}
