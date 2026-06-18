"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Button, Input, Toggle, CardSkeleton } from "@/shared/components";
import ExposeModelsPicker from "./ExposeModelsPicker";

const REFRESH_MS = 10000;
const DEFAULT_HUB = "http://127.0.0.1:30200";

function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? Math.min(2, digits) : 0,
  });
}

function fmtUsd(n) {
  if (n == null) return "—";
  return `$${fmt(n, 4)}`;
}

function ModelTable({ rows, emptyText }) {
  if (!rows?.length) {
    return <p className="text-sm text-text-muted py-4 text-center">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-muted border-b border-border-subtle">
            <th className="py-2 pr-2 font-medium">模型</th>
            <th className="py-2 pr-2 font-medium text-right">成交</th>
            <th className="py-2 pr-2 font-medium text-right">总 Token</th>
            <th className="py-2 font-medium text-right">creditUSD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.logicalModel} className="border-b border-border-subtle/60">
              <td className="py-2 pr-2 font-mono text-xs">{r.logicalModel}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmt(r.deals)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmt(r.totalTokens)}</td>
              <td className="py-2 text-right tabular-nums">{fmtUsd(r.creditUSD)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FederationPageClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");

  const [hubUrl, setHubUrl] = useState(DEFAULT_HUB);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const hubJoined = !!status?.hubConnected;
  const hubOn = !!status?.federationEnabled && hubJoined;
  const savedExposeModels = useMemo(
    () => status?.federationExposeModels ?? [],
    [status?.federationExposeModels]
  );

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/federation/status", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setStatus(data);
      setError("");
      if (data.hubUrl) setHubUrl(data.hubUrl);
      if (data.hubConnected) {
        fetch("/api/federation/sync-hub", { method: "POST" }).catch(() => {});
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, REFRESH_MS);
    return () => clearInterval(t);
  }, [loadStatus]);

  const patchSettings = async (body) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/federation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      await loadStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleJoin = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/federation/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hubUrl: hubUrl.trim(),
          email: email.trim(),
          password,
          deviceLabel: "9router-dashboard",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setPassword("");
      await loadStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLendExpose = ({ logicalModels, providerIds }) =>
    patchSettings({
      federationExposeModels: logicalModels,
      federationExposeProviderIds: providerIds,
      lendExpose: { logicalModels, providerIds },
      lendPolicy: {
        lendEnabled: status?.federationLendEnabled,
        exposeModels: logicalModels,
      },
    });

  if (loading && !status) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-main">联邦 Hub</h1>
        <p className="text-sm text-text-muted mt-1">
          社区借还 creditUSD · 借入：先本机（绝对名→逻辑名），不可用自动走 Hub；<code className="text-xs bg-bg px-1 rounded">federation:模型</code> 强制借入 · 每 {REFRESH_MS / 1000}s 刷新
          {status?.generatedAt ? (
            <span className="ml-2">· 更新 {new Date(status.generatedAt).toLocaleTimeString("zh-CN")}</span>
          ) : null}
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <Card
        title="Hub 对接"
        subtitle={hubJoined ? `已绑定 · device ${status?.deviceId?.slice(0, 12)}…` : "注册并绑定本机到 Hub"}
        icon="hub"
      >
        {!hubJoined ? (
          <div className="grid gap-4 max-w-lg">
            <Input label="Hub 地址" value={hubUrl} onChange={(e) => setHubUrl(e.target.value)} placeholder={DEFAULT_HUB} />
            <Input label="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" />
            <Input
              label="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="new-password"
            />
            <Button onClick={handleJoin} disabled={saving || !hubUrl || !email || !password}>
              {saving ? "连接中…" : "注册 / 登录并连接 Hub"}
            </Button>
            <p className="text-xs text-text-muted">
              首次注册赠送 welcome credit（以 Hub 配置为准）。连接 Hub 时会自动开启 Tunnel，公网地址固定不变（用于联邦通信）。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Toggle
              label="启用 Hub 对接"
              description={hubOn ? "已连接控制面，可借入/借出" : "已暂停，保留账号与余额"}
              checked={hubOn}
              disabled={saving}
              onChange={(v) => patchSettings({ federationEnabled: v })}
            />
            <div className="flex flex-wrap gap-4 text-sm text-text-muted">
              <span>Hub: <span className="text-text-main font-mono text-xs">{status.hubUrl}</span></span>
              <span>deviceId: <span className="text-text-main font-mono text-xs">{status.deviceId}</span></span>
            </div>
            {status.tunnelPublicUrl || status.endpointUrl ? (
              <div className="rounded-lg border border-border-subtle bg-surface-2/50 px-3 py-2 text-sm">
                <p className="text-text-muted text-xs mb-1">联邦公网 Endpoint（固定）</p>
                <p className="font-mono text-xs text-text-main break-all">
                  {status.tunnelPublicUrl || status.endpointUrl}
                </p>
                <p className="text-xs text-text-muted mt-1">
                  底层 cloudflared 重连时会自动更新映射；公网短链地址不变。可在「端点」页手动刷新 Tunnel 后端。
                </p>
              </div>
            ) : hubOn ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                正在准备 Tunnel… 若长时间无地址，请检查网络或在「端点」页手动开启。
              </p>
            ) : null}
            <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-border-subtle">
              <Toggle
                label="允许借入"
                description="开启后：ag/模型名 或逻辑名，本机优先，否则自动借入；federation: 强制借入"
                checked={!!status.federationBorrowEnabled}
                disabled={saving || !hubOn}
                onChange={(v) =>
                  patchSettings({
                    federationBorrowEnabled: v,
                    borrowPolicy: { borrowEnabled: v },
                  })
                }
              />
              <Toggle
                label="允许借出"
                description="他人可借你的暴露模型"
                checked={!!status.federationLendEnabled}
                disabled={saving || !hubOn}
                onChange={(v) =>
                  patchSettings({
                    federationLendEnabled: v,
                    lendPolicy: {
                      lendEnabled: v,
                      exposeModels: status?.federationExposeModels || [],
                    },
                  })
                }
              />
            </div>
            <div className="pt-2 border-t border-border-subtle">
              <h3 className="text-sm font-medium text-text-main mb-2">借出暴露模型</h3>
              <ExposeModelsPicker
                initialLogicalModels={savedExposeModels}
                disabled={saving || !hubOn}
                saving={saving}
                onSave={handleSaveLendExpose}
              />
            </div>
            {status.lendableModels?.length ? (
              <p className="text-xs text-text-muted">
                当前可借模型：{" "}
                {status.lendableModels.map((m) => (
                  <span key={m} className="inline-block mr-1 px-1.5 py-0.5 rounded bg-bg border border-border-subtle font-mono">
                    {m}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        )}
      </Card>

      {hubJoined && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card padding="sm" className="!p-4">
              <p className="text-xs text-text-muted uppercase tracking-wide">creditUSD</p>
              <p className="text-xl font-semibold tabular-nums mt-1">{fmtUsd(status.creditUSD)}</p>
            </Card>
            <Card padding="sm" className="!p-4">
              <p className="text-xs text-text-muted uppercase tracking-wide">借入 Token</p>
              <p className="text-xl font-semibold tabular-nums mt-1">{fmt(status.totals?.borrowTokens)}</p>
              <p className="text-xs text-text-muted mt-0.5">{fmtUsd(status.totals?.borrowCreditUSD)}</p>
            </Card>
            <Card padding="sm" className="!p-4">
              <p className="text-xs text-text-muted uppercase tracking-wide">借出 Token</p>
              <p className="text-xl font-semibold tabular-nums mt-1">{fmt(status.totals?.lendTokens)}</p>
              <p className="text-xs text-text-muted mt-0.5">{fmtUsd(status.totals?.lendCreditUSD)}</p>
            </Card>
            <Card padding="sm" className="!p-4">
              <p className="text-xs text-text-muted uppercase tracking-wide">累计借入 $</p>
              <p className="text-xl font-semibold tabular-nums mt-1">{fmtUsd(status.lifetimeBorrowedUSD)}</p>
            </Card>
            <Card padding="sm" className="!p-4">
              <p className="text-xs text-text-muted uppercase tracking-wide">累计借出 $</p>
              <p className="text-xl font-semibold tabular-nums mt-1">{fmtUsd(status.lifetimeLentUSD)}</p>
            </Card>
            <Card padding="sm" className="!p-4">
              <p className="text-xs text-text-muted uppercase tracking-wide">对账</p>
              <p className="text-sm font-medium mt-1">
                pending {fmt(status.ledgerPending)} · mismatch {fmt(status.ledgerMismatch)}
              </p>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <Card title="借入模型 Top 10" subtitle="按总 Token" icon="south">
              <ModelTable rows={status.topModels?.borrow} emptyText="暂无借入成交" />
            </Card>
            <Card title="借出模型 Top 10" subtitle="按总 Token" icon="north">
              <ModelTable rows={status.topModels?.lend} emptyText="暂无借出成交" />
            </Card>
          </div>

          <Card title="社区运营台" subtitle="全站大盘（非本机）" icon="open_in_new" padding="sm">
            <p className="text-sm text-text-muted">
              查看全社区用户与流动性：
              <a
                href={status.hubUrl || DEFAULT_HUB}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-500 hover:underline ml-1"
              >
                {status.hubUrl || DEFAULT_HUB}
              </a>
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
