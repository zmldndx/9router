import { Router } from "express";
import { requireHubAuth } from "../middleware/auth.js";
import { buildUserSummary } from "../services/federation.js";
import { listLedgerEvents } from "../services/ledger.js";

export const meRouter = Router();
meRouter.use(requireHubAuth);

meRouter.get("/summary", (req, res) => {
  const thisDeviceId = req.headers["x-device-id"] || req.query.deviceId || null;
  const summary = buildUserSummary(req.userId, thisDeviceId);
  summary.recentLedger = listLedgerEvents(req.userId, { days: 7, limit: 20 });
  res.json(summary);
});
