import { Router } from "express";
import { requireHubAuth } from "../middleware/auth.js";
import {
  registerDevice,
  heartbeatDevice,
  updateLendPolicy,
  updateBorrowPolicy,
  listUserDevices,
} from "../services/devices.js";
import { getDeviceSla } from "../services/sla.js";
import { issueLendProbeTokens } from "../services/lendProbe.js";

export const devicesRouter = Router();
devicesRouter.use(requireHubAuth);

devicesRouter.post("/register", (req, res) => {
  try {
    const { deviceId, deviceLabel, endpointUrl } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });
    const device = registerDevice(req.userId, { deviceId, deviceLabel, endpointUrl });
    res.status(201).json({ device });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

devicesRouter.post("/heartbeat", (req, res) => {
  try {
    const { deviceId, endpointUrl } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });
    const device = heartbeatDevice(req.userId, { deviceId, endpointUrl });
    res.json({ device });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

devicesRouter.put("/:deviceId/lend-policy", (req, res) => {
  try {
    const device = updateLendPolicy(req.userId, req.params.deviceId, req.body || {});
    res.json({ device });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

devicesRouter.put("/:deviceId/borrow-policy", (req, res) => {
  try {
    const device = updateBorrowPolicy(req.userId, req.params.deviceId, req.body || {});
    res.json({ device });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

devicesRouter.get("/mine", (req, res) => {
  res.json({ devices: listUserDevices(req.userId) });
});

devicesRouter.post("/:deviceId/lend-probe", async (req, res) => {
  try {
    const { logicalModels } = req.body || {};
    const result = await issueLendProbeTokens(req.userId, req.params.deviceId, logicalModels);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

devicesRouter.get("/:deviceId/sla", (req, res) => {
  const model = req.query.logicalModel;
  if (!model) return res.status(400).json({ error: "logicalModel query required" });
  res.json(getDeviceSla(req.params.deviceId, model));
});
