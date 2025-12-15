import { config } from './config/index';
import { createServer } from './server';
import { testDatabaseConnection, disconnectDatabase } from './db/index';
import { version } from '../package.json';

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
      console.warn('Continuing server startup in degraded mode');
    }

    // Create and configure Fastify server
    console.log('Creating Fastify server...');
    const server = await createServer();

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
