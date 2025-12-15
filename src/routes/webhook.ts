import { FastifyInstance } from 'fastify';
import { validateWebhookToken } from '../middleware/auth';
import {
  HubSpotWebhookPayload,
  WebhookResponse,
  hubspotWebhookPayloadSchema
} from '../types/index';

/**
 * Webhook routes
 * POST /webhook/hubspot - Receives new ticket notifications from HubSpot
 */
export async function webhookRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Body: HubSpotWebhookPayload;
  }>(
    '/webhook/hubspot',
    {
      // Apply webhook authentication middleware
      preHandler: validateWebhookToken,
      schema: {
        body: hubspotWebhookPayloadSchema,
      },
    },
    async (request, reply) => {
      const { body } = request;

      // Extract ticket ID
      const ticketId = body.properties.hs_ticket_id || String(body.objectId);

      request.log.info(
        {
          request_id: request.id,
          ticket_id: ticketId,
          subscription_type: body.subscriptionType,
        },
        'Webhook received'
      );

      // Log payload details for debugging (stub implementation)
      request.log.debug(
        {
          request_id: request.id,
          ticket_id: ticketId,
          subject: body.properties.subject,
          has_contacts: !!body.associatedContacts?.length,
        },
        'Webhook payload parsed'
      );

      // Fast-ack pattern: Return 200 immediately
      // Async processing will be implemented in future tasks
      const response: WebhookResponse = {
        status: 'accepted',
        ticket_id: ticketId,
        request_id: request.id,
      };

      request.log.info(
        {
          request_id: request.id,
          ticket_id: ticketId,
        },
        'Webhook accepted (stub - no processing yet)'
      );

      // TODO: Implement async processing in future tasks
      // processTicket(normalizedTicket).catch(logError);

      reply.code(200).send(response);
    }
  );
}
