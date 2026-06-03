"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";

function initialKey(models) {
  return JSON.stringify([...(models || [])].sort());
}

function ProviderCheckbox({ checked, indeterminate, disabled, onChange, title }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-4 rounded border-border accent-brand-500"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      title={title}
    />
  );
}

ProviderCheckbox.propTypes = {
  checked: PropTypes.bool.isRequired,
  indeterminate: PropTypes.bool,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  title: PropTypes.string,
};

export default function ExposeModelsPicker({
  initialLogicalModels = [],
  disabled = false,
  onSave,
  saving = false,
}) {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [dirty, setDirty] = useState(false);
  const savedKey = useMemo(() => initialKey(initialLogicalModels), [initialLogicalModels]);
  const lastSyncedKey = useRef("");

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/federation/lend-catalog", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setCatalog(data);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const applyInitialSelection = useCallback(
    (cat, logicals) => {
      const ids = new Set();
      const wanted = new Set(logicals || []);
      for (const p of cat?.providers || []) {
        for (const m of p.models) {
          if (wanted.has(m.logicalModel)) ids.add(m.modelId);
        }
      }
      setSelectedIds(ids);
    },
    []
  );

  useEffect(() => {
    if (!catalog || dirty) return;
    if (savedKey === lastSyncedKey.current) return;
    applyInitialSelection(catalog, initialLogicalModels);
    lastSyncedKey.current = savedKey;
  }, [catalog, dirty, savedKey, initialLogicalModels, applyInitialSelection]);

  const providerState = useMemo(() => {
    if (!catalog?.providers) return [];
    return catalog.providers.map((p) => {
      const modelIds = p.models.map((m) => m.modelId);
      const selectedCount = modelIds.filter((id) => selectedIds.has(id)).length;
      const allSelected = modelIds.length > 0 && selectedCount === modelIds.length;
      const someSelected = selectedCount > 0 && !allSelected;
      return { ...p, modelIds, selectedCount, allSelected, someSelected };
    });
  }, [catalog, selectedIds]);

  const markDirty = (updater) => {
    setDirty(true);
    setSelectedIds(updater);
  };

  const toggleModelId = (modelId, on) => {
    markDirty((prev) => {
      const next = new Set(prev);
      if (on) next.add(modelId);
      else next.delete(modelId);
      return next;
    });
  };

  const toggleProvider = (provider) => {
    if (!provider.hasActiveConnection) return;
    const on = !provider.allSelected;
    markDirty((prev) => {
      const next = new Set(prev);
      for (const id of provider.modelIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const toggleExpand = (providerId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  const selectedLogicalModels = useMemo(() => {
    if (!catalog?.providers) return [];
    const out = new Set();
    for (const p of catalog.providers) {
      for (const m of p.models) {
        if (selectedIds.has(m.modelId)) out.add(m.logicalModel);
      }
    }
    return [...out].sort();
  }, [catalog, selectedIds]);

  const selectedProviderIds = useMemo(() => {
    return providerState.filter((p) => p.allSelected).map((p) => p.providerId);
  }, [providerState]);

  const handleSave = () => {
    onSave?.({
      logicalModels: selectedLogicalModels,
      providerIds: selectedProviderIds,
    });
    setDirty(false);
    lastSyncedKey.current = initialKey(selectedLogicalModels);
  };

  if (loading) {
    return <p className="text-sm text-text-muted py-4">加载可用模型…</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-red-500 py-2">
        {error}
        <button type="button" className="ml-2 underline" onClick={loadCatalog}>
          重试
        </button>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">
        勾选供应商可一次选中其下全部模型；展开可单独调整。借出方 Hub 逻辑模型名见每行右侧标签。
        {catalog.activeConnectionCount === 0 ? (
          <span className="text-amber-600 dark:text-amber-400"> · 请先在 Providers 添加并启用连接</span>
        ) : null}
      </p>

      <div className="border border-border-subtle rounded-lg divide-y divide-border-subtle max-h-[420px] overflow-y-auto custom-scrollbar">
        {providerState.map((p) => {
          const isOpen = expanded.has(p.providerId);
          const connDisabled = !p.hasActiveConnection;
          const statusClass =
            p.connectionStatus === "connected"
              ? "text-green-600 dark:text-green-400"
              : p.connectionStatus === "error"
                ? "text-red-600 dark:text-red-400"
                : p.connectionStatus === "disabled"
                  ? "text-text-muted"
                  : "text-amber-600 dark:text-amber-400";

          return (
            <div key={p.providerId} className={connDisabled ? "opacity-60" : ""}>
              <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-2/50 hover:bg-surface-2">
                <ProviderCheckbox
                  checked={p.allSelected}
                  indeterminate={p.someSelected}
                  disabled={disabled || connDisabled || saving}
                  onChange={() => toggleProvider(p)}
                  title={connDisabled ? p.connectionLabel : p.name}
                />
                <button
                  type="button"
                  className="p-0.5 text-text-muted hover:text-text-main"
                  onClick={() => toggleExpand(p.providerId)}
                  aria-expanded={isOpen}
                >
                  <span className="material-symbols-outlined text-lg">
                    {isOpen ? "expand_more" : "chevron_right"}
                  </span>
                </button>
                <span
                  className="material-symbols-outlined text-lg"
                  style={{ color: p.color }}
                >
                  {p.icon}
                </span>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium text-text-main truncate">{p.name}</div>
                  <div className="text-[10px] text-text-muted">
                    {p.models.length} 个模型
                    {p.selectedCount > 0 ? ` · 已选 ${p.selectedCount}` : ""}
                    <span className={`ml-1 ${statusClass}`}>· {p.connectionLabel}</span>
                  </div>
                </div>
              </div>

              {isOpen && (
                <div className="px-3 pb-2 pt-1 space-y-1 bg-bg/50">
                  {p.models.map((m) => (
                    <label
                      key={m.modelId}
                      className="flex items-start gap-2 py-1.5 px-2 rounded-md hover:bg-surface cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 size-3.5 rounded border-border accent-brand-500"
                        checked={selectedIds.has(m.modelId)}
                        disabled={disabled || connDisabled || saving}
                        onChange={(e) => toggleModelId(m.modelId, e.target.checked)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-text-main truncate">{m.fullModel}</div>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          <span className="text-[10px] px-1 py-0.5 rounded bg-brand-500/10 text-brand-600 dark:text-brand-400 font-mono">
                            {m.logicalModel}
                          </span>
                          {!m.hubPriced ? (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400">
                              首次保存将自动定价
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-text-muted">
          已选 {selectedLogicalModels.length} 个逻辑模型
          {selectedIds.size !== selectedLogicalModels.length
            ? `（${selectedIds.size} 条模型路径）`
            : ""}
          {selectedLogicalModels.length > 0 ? ` · 借入方：绝对名/逻辑名自动路由，federation: 强制借入` : ""}
        </span>
        <Button size="sm" disabled={disabled || saving} onClick={handleSave}>
          {saving ? "保存中…" : "保存借出模型"}
        </Button>
      </div>
    </div>
  );
}

ExposeModelsPicker.propTypes = {
  initialLogicalModels: PropTypes.arrayOf(PropTypes.string),
  disabled: PropTypes.bool,
  onSave: PropTypes.func,
  saving: PropTypes.bool,
};
