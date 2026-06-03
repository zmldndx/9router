import { Router } from "express";
import { listPricedModels } from "../services/pricing.js";

export const pricingRouter = Router();

pricingRouter.get("/models", (_req, res) => {
  res.json({ models: listPricedModels() });
});
