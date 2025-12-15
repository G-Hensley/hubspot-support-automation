import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config/index';
import { registerRoutes } from './routes/index';

/**
 * Create and configure Fastify server instance
 */
export async function createServer() {
  // Create Fastify instance with Pino logger
  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
    // Generate unique request IDs for tracing
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'request_id',
    disableRequestLogging: false,
    // Set body size limit (1MB for webhook payloads)
    bodyLimit: 1048576, // 1MB in bytes
  });

  // Register CORS plugin
  await fastify.register(cors, {
    // In production, restrict to specific origins
    origin: config.NODE_ENV === 'production' ? false : '*',
    methods: ['GET', 'POST'],
  });

  // Register Helmet plugin for security headers
  await fastify.register(helmet, {
    // Disable CSP for API endpoints
    contentSecurityPolicy: false,
    // Global security headers
    global: true,
  });

  // Add error handler for payload too large
  fastify.setErrorHandler((error, request, reply) => {
    if (error.statusCode === 413) {
      request.log.warn(
        { request_id: request.id, error: error.message },
        'Payload too large'
      );

      return reply.code(413).send({
        error: 'payload_too_large',
        message: 'Request body exceeds 1MB limit',
        request_id: request.id,
      });
    }

    // Handle validation errors
    if (error.validation) {
      request.log.warn(
        { request_id: request.id, validation_errors: error.validation },
        'Request validation failed'
      );

      return reply.code(400).send({
        error: 'validation_error',
        message: error.message,
        details: error.validation,
        request_id: request.id,
      });
    }

    // Log unexpected errors
    request.log.error(
      { request_id: request.id, error: error.message, stack: error.stack },
      'Unexpected error'
    );

    // Return generic error for unexpected errors
    return reply.code(error.statusCode || 500).send({
      error: 'internal_error',
      message: config.NODE_ENV === 'development'
        ? error.message
        : 'An unexpected error occurred',
      request_id: request.id,
    });
  });

  // Register all routes
  await registerRoutes(fastify);

  // Graceful shutdown handler
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      fastify.log.info(`Received ${signal}, starting graceful shutdown`);

      try {
        await fastify.close();
        fastify.log.info('Server closed successfully');
        process.exit(0);
      } catch (error) {
        fastify.log.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    });
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    fastify.log.fatal({ error }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    fastify.log.fatal({ reason }, 'Unhandled rejection');
    process.exit(1);
  });

  return fastify;
}
