/** Hub lend-probe 借入方占位（与 9router-hub lendProbe.js 一致） */
export const FEDERATION_PROBE_BORROWER_ID = "probe:hub";

/** 探活 / 探测请求：不参与 federation 对账 JSONL 与 ledger/report */
export function isFederationProbeRequest(ctx = {}) {
  const { requestId, borrowerDeviceId, source } = ctx;
  const borrower = String(borrowerDeviceId || "");
  if (borrower === FEDERATION_PROBE_BORROWER_ID || borrower.startsWith("probe:")) {
    return true;
  }
  const rid = String(requestId || "");
  if (rid.startsWith("probe_")) return true;
  if (source && source !== "live") {
    if (source === "recovery_probe" || source.endsWith("_probe")) return true;
  }
  return false;
}
