import { randomUUID } from "node:crypto";

export function newId(prefix = "") {
  const id = randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${id.slice(0, 12)}` : id;
}

export function nowIso() {
  return new Date().toISOString();
}
