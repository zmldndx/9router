import { Router } from "express";
import { getDeviceBindStatus } from "../services/devices.js";

export const devicesPublicRouter = Router();

/** 无需登录：查询 device 是否已绑定邮箱（一 device 一账号） */
devicesPublicRouter.get("/bind-status", (req, res) => {
  const deviceId = req.query.deviceId;
  if (!deviceId || typeof deviceId !== "string") {
    return res.status(400).json({ error: "deviceId query required" });
  }
  res.json(getDeviceBindStatus(deviceId.trim()));
});
