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
      // Manual validation performed in handler (Zod schemas not compatible with Fastify schema property)
    },
    async (request, reply) => {
      // Manual Zod validation
      const parseResult = hubspotWebhookPayloadSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          status: 'error',
          message: 'Invalid request body',
          errors: parseResult.error.errors,
        });
      }
      const body = parseResult.data;

      // Extract ticket ID
      // HubSpot webhooks may not always include hs_ticket_id in the properties object,
      // especially for certain event types or if the ticket was just created and not fully populated.
      // In such cases, objectId (the top-level unique identifier for the object in HubSpot) is used as a fallback.
      // This ensures we always have a ticket identifier, but future maintainers should verify
      // that objectId is always equivalent to the ticket's ID in all relevant webhook scenarios.
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
