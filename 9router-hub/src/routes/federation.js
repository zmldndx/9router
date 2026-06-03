import { Router } from "express";
import { requireHubAuth } from "../middleware/auth.js";
import {
  createSchedule,
  refreshSchedule,
  getFallbackRoutes,
} from "../services/federation.js";

export const federationRouter = Router();
federationRouter.use(requireHubAuth);

federationRouter.post("/schedule", async (req, res) => {
  try {
    const { logicalModel, borrowerDeviceId } = req.body || {};
    if (!logicalModel || !borrowerDeviceId) {
      return res.status(400).json({ error: "logicalModel and borrowerDeviceId required" });
    }
    const result = await createSchedule(req.userId, { logicalModel, borrowerDeviceId });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

federationRouter.post("/schedule/refresh", async (req, res) => {
  try {
    const { requestId, logicalModel, lenderDeviceId } = req.body || {};
    if (!requestId) return res.status(400).json({ error: "requestId required" });
    const result = await refreshSchedule(req.userId, { requestId, logicalModel, lenderDeviceId });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

federationRouter.get("/fallback-routes", (req, res) => {
  const logicalModel = req.query.logicalModel;
  if (!logicalModel) return res.status(400).json({ error: "logicalModel required" });
  res.json({ logicalModel, routes: getFallbackRoutes(logicalModel) });
});
