import { ENV } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDB, disconnectDB } from './config/db.js';
import app from './app.js';
import { assetService } from './modules/asset/asset.service.js';
import type { Server } from 'http';

let server: Server;

const start = async (): Promise<void> => {
  await connectDB();

  // Fix files whose background copy to storage was cut off by a restart.
  void assetService
    .resolveStaleUploads()
    .then((result) => {
      if (result.ready || result.failed) logger.info(result, 'Resolved stale uploads');
    })
    .catch((err) => logger.warn({ err }, 'Stale upload check failed'));

  server = app.listen(ENV.PORT, () => {
    logger.info(`🚀 Server running on port ${ENV.PORT} [${ENV.NODE_ENV}]`);
  });

  // Node's default requestTimeout (5 min) kills slow multi-hundred-MB uploads
  // mid-stream, which the browser reports as "TypeError: Failed to fetch".
  // Disable it (0 = none) and keep the header timeout short and safe.
  server.requestTimeout = 0;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 61_000;
};

/**
 * Gracefully shut down: stop accepting new connections, close the DB, then exit.
 * Called on SIGTERM/SIGINT (e.g. PM2 restart, deploy) and on fatal errors.
 */
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received — shutting down gracefully...`);
  try {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await disconnectDB();
    logger.info('Shutdown complete.');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
