import crypto from "crypto";
import { getSettings, updateSettings } from "@/lib/localDb";

const ENCRYPT_ALGO = "aes-256-gcm";
const ENCRYPT_SALT = "9router-fed-pwd";

function deriveKey() {
  try {
    const { machineIdSync } = require("node-machine-id");
    const raw = machineIdSync();
    return crypto.createHash("sha256").update(raw + ENCRYPT_SALT).digest();
  } catch {
    return crypto.createHash("sha256").update(ENCRYPT_SALT).digest();
  }
}

function encryptSecret(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptSecret(stored) {
  try {
    const [ivHex, tagHex, dataHex] = stored.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex")) + decipher.final("utf8");
  } catch {
    return null;
  }
}

export async function saveHubCredentials({ email, password }) {
  const normalized = email.trim().toLowerCase();
  await updateSettings({
    federationHubEmail: normalized,
    federationHubPasswordEncrypted: encryptSecret(password),
  });
}

export async function loadHubCredentials() {
  const s = await getSettings();
  const email = (s.federationHubEmail || "").trim();
  const password = s.federationHubPasswordEncrypted
    ? decryptSecret(s.federationHubPasswordEncrypted)
    : null;
  if (!email || !password) return null;
  return { email, password };
}

export async function clearHubCredentials() {
  await updateSettings({
    federationHubEmail: "",
    federationHubPasswordEncrypted: "",
  });
}
