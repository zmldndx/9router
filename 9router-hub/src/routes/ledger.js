import { Router } from "express";
import { requireHubAuth } from "../middleware/auth.js";
import { submitLedgerReport, listLedgerEvents } from "../services/ledger.js";

export const ledgerRouter = Router();

ledgerRouter.post("/report", requireHubAuth, (req, res) => {
  try {
    const reporterDeviceId = req.headers["x-device-id"] || req.body?.reporterDeviceId;
    if (!reporterDeviceId) {
      return res.status(400).json({ error: "x-device-id header or reporterDeviceId required" });
    }
    const result = submitLedgerReport(reporterDeviceId, req.body || {});
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

ledgerRouter.get("/events", requireHubAuth, (req, res) => {
  const days = Number(req.query.days || 7);
  const limit = Number(req.query.limit || 100);
  res.json({ events: listLedgerEvents(req.userId, { days, limit }) });
});
