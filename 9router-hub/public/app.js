const $ = (sel) => document.querySelector(sel);

const params = new URLSearchParams(location.search);
let refreshMs = 8000;
let adminToken = params.get("token") || localStorage.getItem("hubAdminToken") || "";

const tokenInput = $("#adminToken");
const tokenWrap = $("#tokenWrap");
if (tokenInput) {
  tokenInput.value = adminToken;
  tokenInput.addEventListener("change", () => {
    adminToken = tokenInput.value.trim();
    localStorage.setItem("hubAdminToken", adminToken);
    tick();
  });
}

function apiHeaders() {
  const h = { Accept: "application/json" };
  if (adminToken) h["X-Admin-Token"] = adminToken;
  return h;
}

async function apiGet(path) {
  const url = adminToken ? `${path}?token=${encodeURIComponent(adminToken)}` : path;
  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? Math.min(2, digits) : 0,
  });
}

function fmtUsd(n) {
  return `$${fmt(n, 4)}`;
}

function fmtTtft(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function ttftClass(ms) {
  if (ms == null) return "ttft-na";
  if (ms < 2000) return "ttft-fast";
  if (ms < 8000) return "ttft-slow";
  return "ttft-slow";
}

function probeSourceLabel(src) {
  const map = {
    startup_probe: "启动",
    join_probe: "接入",
    recovery_probe: "恢复",
    periodic_probe: "周期",
    live: "实盘",
    probe: "探测",
    probe_p50: "探测中位",
    live_p50: "实盘中位",
  };
  return map[src] || src || "—";
}

function modelTable(rows, emptyText) {
  if (!rows?.length) {
    return `<p class="empty">${emptyText}</p>`;
  }
  return `<table>
    <thead><tr>
      <th>模型</th><th class="num">成交</th><th class="num">输入</th><th class="num">缓存</th>
      <th class="num">输出</th><th class="num">总 Token</th><th class="num">creditUSD</th>
    </tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
        <td><code>${r.logicalModel}</code></td>
        <td class="num">${fmt(r.deals)}</td>
        <td class="num">${fmt(r.inputTokens)}</td>
        <td class="num">${fmt(r.cacheTokens)}</td>
        <td class="num">${fmt(r.outputTokens)}</td>
        <td class="num">${fmt(r.totalTokens)}</td>
        <td class="num">${fmtUsd(r.creditUSD)}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function renderOverview(data) {
  const u = data.users;
  const f = data.federation;
  const t = f.tokens;
  $("#panelOverview").innerHTML = `
    <p class="note">已确认成交的借入/借出 Token 为同一笔双边记账；creditUSD 借方支出 = 贷方收入。每 ${refreshMs / 1000}s 自动刷新。</p>
    <div class="kpi-grid">
      <div class="kpi"><div class="label">注册用户</div><div class="value">${fmt(u.registered)}</div><div class="hint">设备 ${fmt(u.devices)} · 在线出借 ${fmt(u.onlineLenders)}</div></div>
      <div class="kpi"><div class="label">确认成交</div><div class="value">${fmt(f.confirmedDeals)}</div><div class="hint">待对账 ${fmt(f.pendingDeals)} · 不一致 ${fmt(f.mismatchDeals)}</div></div>
      <div class="kpi"><div class="label">总 Token</div><div class="value">${fmt(t.total)}</div><div class="hint">in ${fmt(t.input)} · cache ${fmt(t.cache)} · out ${fmt(t.output)}</div></div>
      <div class="kpi"><div class="label">借入 creditUSD</div><div class="value">${fmtUsd(f.borrowCreditUSD)}</div><div class="hint">累计支出</div></div>
      <div class="kpi"><div class="label">借出 creditUSD</div><div class="value">${fmtUsd(f.lendCreditUSD)}</div><div class="hint">累计收入</div></div>
      <div class="kpi"><div class="label">池内余额</div><div class="value">${fmtUsd(f.totalCreditUSDCirculating)}</div><div class="hint">用户 credit 之和</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><h3>借入模型 Top 10（按 Token）</h3>${modelTable(data.topModels.borrow, "暂无借入成交")}</div>
      <div class="card"><h3>借出模型 Top 10（按 Token）</h3>${modelTable(data.topModels.lend, "暂无借出成交")}</div>
    </div>
  `;
}

function renderMarketplace(data) {
  captureMarketplaceExpanded();

  if (data?.error) {
    $("#panelMarketplace").innerHTML = `<p class="empty">${data.error}</p>`;
    return;
  }
  const s = data.summary || {};
  if (!data.models?.length) {
    $("#panelMarketplace").innerHTML = `
      <p class="note">可借模型 = 已开启借出且暴露在 lend-policy 中的逻辑模型。离线/无 Endpoint 会在心跳与探测重试后自动恢复（启动后每 30s 重试至多 12 分钟，之后每 30 分钟周期探测）。</p>
      <p class="empty">当前无可借模型（无用户开启借出或未配置 exposeModels）</p>`;
    return;
  }

  const blocks = data.models
    .map((m) => {
      const priceHint = m.pricing
        ? `in ${m.pricing.priceInputPer1k}/1k · out ${m.pricing.priceOutputPer1k}/1k`
        : "未定价";
      const lenderRows = m.lenders
        .map((l) => {
          const statusBadge = l.canLendNow
            ? `<span class="badge ok">${l.statusLabel || "可调度"}</span>`
            : `<span class="badge ${l.statusKey === "offline" ? "err" : "warn"}">${l.statusLabel || (l.online ? "不可调度" : "离线")}</span>`;
          const slaBadge =
            l.liveFailRate >= 0.35
              ? `<span class="badge err">SLA ${Math.round(l.liveFailRate * 100)}% 失败</span>`
              : l.liveSamples >= 10
                ? `<span class="badge ok">SLA OK</span>`
                : `<span class="badge">样本 ${l.liveSamples}</span>`;
          const probeHint = l.probe
            ? `探测 ${probeSourceLabel(l.probe.source)} · ${l.probe.at ? new Date(l.probe.at).toLocaleString("zh-CN") : "—"} · ${l.probe.ok ? "成功" : "失败"}`
            : "尚无探测记录";
          return `<tr class="lender-row">
            <td>
              <div>${l.email}</div>
              <div class="sub">用户 ID <code>${l.userId}</code></div>
              <div class="sub">deviceId <code class="break-all">${l.deviceId}</code></div>
              ${l.deviceLabel ? `<div class="sub">${l.deviceLabel}</div>` : ""}
              <div class="sub">${probeHint}</div>
            </td>
            <td>${statusBadge} ${slaBadge}</td>
            <td class="num ${ttftClass(l.ttftMs)}">${fmtTtft(l.ttftMs)}</td>
            <td>${probeSourceLabel(l.ttftSource)}</td>
            <td class="sub">${l.endpointUrl ? l.endpointUrl.replace(/^https?:\/\//, "").slice(0, 40) : "—"}</td>
          </tr>`;
        })
        .join("");

      return `<article class="market-model" data-model="${m.logicalModel}">
        <div class="market-model-head" role="button" tabindex="0">
          <code>${m.logicalModel}</code>
          <div class="market-badges">
            <span class="badge ok">${fmt(m.schedulableLenderCount)} 可借</span>
            <span class="badge">${fmt(m.onlineLenderCount)} 在线 / ${fmt(m.lenderCount)} 出借方</span>
            <span class="badge ${m.medianTtftMs != null ? "ok" : ""}">中位 TTFT ${fmtTtft(m.medianTtftMs)}</span>
            <span class="badge">${priceHint}</span>
          </div>
        </div>
        <div class="market-lenders">
          <table>
            <thead><tr>
              <th>借出方</th><th>状态</th><th class="num">TTFT</th><th>来源</th><th>Endpoint</th>
            </tr></thead>
            <tbody>${lenderRows}</tbody>
          </table>
        </div>
      </article>`;
    })
    .join("");

  $("#panelMarketplace").innerHTML = `
    <p class="note">共 ${fmt(s.modelCount)} 个可借逻辑模型 · ${fmt(s.schedulableOffers)} 条可调度供给 · ${fmt(s.lenderDeviceCount)} 台借出设备。点击模型行展开各借出方能力与 TTFT（探测在出借节点启动/接入 Hub/恢复后执行）。</p>
    <div class="kpi-grid">
      <div class="kpi"><div class="label">可借模型</div><div class="value">${fmt(s.modelCount)}</div></div>
      <div class="kpi"><div class="label">可调度供给</div><div class="value">${fmt(s.schedulableOffers)}</div><div class="hint">在线+有 endpoint+SLA 允许</div></div>
      <div class="kpi"><div class="label">借出设备</div><div class="value">${fmt(s.lenderDeviceCount)}</div></div>
    </div>
    ${blocks}
  `;

  restoreMarketplaceExpanded();
}

function renderUsers(data) {
  if (!data.users?.length) {
    $("#panelUsers").innerHTML = `<p class="empty">暂无注册用户</p>`;
    return;
  }
  $("#panelUsers").innerHTML = data.users
    .map((user) => {
      const lendable =
        user.lendableModels?.length
          ? user.lendableModels.map((m) => `<span class="chip">${m}</span>`).join("")
          : `<span class="chip off">未暴露可借模型</span>`;
      const devices =
        user.devices
          ?.map(
            (d) =>
              `<div class="device-block ${d.online ? "" : "off"}">
                <code class="device-id">${d.deviceId}</code>
                <span class="device-tags">${d.lendEnabled ? "出借 " : ""}${d.borrowEnabled ? "借入 " : ""}${d.online ? "在线" : "离线"}${d.endpointUrl ? "" : " · 无 endpoint"}</span>
              </div>`
          )
          .join("") || "";
      return `<article class="user-card">
        <div class="user-head">
          <div>
            <div class="email">${user.email}</div>
            <div class="muted" style="font-size:0.75rem">用户 ID <code>${user.userId}</code></div>
          </div>
          <div class="credit">余额 ${fmtUsd(user.creditUSD)}</div>
        </div>
        <div class="chips"><span class="muted" style="font-size:0.7rem;margin-right:0.25rem">可借模型</span>${lendable}</div>
        <div class="device-list">${devices || '<span class="muted" style="font-size:0.75rem">无设备</span>'}</div>
        <div class="user-body">
          <div class="kpi-grid" style="margin:0">
            <div class="kpi"><div class="label">借入 Token</div><div class="value">${fmt(user.totals.borrowTokens)}</div><div class="hint">${fmtUsd(user.totals.borrowCreditUSD)}</div></div>
            <div class="kpi"><div class="label">借出 Token</div><div class="value">${fmt(user.totals.lendTokens)}</div><div class="hint">${fmtUsd(user.totals.lendCreditUSD)}</div></div>
          </div>
          <div class="mini-grid">
            <div class="card"><h3>已借入 · 按模型</h3>${modelTable(user.borrowedByModel, "无借入记录")}</div>
            <div class="card"><h3>已借出 · 按模型</h3>${modelTable(user.lentByModel, "无借出记录")}</div>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

let activeTab = "overview";
/** 可借模型 Tab：用户已展开的 logicalModel，刷新时保留 */
const expandedMarketModels = new Set();

function captureMarketplaceExpanded() {
  const panel = $("#panelMarketplace");
  if (!panel) return;
  panel.querySelectorAll(".market-model.open").forEach((el) => {
    const model = el.dataset.model;
    if (model) expandedMarketModels.add(model);
  });
}

function restoreMarketplaceExpanded() {
  const panel = $("#panelMarketplace");
  if (!panel) return;
  for (const model of expandedMarketModels) {
    const el = panel.querySelector(
      `.market-model[data-model="${CSS.escape(model)}"]`
    );
    if (el) el.classList.add("open");
    else expandedMarketModels.delete(model);
  }
}

const panelMarketplace = $("#panelMarketplace");
if (panelMarketplace) {
  panelMarketplace.addEventListener("click", (e) => {
    const head = e.target.closest(".market-model-head");
    if (!head) return;
    const article = head.closest(".market-model");
    const model = article?.dataset.model;
    if (!model) return;
    article.classList.toggle("open");
    if (article.classList.contains("open")) expandedMarketModels.add(model);
    else expandedMarketModels.delete(model);
  });
  panelMarketplace.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const head = e.target.closest(".market-model-head");
    if (!head) return;
    e.preventDefault();
    head.click();
  });
}

const PANEL_IDS = {
  overview: "panelOverview",
  marketplace: "panelMarketplace",
  users: "panelUsers",
};

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    activeTab = btn.dataset.tab;
    $(`#${PANEL_IDS[activeTab] || "panelOverview"}`).classList.add("active");
    tick();
  });
});

