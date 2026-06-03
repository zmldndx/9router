const MAX_LEN = 240;

function compact(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").slice(0, MAX_LEN);
  }
  try {
    return JSON.stringify(value).slice(0, MAX_LEN);
  } catch {
    return String(value).slice(0, MAX_LEN);
  }
}

export function fetchErrorDetail(err) {
  if (!err) return {};
  const cause = err.cause;
  return {
    error: err.message,
    code: err.code || cause?.code,
    errno: cause?.errno,
    syscall: cause?.syscall,
    hostname: cause?.hostname,
  };
}

/** 联邦借入/出借诊断日志（控制台 [Federation][tag]） */
export function fedDiag(tag, message, detail) {
  const suffix = detail !== undefined ? ` | ${compact(detail)}` : "";
  console.log(`[Federation][${tag}] ${message}${suffix}`);
}

export function maskEndpoint(url) {
  if (!url) return "(none)";
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return compact(url);
  }
}
