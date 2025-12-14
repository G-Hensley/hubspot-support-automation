# Technical Decisions: HubSpot Support Triage Automation

**Version**: 1.0
**Last Updated**: 2025-12-14
**Status**: Approved for Implementation

This document contains Architecture Decision Records (ADRs) for all key technical decisions in the HubSpot Support Triage Automation system.

---

## ADR-001: Idempotency Store Selection

### Status
**ACCEPTED** - PostgreSQL on Railway

### Context
The system must prevent duplicate processing of the same HubSpot ticket. HubSpot may retry webhooks on timeout or error, and we need to track which ticket_ids have already been processed. Options considered:
- Redis
- SQLite (on Railway persistent volume)
- PostgreSQL (Railway-managed)

### Decision
**PostgreSQL on Railway** is selected as the idempotency store.

### Rationale

| Criteria | Redis | SQLite | PostgreSQL |
|----------|-------|--------|------------|
| **Railway Native** | Add-on ($5/mo min) | Persistent volume | Included free tier |
| **Performance** | Excellent (sub-ms) | Good (5-50ms) | Good (10-50ms) |
| **Durability** | Requires AOF config | Local file | ACID, automatic backups |
| **Complexity** | Additional service | Volume management | Single database for all needs |
| **Scaling** | Built for scale | Limited to single node | Scales with Railway |
| **Analytics** | Limited querying | Full SQL | Full SQL |

**PostgreSQL wins because**:
1. **Zero additional cost** - Railway includes PostgreSQL in their free tier
2. **Future flexibility** - Can add analytics tables, RAG metadata, etc.
3. **Operational simplicity** - One database for all storage needs
4. **Sufficient performance** - 50ms lookup is acceptable for our 15s latency budget
5. **ACID guarantees** - Prevents data loss, handles race conditions properly

### Consequences

**Positive**:
- Simple deployment (Railway manages everything)
- Familiar technology (SQL, Prisma ORM)
- No additional services to monitor
- Supports future Phase 2 requirements (RAG metadata storage)

**Negative**:
- Slightly higher latency than Redis (50ms vs 1ms) - acceptable
- Connection pool management required at scale
- Not optimized for pure key-value workload

### Alternatives Considered

**Redis**: Superior performance but adds $5+/month cost and operational complexity. Overkill for 100-200 tickets/day volume.

**SQLite**: Simpler than PostgreSQL but Railway persistent volumes add complexity. Risk of file corruption on unexpected shutdown. Limited concurrent write performance.

---

## ADR-002: Tunnel Solution Selection

### Status
**ACCEPTED** - Cloudflare Tunnel

### Context
The local Ollama instance runs on a developer's machine behind NAT/firewall. Railway needs secure HTTPS access to send triage requests. Options considered:
- Cloudflare Tunnel (cloudflared)
- Tailscale Funnel
- ngrok

### Decision
**Cloudflare Tunnel** is selected for local Ollama access.

### Rationale

| Criteria | Cloudflare Tunnel | Tailscale Funnel | ngrok |
|----------|-------------------|------------------|-------|
| **Cost** | Free (unlimited) | Free (limited bandwidth) | $8+/mo for stable URL |
| **Stability** | Excellent | Good | URL changes on free tier |
| **Authentication** | Built-in (Access policies) | Requires Tailscale auth | Token-based |
| **Setup Complexity** | Medium | Low | Low |
| **Enterprise Ready** | Yes (Zero Trust) | Yes | Limited |
| **URL Persistence** | Stable subdomain | Requires paid plan | Requires paid plan |

**Cloudflare Tunnel wins because**:
1. **Free and unlimited** - No bandwidth caps, no monthly fees
2. **Stable URL** - Same subdomain persists across restarts
3. **Built-in authentication** - Cloudflare Access can enforce token/JWT without custom code
4. **Production-grade** - Used by enterprises, well-documented
5. **Future expandability** - Can add WAF, rate limiting, geo-blocking

### Consequences

**Positive**:
- Zero operational cost
- Authentication offloaded to Cloudflare Access
- Automatic HTTPS certificate management
- Integrates with Cloudflare ecosystem (Zero Trust, analytics)

**Negative**:
- Requires Cloudflare account setup
- More configuration than ngrok
- Dependency on Cloudflare service availability

### Implementation Notes

```bash
# Install cloudflared on local machine
brew install cloudflare/cloudflare/cloudflared

# Login and create tunnel
cloudflared tunnel login
cloudflared tunnel create ollama-tunnel

# Configure tunnel (config.yml)
tunnel: <tunnel-id>
credentials-file: ~/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: ollama.yourdomain.com
    service: http://localhost:11434
    originRequest:
      httpHostHeader: localhost
  - service: http_status:404

# Run tunnel
cloudflared tunnel run ollama-tunnel
```

