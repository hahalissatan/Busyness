import express from "express";
import { closePool, checkConnection } from "./db/pool.js";

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3001;

// --- Health checks --------------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Busyness API",
  });
});

app.get("/api/health/db", async (req, res) => {
  const result = await checkConnection();
  if (result.ok) {
    res.json({ status: "ok", database: "connected" });
  } else {
    // Only return a safe error code — never credentials or connection details
    res.status(503).json({
      status: "error",
      database: "unreachable",
      code: result.error,
    });
  }
});

// --- 404 handler ----------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    path: req.path,
    method: req.method,
  });
});

// --- Central error handler ------------------------------------------------

app.use((err, req, res, next) => {
  console.error("[ERROR]", err.message);
  res.status(err.status || 500).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "production" ? undefined : err.message,
  });
});

// --- Start server ---------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`Busyness API running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// --- Graceful shutdown ----------------------------------------------------

function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  server.close(async (err) => {
    if (err) {
      console.error("Error during server shutdown:", err);
    }

    // Close database pool
    try {
      await closePool();
      console.log("Database pool closed.");
    } catch (poolErr) {
      console.error("Error closing database pool:", poolErr.message);
    }

    if (err) {
      process.exit(1);
    }
    console.log("Server closed. Goodbye.");
    process.exit(0);
  });

  // Force-exit after 5 seconds if connections hang
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  shutdown("unhandledRejection");
});
