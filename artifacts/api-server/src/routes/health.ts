import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { providerReadiness } from "../lib/providers";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", (_req, res) => {
  const market = _req.get("x-leadsprint-market") === "IN" ? "IN" : "US";
  const providers = providerReadiness(market);
  const demoAuth =
    process.env["LEADSPRINT_DEMO_AUTH"]?.trim().toLowerCase() === "true" &&
    process.env["NODE_ENV"] !== "production";
  res.json({
    status: "ok",
    mode: Object.values(providers).every(Boolean) ? "live" : "demo",
    market,
    providers,
    auth: demoAuth
      ? "demo"
      : process.env["CLERK_SECRET_KEY"]?.trim()
        ? "clerk"
        : "unconfigured",
  });
});

export default router;
