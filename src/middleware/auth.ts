import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { config } from '../config/index';

/**
 * Webhook authentication middleware
 * Validates the X-Webhook-Token header against the configured secret
 * Uses constant-time comparison to prevent timing attacks
 */
export async function validateWebhookToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tokenHeader = request.headers['x-webhook-token'];

  // Check if token is provided and is a string (not an array)
  if (!tokenHeader || Array.isArray(tokenHeader)) {
    request.log.warn(
      { request_id: request.id },
      'Webhook authentication failed: missing X-Webhook-Token header'
    );

    reply.code(401).send({
      error: 'unauthorized',
      message: 'Missing or invalid X-Webhook-Token header',
      request_id: request.id,
    });
    return;
  }

  const token = tokenHeader;

  // Validate token against configured secret using constant-time comparison
  // This prevents timing attacks where attackers could discover the token
  // by measuring response times
  const tokenBuffer = Buffer.from(token);
  const secretBuffer = Buffer.from(config.HUBSPOT_WEBHOOK_TOKEN);

  // Check length first (not constant-time, but necessary for timingSafeEqual)
  // Then use constant-time comparison for the actual token validation
  if (
    tokenBuffer.length !== secretBuffer.length ||
    !crypto.timingSafeEqual(tokenBuffer, secretBuffer)
  ) {
    request.log.warn(
      { request_id: request.id },
      'Webhook authentication failed: invalid token'
    );

    reply.code(401).send({
      error: 'unauthorized',
      message: 'Missing or invalid X-Webhook-Token header',
      request_id: request.id,
    });
    return;
  }

  // Token is valid, continue to route handler
  request.log.debug(
    { request_id: request.id },
    'Webhook authentication successful'
  );
}
