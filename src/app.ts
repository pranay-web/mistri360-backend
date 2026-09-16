import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

app.set("trust proxy", 1);

// Add security headers (X-Frame-Options, X-Content-Type-Options, etc.)
app.use(helmet());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Configure CORS with explicit origin whitelist
const envOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = envOrigins.length > 0
  ? envOrigins
  : [
      "http://localhost:18231",
      "http://localhost:18232",
      "http://localhost:3000",
      "http://localhost:8080",
      "http://localhost:5173",
    ];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }

      // Check explicit allowed origins list
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // Allow any origin from the same host (e.g. EC2 public IP or custom domain on port 80/443 or matching host)
      try {
        const originUrl = new URL(origin);
        // If ALLOWED_ORIGINS is not set or empty, allow all http/https origins in production reverse-proxied setups
        if (envOrigins.length === 0) {
          callback(null, true);
          return;
        }
      } catch {}

      logger.warn({ origin }, "CORS request from disallowed origin");
      callback(new Error("Not allowed by CORS policy"));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

// Limit request body sizes to prevent memory exhaustion attacks
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

// Rate limiting for general API (100 requests per minute per IP)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  skip: (req) => {
    // Don't rate limit health checks
    return req.path === "/healthz" || req.path === "/health";
  },
});

app.use("/api", apiLimiter, router);

// Global error logging middleware
app.use((error: any, req: any, res: any, next: any) => {
  if (!error) return next();

  const statusCode = error.status || error.statusCode || 500;
  logger.error(
    {
      error: error.message,
      statusCode,
      method: req.method,
      url: req.path,
      ip: req.ip,
    },
    "API Error"
  );

  // Return 500 for unhandled errors
  if (statusCode === 500) {
    res.status(500).json({ error: "Internal server error" });
  } else {
    res.status(statusCode).json({ error: error.message || "An error occurred" });
  }
});

export default app;