async function loadMarketplace() {
  try {
    return await apiGet("/v1/admin/marketplace");
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes("Not Found") || msg.includes("404")) {
      return {
        error:
          "marketplace API 不可用（404）。请重启 Hub：在 9router-hub 目录执行 npm start，确保已加载 /v1/admin/marketplace 路由。",
      };
    }
    return { error: msg };
  }
}

async function tick() {
  const pill = $("#statusPill");
  try {
    const cfg = await apiGet("/v1/admin/config").catch(() => ({ refreshIntervalMs: 8000 }));
    refreshMs = cfg.refreshIntervalMs || 8000;

    const dash = await apiGet("/v1/admin/dashboard");

    if (activeTab === "overview") renderOverview(dash);
    if (activeTab === "users") {
      const users = await apiGet("/v1/admin/users");
      renderUsers(users);
    }
    if (activeTab === "marketplace") {
      const marketplace = await loadMarketplace();
      renderMarketplace(marketplace);
    }

    const ts = dash.generatedAt;
    $("#lastUpdated").textContent = `更新于 ${ts ? new Date(ts).toLocaleString("zh-CN") : "—"} · ${refreshMs / 1000}s`;
    pill.textContent = "已连接";
    pill.className = "pill ok";
    if (tokenWrap) tokenWrap.hidden = !adminToken;
  } catch (e) {
    pill.textContent = e.message;
    pill.className = "pill err";
    if (tokenWrap) tokenWrap.hidden = false;
    if (e.message.includes("admin token") || e.message.includes("401")) {
      const panel = $(`#${PANEL_IDS[activeTab]}`);
      if (panel) {
        panel.innerHTML = `<p class="empty">请设置 Admin Token（环境变量 HUB_ADMIN_TOKEN）后刷新</p>`;
      }
    }
  }
}

let pollTimer = null;
function schedulePoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(tick, refreshMs);
}

tick().then(schedulePoll);
