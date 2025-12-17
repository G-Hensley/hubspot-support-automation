import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config/index';
import { registerRoutes } from './routes/index';

// Maximum webhook payload size (1MB for HubSpot webhook payloads)
const MAX_WEBHOOK_PAYLOAD_SIZE = 1048576; // 1MB in bytes

/**
 * Sanitize error messages to prevent information disclosure
 * Removes potentially sensitive patterns like connection strings, file paths, and credentials
 */
function sanitizeErrorMessage(message: string): string {
  return message
    // Remove database connection strings
    .replace(/postgresql:\/\/[^\s]+/gi, 'postgresql://[REDACTED]')
    .replace(/mysql:\/\/[^\s]+/gi, 'mysql://[REDACTED]')
    // Remove token=value patterns (must be before generic long string check)
    .replace(/token=[a-zA-Z0-9_-]+/gi, 'token=[REDACTED]')
    // Remove file system paths
    .replace(/\/[\w\-._/]+/g, (match) => {
      // Keep relative paths, sanitize absolute paths
      if (match.startsWith('/home') || match.startsWith('/var') || match.startsWith('/opt')) {
        return '[PATH_REDACTED]';
      }
      return match;
    })
    // Remove potential API keys and tokens (sk_, pk_, gsk_, Bearer)
    .replace(/[a-zA-Z0-9_-]{32,}/g, (match) => {
      // If it looks like a key/token (long alphanumeric string), redact it
      if (/^(sk_|pk_|gsk_|Bearer )/i.test(match)) {
        return '[CREDENTIAL_REDACTED]';
      }
      return match;
    });
}

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
    // Set body size limit for webhook payloads
    bodyLimit: MAX_WEBHOOK_PAYLOAD_SIZE,
  });

  // Register CORS plugin
  await fastify.register(cors, {
    // In production, disable CORS (no browser access needed for webhook-only API)
    // In development, allow all origins for testing
    origin: config.NODE_ENV === 'production' ? false : '*',
    methods: ['GET', 'POST'],
  });

  // Register Helmet plugin for security headers
  await fastify.register(helmet, {
    // Disable CSP for API endpoints (not needed for non-browser APIs)
    contentSecurityPolicy: false,
    // Enable Helmet globally for all routes
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
        message: `Request body exceeds ${MAX_WEBHOOK_PAYLOAD_SIZE / 1024 / 1024}MB limit`,
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
    // In development: expose error message (sanitized to prevent credential leaks)
    // In production: return generic message only
    const errorMessage = config.NODE_ENV === 'development'
      ? sanitizeErrorMessage(error.message)
      : 'An unexpected error occurred';

    return reply.code(error.statusCode || 500).send({
      error: 'internal_error',
      message: errorMessage,
      request_id: request.id,
    });
  });

  // Register all routes
  await registerRoutes(fastify);

  return fastify;
}
