import { config } from './config/index';
import { createServer } from './server';
import { testDatabaseConnection, disconnectDatabase } from './db/index';
import { version } from '../package.json';
import type { FastifyInstance } from 'fastify';

/**
 * Application entry point
 */
async function main() {
  // Note: Using console.log/warn for pre-server startup logging
  // since the Fastify logger is not yet initialized
  let server: FastifyInstance | null = null;

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
    server = await createServer();

    // Register process event handlers (registered here to avoid duplicate handlers if createServer called multiple times)
    let isShuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals) => {
      if (isShuttingDown) {
        return;
      }
      isShuttingDown = true;
      if (server) {
        server.log.info(`Received ${signal}, starting graceful shutdown`);
        try {
          await server.close();
          server.log.info('Server closed successfully');
          await disconnectDatabase();
          process.exit(0);
        } catch (error) {
          server.log.error({ error }, 'Error during shutdown');
          await disconnectDatabase();
          process.exit(1);
        }
      } else {
        console.log(`Received ${signal}, exiting`);
        await disconnectDatabase();
        process.exit(0);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Handle uncaught errors
    process.on('uncaughtException', async (error) => {
      if (server) {
        server.log.fatal({ error }, 'Uncaught exception');
        try {
          await server.close();
          server.log.info('Server closed successfully after uncaught exception');
        } catch (shutdownError) {
          server.log.error({ error: shutdownError }, 'Error during shutdown after uncaught exception');
        }
      } else {
        console.error('Uncaught exception:', error);
      }
      // Ensure database connections are closed
      await disconnectDatabase();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      if (server) {
        server.log.fatal({ reason }, 'Unhandled rejection');
        try {
          await server.close();
          server.log.info('Server closed successfully after unhandled rejection');
        } catch (shutdownError) {
          server.log.error({ error: shutdownError }, 'Error during shutdown after unhandled rejection');
        }
      } else {
        console.error('Unhandled rejection:', reason);
      }
      // Ensure database connections are closed
      await disconnectDatabase();
      process.exit(1);
    });

    // Start listening on configured port
    const port = config.PORT;
    const host = config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';

    await server.listen({ port, host });

    server.log.info(
      {
        port,
        host,
        node_env: config.NODE_ENV,
        version,
      },
      'Server started successfully'
    );

    // Log available routes
    server.log.info('Available routes:');
    server.log.info(`  GET  ${host}:${port}/health`);
    server.log.info(`  POST ${host}:${port}/webhook/hubspot`);

  } catch (error) {
    console.error('Failed to start server:', error);
    await disconnectDatabase();
    process.exit(1);
  }
}

// Start the application
main();
