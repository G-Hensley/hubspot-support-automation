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

  fastify.log.info('All routes registered');
}