### Authentication Design
- Cloudflare Access policy requires Service Token in `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers
- Railway stores these tokens as environment variables
- All requests without valid tokens return 403 at edge (never reach Ollama)

---

## ADR-003: Web Framework Selection

### Status
**ACCEPTED** - Fastify

### Context
Need a Node.js web framework for the Railway orchestrator service. Requirements:
- Fast request/response handling (fast-ack pattern)
- TypeScript support
- Validation helpers
- Low memory footprint

Options considered:
- Express
- Fastify
- Hono

### Decision
**Fastify** is selected as the web framework.

### Rationale

| Criteria | Express | Fastify | Hono |
|----------|---------|---------|------|
| **Performance** | ~15k req/s | ~30k req/s | ~40k req/s |
| **TypeScript** | Add-on types | Native support | Native support |
| **Validation** | Middleware (Joi, etc.) | Built-in (JSON Schema/Ajv) | Built-in (Zod adapter) |
| **Ecosystem** | Largest | Large | Growing |
| **Learning Curve** | Lowest | Low | Low |
| **Async Support** | Callback patterns | First-class async/await | First-class async/await |

**Fastify wins because**:
1. **2x faster than Express** - Important for fast-ack pattern
2. **Built-in validation** - Native JSON Schema support, integrates with Zod
3. **First-class TypeScript** - Better DX, fewer type errors
4. **Mature ecosystem** - Plugins for everything needed (CORS, rate limiting, etc.)
5. **Production-proven** - Used by NearForm, Microsoft, etc.

### Consequences

**Positive**:
- Excellent performance out of the box
- Schema-first validation reduces bugs
- Great error handling and logging integration
- Active community and documentation

**Negative**:
- Smaller ecosystem than Express (though sufficient)
- Team may need brief onboarding if only Express-experienced
- Plugin quality varies (stick to official plugins)

### Alternative Consideration: Hono

Hono was a close second. It's newer, faster, and has excellent edge runtime support. However:
- Smaller ecosystem
- Less documentation for complex patterns
- Fastify's maturity provides more confidence for production

**Recommendation**: Re-evaluate Hono for future projects, especially edge-deployed services.

---

## ADR-004: Local Bridge Service

### Status
**ACCEPTED** - No Bridge Service (Direct Ollama Access)

### Context
Should we implement a local bridge service between Cloudflare Tunnel and Ollama, or expose Ollama directly through the tunnel?

**Bridge Service Option**:
```
Railway -> Cloudflare Tunnel -> Bridge Service -> Ollama
```

**Direct Access Option**:
```
Railway -> Cloudflare Tunnel -> Ollama
```

### Decision
**Direct Ollama access** through Cloudflare Tunnel (no bridge service).

### Rationale

**Arguments for Bridge Service**:
- Additional authentication layer
- Request/response transformation
- Local logging and monitoring
- Rate limiting at local level

**Arguments against Bridge Service**:
- Additional complexity and maintenance
- Another failure point
- Ollama API is already well-structured
- Cloudflare Access provides authentication
- No transformation needed (Railway sends Ollama-native format)

**Direct access wins because**:
1. **Simplicity** - Fewer moving parts to maintain
2. **Cloudflare handles auth** - Service tokens validated at edge
3. **Ollama API is sufficient** - No need for transformation layer
4. **Reliability** - Fewer components = fewer failures
5. **Phase 1 focus** - Build minimal viable solution first

### Consequences

**Positive**:
- Simpler local setup (just Ollama + tunnel)
- No additional code to maintain
- Lower latency (no extra hop)
- Easier debugging

**Negative**:
- No local request logging (use Railway logs instead)
- Can't add local rate limiting (not needed at current scale)
- If transformation needed later, requires Railway-side changes

### Future Reconsideration
If Phase 2 requires:
- Local request caching
- Model switching logic
- Local queue for batch processing
- Health check with model warm-up

Then reconsider bridge service. For Phase 1 MVP, direct access is sufficient.

---

## ADR-005: JSON Validation Library

### Status
**ACCEPTED** - Zod

### Context
Need to validate LLM output against the triage schema. Requirements:
- TypeScript integration
- Detailed error messages for repair prompts
- Runtime validation
- Schema definition that can be serialized (for LLM prompts)

Options considered:
- Zod
- Yup
- Joi
- Ajv (JSON Schema)

### Decision
**Zod** is selected for JSON validation.

### Rationale

| Criteria | Zod | Yup | Joi | Ajv |
|----------|-----|-----|-----|-----|
| **TypeScript** | First-class | Good | Add-on | Add-on |
| **Bundle Size** | ~50kb | ~40kb | ~150kb | ~35kb |
| **Error Messages** | Excellent | Good | Excellent | Technical |
| **Schema Definition** | Chained methods | Chained methods | Chained methods | JSON Schema |
| **Transform Support** | Yes | Yes | Yes | Limited |
| **Fastify Integration** | Via adapter | Via adapter | Via adapter | Native |

**Zod wins because**:
1. **TypeScript-first** - Infers types from schema, no duplication
2. **Excellent error messages** - Human-readable, perfect for repair prompts
3. **Transform support** - Can normalize values during validation
4. **Growing standard** - Widely adopted in TypeScript ecosystem
5. **Fastify integration** - `fastify-type-provider-zod` for request validation

### Schema Example

```typescript
import { z } from 'zod';

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
  questions_for_customer: z.array(z.string()),
  internal_notes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
}).refine(
  (data) => !data.reply_needed || data.reply_draft !== null,
  { message: 'reply_draft required when reply_needed is true' }
);

