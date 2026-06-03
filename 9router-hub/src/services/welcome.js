import { getDb } from "../db/index.js";
import { WELCOME_USD } from "../config.js";
import { newId, nowIso } from "../utils/ids.js";

export function grantWelcomeIfNeeded(userId, identityKey) {
  if (!identityKey) return { granted: false };
  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM welcome_grants WHERE identity_key = ?`)
    .get(identityKey);
  if (existing) return { granted: false };

  const id = newId("wg");
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO welcome_grants(id, user_id, identity_key, amount_usd, granted_at) VALUES (?, ?, ?, ?, ?)`
    ).run(id, userId, identityKey, WELCOME_USD, now);
    db.prepare(`UPDATE users SET credit_usd = credit_usd + ? WHERE id = ?`).run(
      WELCOME_USD,
      userId
    );
  })();
  return { granted: true, amountUsd: WELCOME_USD };
}
