import { getDb } from "../db/index.js";
import { nowIso } from "../utils/ids.js";
import { isDeviceOnline } from "./devices.js";

function parseJsonArray(raw) {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function rowTokens(row) {
  const input = row.input_tokens || 0;
  const cache = row.cache_tokens || 0;
  const output = row.output_tokens || 0;
  return {
    inputTokens: input,
    cacheTokens: cache,
    outputTokens: output,
    totalTokens: input + cache + output,
  };
}

function aggregateTop10(rows, role) {
  const map = new Map();
  for (const row of rows) {
    const model = row.logical_model;
    const t = rowTokens(row);
    const credit = row.charge_usd || 0;
    if (!map.has(model)) {
      map.set(model, {
        logicalModel: model,
        deals: 0,
        inputTokens: 0,
        cacheTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        creditUSD: 0,
        role,
      });
    }
    const e = map.get(model);
    e.deals += 1;
    e.inputTokens += t.inputTokens;
    e.cacheTokens += t.cacheTokens;
    e.outputTokens += t.outputTokens;
    e.totalTokens += t.totalTokens;
    e.creditUSD = Math.round((e.creditUSD + credit) * 1e6) / 1e6;
  }
  return [...map.values()]
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 10);
}

export function getDashboardOverview() {
  const db = getDb();
  const generatedAt = nowIso();

  const users = db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c;
  const devices = db.prepare(`SELECT COUNT(*) AS c FROM devices`).get().c;
  const onlineDevices = db
    .prepare(`SELECT device_id, last_seen_at FROM devices WHERE lend_enabled = 1`)
    .all()
    .filter((d) => isDeviceOnline(d.last_seen_at)).length;

  const confirmed = db
    .prepare(
      `SELECT logical_model, input_tokens, cache_tokens, output_tokens, charge_usd,
              borrower_device_id, lender_device_id
       FROM federation_ledger WHERE settlement_status = 'confirmed'`
    )
    .all();

  let totalInput = 0;
  let totalCache = 0;
  let totalOutput = 0;
  let totalCreditUSD = 0;
  for (const row of confirmed) {
    totalInput += row.input_tokens || 0;
    totalCache += row.cache_tokens || 0;
    totalOutput += row.output_tokens || 0;
    totalCreditUSD += row.charge_usd || 0;
  }
  totalCreditUSD = Math.round(totalCreditUSD * 1e6) / 1e6;

  const pending = db
    .prepare(`SELECT COUNT(*) AS c FROM federation_ledger WHERE settlement_status = 'pending'`)
    .get().c;
  const mismatch = db
    .prepare(`SELECT COUNT(*) AS c FROM federation_ledger WHERE settlement_status = 'mismatch'`)
    .get().c;

  const totalCreditPool = db.prepare(`SELECT SUM(credit_usd) AS s FROM users`).get().s || 0;

  return {
    generatedAt,
    users: { registered: users, devices, onlineLenders: onlineDevices },
    federation: {
      confirmedDeals: confirmed.length,
      pendingDeals: pending,
      mismatchDeals: mismatch,
      tokens: {
        input: totalInput,
        cache: totalCache,
        output: totalOutput,
        total: totalInput + totalCache + totalOutput,
      },
      /** 借方累计支出 = 贷方累计收入（同一批 confirmed 成交） */
      borrowCreditUSD: totalCreditUSD,
      lendCreditUSD: totalCreditUSD,
      totalCreditUSDCirculating: Math.round(totalCreditPool * 1e4) / 1e4,
    },
    topModels: {
      borrow: aggregateTop10(confirmed, "borrow"),
      lend: aggregateTop10(confirmed, "lend"),
    },
  };
}

