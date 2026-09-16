import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Extended health check for Docker/load balancers with database verification
router.get("/health", async (_req, res) => {
  try {
    // Test database connection
    await db.select({ one: sql`1` }).from(sql`(SELECT 1)`);

    res.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development",
    });
  } catch (error) {
    logger.error({ error }, "Health check: database connection failed");
    res.status(503).json({
      status: "error",
      database: "disconnected",
      timestamp: new Date().toISOString(),
      message: "Database connection failed",
    });
  }
});

export default router;

