import { buildModelsList } from "@/app/api/v1/models/route.js";
import { getProviderConnections, getModelAliases } from "@/lib/localDb";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import {
  getConnectionOutputAlias,
  summarizeConnectionsForAlias,
} from "@/lib/providers/connectionStatus";

const LLM_KIND = "llm";

function providerMeta(ownedBy) {
  const p = AI_PROVIDERS[ownedBy] || Object.values(AI_PROVIDERS).find((x) => x.alias === ownedBy);
  if (p) {
    return {
      providerId: p.id,
      name: p.name,
      icon: p.icon || "dns",
      color: p.color || "#64748b",
    };
  }
  return {
    providerId: ownedBy,
    name: ownedBy,
    icon: "dns",
    color: "#64748b",
  };
}

function connectionStatusLabel(summary) {
  if (summary.total === 0) return { key: "none", label: "未连接" };
  if (summary.allInactive) return { key: "disabled", label: "已禁用" };
  if (summary.hasUsable) {
    const extra =
      summary.error > 0 ? ` · ${summary.usable} 可用 / ${summary.error} 异常` : "";
    return { key: "connected", label: `已连接${extra}` };
  }
  if (summary.error > 0) return { key: "error", label: `${summary.error} 个连接异常` };
  return { key: "pending", label: "已添加待验证" };
}

/** modelAliases: alias → fullModel（provider/model） */
function buildFullModelToAlias(modelAliases) {
  const map = {};
  for (const [alias, fullModel] of Object.entries(modelAliases || {})) {
    if (typeof fullModel !== "string" || !fullModel.trim()) continue;
    if (typeof alias === "string" && alias.trim()) {
      map[fullModel.trim()] = alias.trim();
    }
  }
  return map;
}

function resolveLogicalModel(modelId, fullModelToAlias) {
  const alias = fullModelToAlias[modelId];
  if (alias) return alias;
  const slash = modelId.indexOf("/");
  if (slash >= 0) {
    return modelId.slice(slash + 1);
  }
  return modelId;
}

/**
 * 按已连接供应商分组的 LLM 模型目录（供联邦借出勾选）
 */
export async function buildFederationLendCatalog() {
  const [models, connections, modelAliases] = await Promise.all([
    buildModelsList([LLM_KIND]),
    getProviderConnections(),
    getModelAliases(),
  ]);
  const fullModelToAlias = buildFullModelToAlias(modelAliases);

  const groups = new Map();

  for (const m of models) {
    if (!m?.id) continue;
    const ownedBy = m.owned_by || "unknown";
    const isCombo = ownedBy === "combo";
    const providerId = isCombo ? `combo:${m.id}` : ownedBy;
    const logicalModel = isCombo ? m.id : resolveLogicalModel(m.id, fullModelToAlias);

    if (!groups.has(providerId)) {
      const meta = isCombo
        ? { providerId, name: `Combo · ${m.id}`, icon: "layers", color: "#8b5cf6" }
        : providerMeta(ownedBy);
      const connSummary = isCombo
        ? { total: 1, usable: 1, error: 0, inactive: 0, hasUsable: true, allInactive: false }
        : summarizeConnectionsForAlias(connections, ownedBy);
      const status = isCombo
        ? { key: "connected", label: "Combo" }
        : connectionStatusLabel(connSummary);
      groups.set(providerId, {
        ...meta,
        isCombo,
        outputAlias: ownedBy,
        hasActiveConnection: connSummary.hasUsable,
        connectionStatus: status.key,
        connectionLabel: status.label,
        connectionSummary: connSummary,
        models: [],
      });
    }

    const g = groups.get(providerId);
    g.models.push({
      modelId: m.id,
      fullModel: m.id,
      logicalModel,
      displayName: m.id,
      kind: m.kind,
    });
  }

  const providers = [...groups.values()]
    .filter((p) => p.models.length > 0)
    .sort((a, b) => {
      if (a.hasActiveConnection !== b.hasActiveConnection) {
        return a.hasActiveConnection ? -1 : 1;
      }
      return a.name.localeCompare(b.name, "zh-CN");
    });

  for (const p of providers) {
    p.models.sort((a, b) => a.logicalModel.localeCompare(b.logicalModel, "zh-CN"));
  }

  const activeConnectionCount = providers.filter(
    (p) => p.hasActiveConnection && !p.isCombo
  ).length;

  return {
    providers,
    activeConnectionCount,
  };
}

/**
 * 将客户端 model 解析为绝对名 + 逻辑名（先 fullModel 精确匹配，再 logicalModel）。
 * @returns {{ fullModel: string|null, logicalModel: string } | null}
 */
export async function lookupFederationModelIdentity(modelStr) {
  const trimmed = (modelStr || "").trim();
  if (!trimmed) return null;

  const modelAliases = await getModelAliases();
  const fullToAlias = buildFullModelToAlias(modelAliases);
  const catalog = await buildFederationLendCatalog();

  for (const p of catalog.providers) {
    for (const m of p.models) {
      if (m.fullModel === trimmed || m.modelId === trimmed) {
        return { fullModel: m.fullModel, logicalModel: m.logicalModel };
      }
    }
  }

  const logicalMatches = [];
  for (const p of catalog.providers) {
    for (const m of p.models) {
      if (m.logicalModel === trimmed) {
        logicalMatches.push({
          fullModel: m.fullModel,
          logicalModel: m.logicalModel,
          hasActiveConnection: !!p.hasActiveConnection,
        });
      }
    }
  }
  if (logicalMatches.length) {
    logicalMatches.sort((a, b) => (b.hasActiveConnection ? 1 : 0) - (a.hasActiveConnection ? 1 : 0));
    const best = logicalMatches[0];
    return { fullModel: best.fullModel, logicalModel: best.logicalModel };
  }

  const aliasTarget = modelAliases[trimmed];
  if (typeof aliasTarget === "string" && aliasTarget.trim()) {
    const full = aliasTarget.trim();
    return {
      fullModel: full,
      logicalModel: resolveLogicalModel(full, fullToAlias),
    };
  }

  if (trimmed.includes("/")) {
    return {
      fullModel: trimmed,
      logicalModel: resolveLogicalModel(trimmed, fullToAlias),
    };
  }

  return { fullModel: null, logicalModel: trimmed };
}

/** 借出时：逻辑模型 → 本机实际上游 modelId（如 ag/gemini-3-flash）；多匹配时优先已连接供应商 */
export async function resolveUpstreamModelForLogical(logicalModel) {
  const cat = await buildFederationLendCatalog();
  const matches = [];
  for (const p of cat.providers) {
    for (const m of p.models) {
      if (m.logicalModel === logicalModel) {
        matches.push({ fullModel: m.fullModel, hasActiveConnection: !!p.hasActiveConnection });
      }
    }
  }
  if (matches.length) {
    matches.sort((a, b) => (b.hasActiveConnection ? 1 : 0) - (a.hasActiveConnection ? 1 : 0));
    return matches[0].fullModel;
  }
  return logicalModel;
}
