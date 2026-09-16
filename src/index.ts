import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Global error handlers for unhandled rejections and exceptions
process.on("unhandledRejection", (reason, promise) => {
  logger.error({ reason, promise }, "Unhandled Promise Rejection");
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  logger.error({ error }, "Uncaught Exception");
  process.exit(1);
});

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Graceful shutdown handler
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");

  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });

  // Force exit after 30 seconds if shutdown is taking too long
  setTimeout(() => {
    logger.error("Forced shutdown after 30 second timeout");
    process.exit(1);
  }, 30000);
});
