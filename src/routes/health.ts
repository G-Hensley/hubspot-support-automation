import { FastifyInstance } from 'fastify';
import { prisma } from '../db/index';
import { HealthCheckResponse } from '../types/index';

/**
 * Health check route
 * GET /health
 *
 * Returns service health status including database connectivity
 */
export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (request, reply) => {
    // Get process uptime
    const uptime = process.uptime();

    // Check database connectivity
    let dbStatus: 'healthy' | 'unhealthy' = 'healthy';
    let dbLatency: number | null = null;
    let dbError: string | undefined;

    try {
      const dbStartTime = Date.now();

      // Simple database query to check connectivity
      await prisma.$queryRaw`SELECT 1`;

      dbLatency = Date.now() - dbStartTime;

      request.log.debug(
        { latency_ms: dbLatency },
        'Database health check successful'
      );
    } catch (error) {
      dbStatus = 'unhealthy';
      dbError = error instanceof Error ? error.message : 'Unknown error';

      request.log.error(
        { error: dbError },
        'Database health check failed'
      );
    }

    // Determine overall service status
    const status = dbStatus === 'unhealthy' ? 'degraded' : 'healthy';
    const warnings = dbStatus === 'unhealthy'
      ? ['Database connection failed - operating in degraded mode']
      : undefined;

    // Build response
    const response: HealthCheckResponse = {
      status,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime_seconds: Math.floor(uptime),
      dependencies: {
        database: {
          status: dbStatus,
          latency_ms: dbLatency,
          ...(dbError && { error: dbError }),
        },
        local_llm: {
          status: 'unknown',
          message: 'Not probed during health check',
        },
        groq_api: {
          status: 'unknown',
          message: 'Not probed during health check',
        },
      },
      ...(warnings && { warnings }),
    };

    // Return 200 even for degraded status (service is still operational)
    // Only return 503 if service is shutting down
    reply.code(200).send(response);
  });
}
