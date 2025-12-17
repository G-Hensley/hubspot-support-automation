import { config } from './config/index';
import { createServer } from './server';
import { testDatabaseConnection, disconnectDatabase } from './db/index';
import { version } from '../package.json';
import type { FastifyInstance } from 'fastify';

// Module-level state for graceful shutdown
let isShuttingDown = false;
let serverInstance: FastifyInstance | null = null;

/**
 * Graceful shutdown handler
 * Prevents duplicate shutdowns and ensures proper cleanup
 */
async function shutdown(signal: NodeJS.Signals) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  if (serverInstance) {
    serverInstance.log.info(`Received ${signal}, starting graceful shutdown`);
    try {
      await serverInstance.close();
      serverInstance.log.info('Server closed successfully');
      await disconnectDatabase();
      process.exit(0);
    } catch (error) {
      serverInstance.log.error({ error }, 'Error during shutdown');
      await disconnectDatabase();
      process.exit(1);
    }
  } else {
    console.log(`Received ${signal}, exiting`);
    await disconnectDatabase();
    process.exit(0);
  }
}

/**
 * Handle uncaught exceptions with graceful shutdown
 */
async function handleUncaughtException(error: Error) {
  if (isShuttingDown) {
    console.error('Uncaught exception during shutdown:', error);
    return;
  }
  isShuttingDown = true;

  if (serverInstance) {
    serverInstance.log.fatal({ error }, 'Uncaught exception');
    try {
      await serverInstance.close();
      serverInstance.log.info('Server closed successfully after uncaught exception');
    } catch (shutdownError) {
      serverInstance.log.error({ error: shutdownError }, 'Error during shutdown after uncaught exception');
    }
  } else {
    console.error('Uncaught exception:', error);
  }
  await disconnectDatabase();
  process.exit(1);
}

/**
 * Handle unhandled promise rejections with graceful shutdown
 */
async function handleUnhandledRejection(reason: unknown) {
  if (isShuttingDown) {
    console.error('Unhandled rejection during shutdown:', reason);
    return;
  }
  isShuttingDown = true;

  if (serverInstance) {
    serverInstance.log.fatal({ reason }, 'Unhandled rejection');
    try {
      await serverInstance.close();
      serverInstance.log.info('Server closed successfully after unhandled rejection');
    } catch (shutdownError) {
      serverInstance.log.error({ error: shutdownError }, 'Error during shutdown after unhandled rejection');
    }
  } else {
    console.error('Unhandled rejection:', reason);
  }
  await disconnectDatabase();
  process.exit(1);
}

// Register process event handlers at module level (ensures single registration)
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', handleUncaughtException);
process.on('unhandledRejection', handleUnhandledRejection);

/**
 * Application entry point
 */
async function main() {
  // Note: Using console.log/warn for pre-server startup logging
  // since the Fastify logger is not yet initialized

  try {
    // Test database connection
    console.log('Testing database connection...');
    try {
      await testDatabaseConnection();
      console.log('Database connection established');
    } catch (dbError) {
      console.warn('Database connection failed:', dbError instanceof Error ? dbError.message : dbError);
      console.warn('Continuing server startup without database - health endpoint will report degraded status');
    }

    // Create and configure Fastify server
    console.log('Creating Fastify server...');
    serverInstance = await createServer();

    // Start listening on configured port
    const port = config.PORT;
    const host = config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';

    await serverInstance.listen({ port, host });

    serverInstance.log.info(
      {
        port,
        host,
        node_env: config.NODE_ENV,
        version,
      },
      'Server started successfully'
    );

    // Log available routes
    serverInstance.log.info('Available routes:');
    serverInstance.log.info(`  GET  ${host}:${port}/health`);
    serverInstance.log.info(`  POST ${host}:${port}/webhook/hubspot`);

  } catch (error) {
    console.error('Failed to start server:', error);
    await disconnectDatabase();
    process.exit(1);
  }
}

// Start the application
main();