export function getUserFederationBreakdown(userId) {
  const db = getDb();

  const borrowRows = db
    .prepare(
      `SELECT fl.logical_model,
              SUM(fl.input_tokens) AS input_tokens,
              SUM(fl.cache_tokens) AS cache_tokens,
              SUM(fl.output_tokens) AS output_tokens,
              SUM(fl.charge_usd) AS credit_usd,
              COUNT(*) AS deals
       FROM federation_ledger fl
       JOIN devices d ON d.device_id = fl.borrower_device_id
       WHERE fl.settlement_status = 'confirmed' AND d.user_id = ?
       GROUP BY fl.logical_model`
    )
    .all(userId);

  const lendRows = db
    .prepare(
      `SELECT fl.logical_model,
              SUM(fl.input_tokens) AS input_tokens,
              SUM(fl.cache_tokens) AS cache_tokens,
              SUM(fl.output_tokens) AS output_tokens,
              SUM(fl.charge_usd) AS credit_usd,
              COUNT(*) AS deals
       FROM federation_ledger fl
       JOIN devices d ON d.device_id = fl.lender_device_id
       WHERE fl.settlement_status = 'confirmed' AND d.user_id = ?
       GROUP BY fl.logical_model`
    )
    .all(userId);

  function mapRows(rows) {
    return rows.map((row) => {
      const t = rowTokens(row);
      return {
        logicalModel: row.logical_model,
        deals: row.deals,
        ...t,
        creditUSD: Math.round((row.credit_usd || 0) * 1e6) / 1e6,
      };
    });
  }

  const borrowedByModel = mapRows(borrowRows).sort((a, b) => b.totalTokens - a.totalTokens);
  const lentByModel = mapRows(lendRows).sort((a, b) => b.totalTokens - a.totalTokens);

  const deviceRows = db
    .prepare(
      `SELECT lend_enabled, expose_models, lend_allowed FROM devices WHERE user_id = ?`
    )
    .all(userId);

  const lendableSet = new Set();
  for (const d of deviceRows) {
    const expose = parseJsonArray(d.expose_models);
    let lendAllowed = {};
    try {
      lendAllowed = JSON.parse(d.lend_allowed || "{}");
    } catch {
      lendAllowed = {};
    }
    if (d.lend_enabled) {
      for (const m of expose) {
        if (lendAllowed[m] !== false) lendableSet.add(m);
      }
    }
  }

  const sumTokens = (list) => list.reduce((s, x) => s + x.totalTokens, 0);
  const sumCredit = (list) => list.reduce((s, x) => s + x.creditUSD, 0);

  return {
    lendableModels: [...lendableSet].sort(),
    totals: {
      borrowTokens: sumTokens(borrowedByModel),
      lendTokens: sumTokens(lentByModel),
      borrowCreditUSD: Math.round(sumCredit(borrowedByModel) * 1e6) / 1e6,
      lendCreditUSD: Math.round(sumCredit(lentByModel) * 1e6) / 1e6,
    },
    topModels: {
      borrow: borrowedByModel.slice(0, 10),
      lend: lentByModel.slice(0, 10),
    },
    allModels: {
      borrow: borrowedByModel,
      lend: lentByModel,
    },
  };
}