export type TriageOutput = z.infer<typeof triageOutputSchema>;
```

### Consequences

**Positive**:
- Type safety throughout codebase
- Detailed errors enable effective repair prompts
- Schema serves as documentation
- Easy to extend and modify

**Negative**:
- Learning curve for team unfamiliar with Zod
- Slightly larger bundle than Ajv

---

## ADR-006: Error Handling Patterns

### Status
**ACCEPTED** - Layered Error Handling with Graceful Degradation

### Context
Multiple failure modes exist in the pipeline:
- Webhook validation failures
- LLM provider failures (timeout, API errors)
- JSON validation failures
- Discord posting failures
- Database failures

Need consistent error handling that prioritizes reliability.

### Decision
Implement **layered error handling** with **graceful degradation**.

### Error Handling Strategy by Layer

#### Layer 1: Webhook Handler (Synchronous)
```
On auth failure:     Return 401 Unauthorized immediately
On validation error: Return 400 Bad Request immediately
On parse error:      Return 400 Bad Request immediately
```
**Rationale**: Fast feedback to HubSpot, no async processing for invalid requests.

#### Layer 2: Idempotency Check
```
On database error:   Log warning, PROCEED with processing (fail-open)
On duplicate found:  Return 200 OK, skip processing
```
**Rationale**: Prefer potential duplicates over lost tickets.

#### Layer 3: LLM Inference
```
On local timeout:    Log, fall back to Groq
On local error:      Log, fall back to Groq
On Groq timeout:     Send "triage failed" notification
On Groq error:       Send "triage failed" notification
On both fail:        Log full error, send "triage failed" to Discord
```
**Rationale**: Maximize availability via fallback, surface failures to team.

#### Layer 4: Validation & Repair
```
On invalid JSON:     Attempt extraction from text
On schema error:     Send repair prompt to same provider (1 attempt)
On repair failure:   Send "triage failed" notification
```
**Rationale**: Recover from common LLM output issues automatically.

#### Layer 5: Discord Notification
```
On 5xx error:        Retry 2x with exponential backoff (1s, 3s)
On 4xx error:        Log error, do not retry (likely config issue)
On all retries fail: Log full context for manual notification
```
**Rationale**: Handle transient Discord issues, surface persistent failures.

### Retry Configuration

| Operation | Max Retries | Backoff | Timeout |
|-----------|-------------|---------|---------|
| Local Ollama | 0 (direct fallback) | N/A | 10s |
| Groq API | 0 (fail to notification) | N/A | 15s |
| LLM Repair | 1 | None | Same as provider |
| Discord POST | 2 | Exponential (1s, 3s) | 5s |
| PostgreSQL | 2 | Fixed (100ms) | 2s |

### Circuit Breaker (Phase 2)

Not implemented in Phase 1. Consider for Phase 2 if:
- Local Ollama has extended downtime periods
- Groq rate limits are hit frequently

Implementation plan:
```typescript
// Future: Track failures per provider
const circuitBreaker = {
  local: { failures: 0, openUntil: null },
  groq: { failures: 0, openUntil: null }
};

