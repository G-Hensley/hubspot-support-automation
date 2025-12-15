import { z } from 'zod';

/**
 * Zod schema for HubSpot webhook payload validation
 */
export const hubspotWebhookPayloadSchema = z.object({
  objectId: z.number(),
  subscriptionType: z.string(),
  portalId: z.number(),
  occurredAt: z.number(),
  properties: z.object({
    hs_ticket_id: z.string().optional(),
    subject: z.string(),
    content: z.string(),
    hs_pipeline_stage: z.string().optional(),
    hs_ticket_priority: z.string().optional(),
    source_type: z.string().optional(),
  }),
  associatedContacts: z.array(
    z.object({
      id: z.number(),
      email: z.string().optional(),
      firstname: z.string().optional(),
      lastname: z.string().optional(),
      company: z.string().optional(),
    })
  ).optional(),
  customProperties: z.object({
    customer_tier: z.string().optional(),
    product_area: z.string().optional(),
  }).optional(),
});

/**
 * Normalized internal ticket format used throughout the processing pipeline
 */
export interface NormalizedTicket {
  // Required fields
  ticket_id: string;           // HubSpot ticket ID
  subject: string;             // Ticket subject line
  body: string;                // Ticket content/description

  // Optional fields (null if not available)
  from_email: string | null;   // Customer email address
  customer_name: string | null; // Customer full name
  customer_tier: string | null; // e.g., "free", "pro", "enterprise"
  product_area: string | null;  // e.g., "dashboard", "api", "billing"
  hubspot_ticket_url: string | null; // Direct link to ticket in HubSpot

  // Metadata
  received_at: string;         // ISO-8601 timestamp when webhook received
  request_id: string;          // UUID for request tracing
}

/**
 * HubSpot webhook payload structure
 * Derived from hubspotWebhookPayloadSchema to maintain single source of truth
 */
export type HubSpotWebhookPayload = z.infer<typeof hubspotWebhookPayloadSchema>;

/**
 * Webhook response format
 */
export interface WebhookResponse {
  status: 'accepted' | 'duplicate';
  ticket_id: string;
  request_id: string;
  message?: string;
  original_processed_at?: string;
}

/**
 * Error response format
 */
export interface ErrorResponse {
  error: string;          // Error code (snake_case)
  message: string;        // Human-readable message
  details?: {             // Optional additional context
    field?: string;       // Field that caused error
    reason?: string;      // Specific reason
    [key: string]: any;   // Additional error-specific details
  };
  request_id?: string;    // Request ID for tracing
}

/**
 * Health check response format
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'shutting_down';
  timestamp: string;
  version: string;
  uptime_seconds: number;
  dependencies?: {
    database?: {
      status: 'healthy' | 'unhealthy' | 'unknown';
      latency_ms?: number | null;
      error?: string;
    };
    local_llm?: {
      status: 'healthy' | 'unhealthy' | 'unknown';
      message?: string;
    };
    groq_api?: {
      status: 'healthy' | 'unhealthy' | 'unknown';
      message?: string;
    };
  };
  warnings?: string[];
}

/**
 * Triage output schema (for LLM response validation)
 */
export const triageOutputSchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  handling_mode: z.enum([
    'reply_only',
    'reply_and_internal_followup',
    'internal_followup_only',
    'request_more_info',
    'no_action'
  ]),
  recommended_internal_action: z.enum([
    'Create bug report',
    'Create feedback ticket',
    'Escalate to engineering',
    'Escalate to security',
    'None'
  ]),
  asana_ticket_type_if_needed: z.enum(['Bug', 'Feedback', 'Escalation', 'None']),
  customer_summary: z.string().max(300),
  reply_needed: z.boolean(),
  reply_draft: z.string().nullable(),
  questions_for_customer: z.array(z.string()).default([]),
  internal_notes: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
}).refine(
  (data) => {
    // If reply_needed is true, reply_draft should not be null
    if (data.reply_needed && data.reply_draft === null) {
      return false;
    }
    // If reply_needed is false, reply_draft should be null
    if (!data.reply_needed && data.reply_draft !== null) {
      return false;
    }
    return true;
  },
  {
    message: 'reply_draft must be provided when reply_needed is true, and null when false'
  }
);

/**
 * Inferred TypeScript type for triage output
 */
export type TriageOutput = z.infer<typeof triageOutputSchema>;
