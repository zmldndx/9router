import { Router } from "express";
import { requireAdminAccess } from "../middleware/adminAuth.js";
import { getDashboardOverview, getUsersAnalytics } from "../services/analytics.js";
import { getMarketplaceCatalog } from "../services/marketplace.js";
import { UI_REFRESH_MS } from "../config.js";

export const adminRouter = Router();
adminRouter.use(requireAdminAccess);

adminRouter.get("/dashboard", (_req, res) => {
  res.json(getDashboardOverview());
});

adminRouter.get("/users", (_req, res) => {
  res.json(getUsersAnalytics());
});

adminRouter.get("/marketplace", (_req, res) => {
  res.json(getMarketplaceCatalog());
});

adminRouter.get("/config", (_req, res) => {
  res.json({ refreshIntervalMs: UI_REFRESH_MS });
});