// Open circuit after 5 consecutive failures
// Reset after 60 seconds
```

### Consequences

**Positive**:
- Clear escalation path for each failure type
- Maximizes availability (fail-open where safe)
- Team always informed of failures via Discord
- No silent failures

**Negative**:
- More complex error handling code
- Potential for duplicate notifications (fail-open idempotency)
- "Triage failed" notifications may be noisy if providers are unstable

---

## ADR-007: Logging Strategy

### Status
**ACCEPTED** - Structured JSON Logging with Pino

### Context
Need observability into system behavior for:
- Debugging failures
- Performance monitoring
- Cost tracking (local vs. Groq usage)
- Compliance (audit trail)

### Decision
Use **Pino** for structured JSON logging with consistent context.

### Log Structure

```typescript
interface LogContext {
  request_id: string;    // UUID generated per webhook
  ticket_id?: string;    // From HubSpot payload
  timestamp: string;     // ISO-8601
  component: string;     // webhook | inference | validation | discord | idempotency
  event: string;         // received | processed | failed | skipped
  latency_ms?: number;   // Operation duration
  provider?: string;     // local | groq
  error?: {
    type: string;
    message: string;
    stack?: string;      // Only in development
  };
}
```

### Log Levels

| Level | Usage | Example |
|-------|-------|---------|
| **error** | Failures requiring attention | Both LLM providers failed |
| **warn** | Degraded operation | Idempotency store unreachable (fail-open) |
| **info** | Normal operations | Webhook received, triage completed |
| **debug** | Detailed troubleshooting | LLM prompt content, response parsing |

### Sensitive Data Handling

**NEVER LOG**:
- Full ticket body (customer PII)
- Customer email addresses
- API keys or tokens

**SAFE TO LOG**:
- Ticket ID (opaque identifier)
- Subject line (truncated to 100 chars)
- Priority, handling mode, confidence
- Error messages (sanitized)

### Example Log Entries

```json
{"level":"info","time":"2025-12-14T10:30:00Z","request_id":"uuid-123","ticket_id":"12345","component":"webhook","event":"received"}

{"level":"info","time":"2025-12-14T10:30:08Z","request_id":"uuid-123","ticket_id":"12345","component":"inference","event":"completed","provider":"local","latency_ms":7500,"confidence":0.85}

{"level":"error","time":"2025-12-14T10:30:10Z","request_id":"uuid-123","ticket_id":"12345","component":"inference","event":"failed","error":{"type":"timeout","message":"Local Ollama timeout after 10000ms"}}
```

### Consequences

**Positive**:
- Railway log aggregation compatible
- Easy to query and filter
- Performance metrics built-in
- Consistent structure across components

**Negative**:
- More verbose than plain text
- Requires log parsing tools for local debugging (pino-pretty)

---

## ADR-008: LLM Model Selection

### Status
**ACCEPTED** - llama3.2 (Local) / llama-3.1-70b-versatile (Groq)

### Context
Need to select models for both local and cloud inference that:
- Produce consistent JSON output
- Understand support ticket context
- Balance quality vs. speed vs. cost

### Decision

**Local (Ollama)**: `llama3.2:latest` (8B parameters)
**Cloud (Groq)**: `llama-3.1-70b-versatile`

### Rationale

**Local Model (llama3.2)**:
- Optimized for consumer hardware (runs on Mac M1/M2)
- Good JSON mode support
- 6-8 second inference for typical prompts
- Sufficient quality for triage task

**Cloud Model (llama-3.1-70b)**:
- Higher quality than 8B models
- Groq's fastest inference (2-4 seconds)
- Better at complex reasoning edge cases
- Cost-effective at ~$0.0008/request

### Model Configuration

```typescript
const modelConfig = {
  local: {
    model: 'llama3.2:latest',
    temperature: 0.2,
    num_predict: 1024,
    format: 'json'
  },
  groq: {
    model: 'llama-3.1-70b-versatile',
    temperature: 0.2,
    max_tokens: 1024,
    response_format: { type: 'json_object' }
  }
};
```

### Future Considerations

- **Fine-tuning**: If triage accuracy <85%, consider fine-tuning on labeled tickets
- **Smaller models**: Test llama3.2:3b if 8B is too slow on local hardware
- **Alternative providers**: Evaluate Claude API if complex tickets need better reasoning

---

## Summary of Decisions

| Decision | Choice | Key Rationale |
|----------|--------|---------------|
| Idempotency Store | PostgreSQL | Zero cost, Railway-native, future flexibility |
| Tunnel Solution | Cloudflare Tunnel | Free, stable URLs, built-in auth |
| Web Framework | Fastify | 2x faster than Express, TypeScript-first |
| Local Bridge Service | No | Simplicity, Cloudflare handles auth |
| JSON Validation | Zod | TypeScript-first, excellent errors |
| Error Handling | Layered + Fail-open | Maximize availability, surface failures |
| Logging | Pino (structured JSON) | Railway compatible, queryable |
| LLM Models | llama3.2 / llama-3.1-70b | Balance of speed, quality, cost |

---

**Approved By**: Architecture Agent
**Review Date**: 2025-12-14
