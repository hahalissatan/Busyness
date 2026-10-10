/**
 * index.js — Server entry point.
 *
 * Imports the Express app from app.js and starts the HTTP server.
 * Handles graceful shutdown on SIGTERM/SIGINT/uncaughtException/unhandledRejection.
 *
 * The app is defined in app.js so that tests can import it directly
 * (via supertest) without binding to a port.
 */

import app from "./app.js";
import { closePool } from "./db/pool.js";

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Busyness API running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Auth: POST http://localhost:${PORT}/api/auth/register`);
  console.log(`Auth: POST http://localhost:${PORT}/api/auth/login`);
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
