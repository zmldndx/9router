import bcrypt from "bcryptjs";
import { getDb } from "../db/index.js";
import { newId, nowIso } from "../utils/ids.js";
import { signHubAccessToken } from "../utils/tokens.js";
import { grantWelcomeIfNeeded } from "./welcome.js";

export async function registerUser({ email, password, identityKey }) {
  const db = getDb();
  const normalized = email.trim().toLowerCase();
  const exists = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalized);
  if (exists) {
    const err = new Error("Email already registered");
    err.status = 409;
    throw err;
  }
  const id = newId("u");
  const hash = bcrypt.hashSync(password, 10);
  const now = nowIso();
  db.prepare(
    `INSERT INTO users(id, email, password_hash, credit_usd, identity_key, created_at) VALUES (?, ?, ?, 0, ?, ?)`
  ).run(id, normalized, hash, identityKey || null, now);

  grantWelcomeIfNeeded(id, identityKey || normalized);

  return await issueTokenForUser(id, normalized);
}

export async function loginUser({ email, password }) {
  const db = getDb();
  const normalized = email.trim().toLowerCase();
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalized);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    const err = new Error("Invalid credentials");
    err.status = 401;
    throw err;
  }
  return await issueTokenForUser(user.id, user.email);
}

async function issueTokenForUser(userId, email) {
  const accessToken = await signHubAccessToken({ sub: userId, email });
  const db = getDb();
  const user = db.prepare(`SELECT credit_usd FROM users WHERE id = ?`).get(userId);
  return {
    userId,
    email,
    accessToken,
    creditUSD: user?.credit_usd ?? 0,
  };
}

export function getUserById(userId) {
  return getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
}
