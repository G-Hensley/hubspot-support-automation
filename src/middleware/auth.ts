import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index';

/**
 * Webhook authentication middleware
 * Validates the X-Webhook-Token header against the configured secret
 */
export async function validateWebhookToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = request.headers['x-webhook-token'];

  // Check if token is provided
  if (!token) {
    request.log.warn(
      { request_id: request.id },
      'Webhook authentication failed: missing X-Webhook-Token header'
    );

    return reply.code(401).send({
      error: 'unauthorized',
      message: 'Missing or invalid X-Webhook-Token header',
      request_id: request.id,
    });
  }

  // Validate token against configured secret
  if (token !== config.HUBSPOT_WEBHOOK_TOKEN) {
    request.log.warn(
      { request_id: request.id },
      'Webhook authentication failed: invalid token'
    );

    return reply.code(401).send({
      error: 'unauthorized',
      message: 'Missing or invalid X-Webhook-Token header',
      request_id: request.id,
    });
  }

  // Token is valid, continue to route handler
  request.log.debug(
    { request_id: request.id },
    'Webhook authentication successful'
  );
}
