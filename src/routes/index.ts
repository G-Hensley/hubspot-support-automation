import { FastifyInstance } from 'fastify';
import { healthRoutes } from './health';
import { webhookRoutes } from './webhook';

/**
 * Register all application routes
 */
export async function registerRoutes(fastify: FastifyInstance) {
  // Register health check routes
  await fastify.register(healthRoutes);

  // Register webhook routes
  await fastify.register(webhookRoutes);

  // Note: Fastify's built-in logger already logs registered routes at debug level
  // Additional route registration logging can be viewed by setting LOG_LEVEL=debug
}