export function getUsersAnalytics() {
  const db = getDb();
  const generatedAt = nowIso();

  const users = db
    .prepare(`SELECT id, email, credit_usd, created_at FROM users ORDER BY created_at ASC`)
    .all();

  const borrowByUser = db
    .prepare(
      `SELECT u.id AS user_id, fl.logical_model,
              SUM(fl.input_tokens) AS input_tokens,
              SUM(fl.cache_tokens) AS cache_tokens,
              SUM(fl.output_tokens) AS output_tokens,
              SUM(fl.charge_usd) AS credit_usd,
              COUNT(*) AS deals
       FROM federation_ledger fl
       JOIN devices d ON d.device_id = fl.borrower_device_id
       JOIN users u ON u.id = d.user_id
       WHERE fl.settlement_status = 'confirmed'
       GROUP BY u.id, fl.logical_model`
    )
    .all();

  const lendByUser = db
    .prepare(
      `SELECT u.id AS user_id, fl.logical_model,
              SUM(fl.input_tokens) AS input_tokens,
              SUM(fl.cache_tokens) AS cache_tokens,
              SUM(fl.output_tokens) AS output_tokens,
              SUM(fl.charge_usd) AS credit_usd,
              COUNT(*) AS deals
       FROM federation_ledger fl
       JOIN devices d ON d.device_id = fl.lender_device_id
       JOIN users u ON u.id = d.user_id
       WHERE fl.settlement_status = 'confirmed'
       GROUP BY u.id, fl.logical_model`
    )
    .all();

  const deviceRows = db
    .prepare(
      `SELECT user_id, device_id, device_label, lend_enabled, borrow_enabled, expose_models, lend_allowed, last_seen_at, endpoint_url
       FROM devices`
    )
    .all();

  const borrowMap = new Map();
  for (const row of borrowByUser) {
    if (!borrowMap.has(row.user_id)) borrowMap.set(row.user_id, new Map());
    borrowMap.get(row.user_id).set(row.logical_model, {
      logicalModel: row.logical_model,
      deals: row.deals,
      ...rowTokens(row),
      creditUSD: Math.round((row.credit_usd || 0) * 1e6) / 1e6,
    });
  }

  const lendMap = new Map();
  for (const row of lendByUser) {
    if (!lendMap.has(row.user_id)) lendMap.set(row.user_id, new Map());
    lendMap.get(row.user_id).set(row.logical_model, {
      logicalModel: row.logical_model,
      deals: row.deals,
      ...rowTokens(row),
      creditUSD: Math.round((row.credit_usd || 0) * 1e6) / 1e6,
    });
  }

  const devicesByUser = new Map();
  for (const d of deviceRows) {
    if (!devicesByUser.has(d.user_id)) devicesByUser.set(d.user_id, []);
    const expose = parseJsonArray(d.expose_models);
    let lendAllowed = {};
    try {
      lendAllowed = JSON.parse(d.lend_allowed || "{}");
    } catch {
      lendAllowed = {};
    }
    const lendableModels = d.lend_enabled
      ? expose.filter((m) => lendAllowed[m] !== false)
      : [];
    devicesByUser.get(d.user_id).push({
      deviceId: d.device_id,
      deviceLabel: d.device_label,
      lendEnabled: !!d.lend_enabled,
      borrowEnabled: !!d.borrow_enabled,
      online: isDeviceOnline(d.last_seen_at),
      endpointUrl: d.endpoint_url,
      exposeModels: expose,
      lendableModels,
    });
  }

  return {
    generatedAt,
    users: users.map((u) => {
      const borrowed = [...(borrowMap.get(u.id)?.values() || [])].sort(
        (a, b) => b.totalTokens - a.totalTokens
      );
      const lent = [...(lendMap.get(u.id)?.values() || [])].sort(
        (a, b) => b.totalTokens - a.totalTokens
      );
      const lendableSet = new Set();
      for (const dev of devicesByUser.get(u.id) || []) {
        for (const m of dev.lendableModels) lendableSet.add(m);
      }
      const borrowTotal = borrowed.reduce((s, x) => s + x.totalTokens, 0);
      const lendTotal = lent.reduce((s, x) => s + x.totalTokens, 0);
      const borrowCredit = borrowed.reduce((s, x) => s + x.creditUSD, 0);
      const lendCredit = lent.reduce((s, x) => s + x.creditUSD, 0);

      return {
        userId: u.id,
        email: u.email,
        creditUSD: Math.round((u.credit_usd || 0) * 1e4) / 1e4,
        createdAt: u.created_at,
        devices: devicesByUser.get(u.id) || [],
        lendableModels: [...lendableSet].sort(),
        borrowedByModel: borrowed,
        lentByModel: lent,
        totals: {
          borrowTokens: borrowTotal,
          lendTokens: lendTotal,
          borrowCreditUSD: Math.round(borrowCredit * 1e6) / 1e6,
          lendCreditUSD: Math.round(lendCredit * 1e6) / 1e6,
        },
      };
    }),
  };
}
