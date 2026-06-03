import { Router } from "express";
import { requireHubAuth } from "../middleware/auth.js";
import { recordSlaSample } from "../services/sla.js";

export const metricsRouter = Router();
metricsRouter.use(requireHubAuth);

metricsRouter.post("/federation", (req, res) => {
  try {
    const { deviceId, logicalModel, requestId, ttftMs, tps, ok, source } = req.body || {};
    if (!deviceId || !logicalModel) {
      return res.status(400).json({ error: "deviceId and logicalModel required" });
    }
    const result = recordSlaSample({
      deviceId,
      logicalModel,
      requestId,
      ttftMs,
      tps,
      ok: ok !== false,
      source,
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
