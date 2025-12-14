# Architecture Overview: HubSpot Support Triage Automation

**Version**: 1.0
**Last Updated**: 2025-12-14
**Status**: Approved for Implementation

---

## Executive Summary

This document describes the technical architecture for the HubSpot Support Triage Automation system. The system receives support ticket webhooks from HubSpot, performs AI-powered triage using a hybrid inference strategy (local Ollama with Groq fallback), and delivers structured recommendations to Discord for human review.

**Key Architectural Principles**:
- **Human-in-the-Loop**: No automated customer communication or task creation
- **Cost Optimization**: Local-first inference with cloud fallback
- **Reliability**: Fast-ack pattern, idempotency, graceful degradation
- **Security**: Defense in depth with prompt injection resistance

---

## System Architecture Diagram

```
                                    EXTERNAL SERVICES
    +------------------+     +------------------+     +------------------+
    |     HubSpot      |     |      Discord     |     |       Groq       |
    | (Ticket Source)  |     | (Notifications)  |     | (Fallback LLM)   |
    +--------+---------+     +--------+---------+     +--------+---------+
             |                        ^                        ^
             | Webhook                | Embed                  | OpenAI-compatible
             | (HTTPS)                | POST                   | API
             v                        |                        |
    +--------+------------------------+------------------------+---------+
    |                          RAILWAY (Cloud)                           |
    |  +--------------------------------------------------------------+  |
    |  |                    ORCHESTRATOR SERVICE                      |  |
    |  |                                                              |  |
    |  |  +------------------+    +------------------+                |  |
    |  |  |   Webhook        |    |    Inference     |                |  |
    |  |  |   Handler        |--->|    Strategy      |                |  |
    |  |  | (Fast-Ack)       |    | (Local -> Groq)  |                |  |
    |  |  +------------------+    +--------+---------+                |  |
    |  |          |                        |                          |  |
    |  |          v                        v                          |  |
    |  |  +------------------+    +------------------+                |  |
    |  |  |   Idempotency    |    |   Validation     |                |  |
    |  |  |   Manager        |    |   & Repair       |                |  |
    |  |  +--------+---------+    +--------+---------+                |  |
    |  |           |                       |                          |  |
    |  |           v                       v                          |  |
    |  |  +------------------+    +------------------+                |  |
    |  |  |    PostgreSQL    |    |    Discord       |                |  |
    |  |  |   (Railway DB)   |    |    Notifier      |                |  |
    |  |  +------------------+    +------------------+                |  |
    |  +--------------------------------------------------------------+  |
    +--------------------------------------------------------------------+
             |
             | Authenticated HTTPS
             | (Cloudflare Tunnel)
             v
    +--------+---------+
    |   LOCAL MACHINE  |
    |  +-------------+ |
    |  |   Ollama    | |
    |  | (llama3.2)  | |
    |  +-------------+ |
    |  +-------------+ |
    |  | Cloudflare  | |
    |  |   Tunnel    | |
    |  +-------------+ |
    +------------------+
```

---

## Component Breakdown

### 1. Railway Orchestrator Service

**Purpose**: Central coordination of the triage pipeline

**Technology**: Node.js with Fastify web framework

**Responsibilities**:
- Receive and validate HubSpot webhooks
- Coordinate async processing pipeline
- Manage LLM provider selection and fallback
- Handle JSON validation and repair
- Send Discord notifications
- Maintain idempotency state

**Key Characteristics**:
- Stateless (all state in PostgreSQL)
- Single deployable unit
- Environment-based configuration
- Structured JSON logging

### 2. Webhook Handler

**Purpose**: Fast acknowledgment and payload normalization

**Responsibilities**:
- Validate `X-Webhook-Token` authentication
- Parse and validate JSON payload
- Transform HubSpot format to internal canonical format
- Return 200 OK within 500ms (fast-ack pattern)
- Queue async processing

**Design Decisions**:
- Synchronous auth/validation, async processing
- No payload storage (process immediately, check idempotency)
- Fail-fast on validation errors (400 response)

### 3. Idempotency Manager

**Purpose**: Prevent duplicate ticket processing

**Technology**: PostgreSQL with unique constraint

**Responsibilities**:
- Check if ticket_id was already processed
- Store processed ticket_ids with metadata
- Handle race conditions via atomic operations
- Clean up records older than 7 days

**Design Decisions**:
- Fail-open on database unavailability (prefer duplicates over lost tickets)
- Store after successful Discord notification (not before)
- Atomic INSERT ON CONFLICT for race condition handling

### 4. Inference Strategy

**Purpose**: Cost-optimized LLM triage with high availability

**Responsibilities**:
- Attempt local Ollama first (8-10s timeout)
- Fall back to Groq on local failure
- Construct triage prompt with ticket data
- Parse LLM response text

**Provider Configuration**:
| Provider | Endpoint | Timeout | Temperature |
|----------|----------|---------|-------------|
| Local Ollama | `{LOCAL_LLM_URL}/api/generate` | 10s | 0.2 |
| Groq | `api.groq.com/openai/v1/chat/completions` | 15s | 0.2 |

### 5. Validation & Repair

**Purpose**: Ensure LLM output conforms to schema

**Technology**: Zod for TypeScript schema validation

**Responsibilities**:
- Parse JSON from LLM response
- Validate against triage output schema
- Extract JSON from surrounding text if needed
- Attempt one repair call on validation failure
- Generate "triage failed" notification on irreparable output

### 6. Discord Notifier

**Purpose**: Deliver formatted triage recommendations

**Responsibilities**:
- Construct Discord embed from triage output
- Apply color coding based on priority
- Include @here mentions for critical issues
- Handle retry with exponential backoff
- Truncate content to fit Discord limits

### 7. PostgreSQL Database

**Purpose**: Persistent storage for idempotency

**Technology**: Railway-managed PostgreSQL

**Schema**:
```sql
CREATE TABLE processed_tickets (
    ticket_id VARCHAR(255) PRIMARY KEY,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    provider VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_processed_at ON processed_tickets(processed_at);
```

### 8. Local Ollama + Tunnel

**Purpose**: Cost-effective local inference

**Components**:
- Ollama runtime with llama3.2 model
- Cloudflare Tunnel for secure HTTPS exposure
- Token-based authentication at tunnel level

---

## Data Flow

### Happy Path (Local Success)

```
1. HubSpot Workflow
   |-- Trigger: New ticket created
   |-- Action: POST to Railway webhook

2. Webhook Handler (Railway)
   |-- Validate X-Webhook-Token header
   |-- Parse JSON payload
   |-- Normalize to internal format
   |-- Return 200 OK (fast-ack)
   |-- Queue async processing

3. Async Pipeline (Railway)
   |
   +-- Idempotency Check
   |   |-- Query PostgreSQL for ticket_id
   |   |-- Result: Not found (new ticket)
   |
   +-- Inference (Local)
   |   |-- POST to Cloudflare Tunnel URL
   |   |-- Ollama processes in 6-8s
   |   |-- Return JSON response
   |
   +-- Validation
   |   |-- Parse JSON
   |   |-- Validate schema with Zod
   |   |-- Result: Valid
   |
   +-- Discord Notification
   |   |-- Construct embed
   |   |-- POST to Discord webhook
   |   |-- Result: 204 No Content
   |
   +-- Idempotency Store
       |-- INSERT ticket_id into PostgreSQL
       |-- Result: Success

4. Support Team
   |-- Receive Discord notification
   |-- Review triage recommendations
   |-- Click HubSpot link
   |-- Take action (send reply, create Asana ticket, etc.)
```

### Fallback Path (Local Timeout -> Groq)

```
3. Async Pipeline (Railway)
   |
   +-- Idempotency Check (same as above)
   |
   +-- Inference (Local) FAILS
   |   |-- POST to Cloudflare Tunnel URL
   |   |-- 10 second timeout exceeded
   |   |-- Log: local_attempt=timeout
   |
   +-- Inference (Groq Fallback)
   |   |-- POST to Groq API
   |   |-- Groq processes in 2-4s
   |   |-- Return JSON response
   |   |-- Log: provider=groq, fallback_reason=timeout
   |
   +-- (Continue with Validation, Discord, Idempotency)
```

### Error Path (Both Providers Fail)

```
3. Async Pipeline (Railway)
   |
   +-- Inference (Local) FAILS (timeout)
   +-- Inference (Groq) FAILS (503 error)
   |
   +-- Error Handling
       |-- Log: both_providers_failed
       |-- Construct "triage failed" Discord embed
       |-- Include ticket_id, HubSpot link, error summary
       |-- POST to Discord
       |-- Support team manually triages ticket
```

---

## Technology Stack

### Runtime & Framework
| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Node.js 20 LTS | Wide ecosystem, async-first, Railway native support |
| Framework | Fastify | 2x faster than Express, built-in validation, TypeScript support |
| Language | TypeScript | Type safety, better tooling, Zod integration |

### Data & Storage
| Component | Technology | Rationale |
|-----------|------------|-----------|
| Database | PostgreSQL (Railway) | ACID compliance, Railway-native, sufficient for volume |
| ORM | Prisma | Type-safe queries, migrations, PostgreSQL optimized |
| Caching | None (Phase 1) | Simplicity - PostgreSQL sufficient for MVP volume |

### LLM & Inference
| Component | Technology | Rationale |
|-----------|------------|-----------|
| Local LLM | Ollama + llama3.2 | Free, fast, privacy-preserving |
| Cloud LLM | Groq | Fast inference, OpenAI-compatible API, cost-effective |
| Tunnel | Cloudflare Tunnel | Free, stable, built-in auth support |

### Validation & Utilities
| Component | Technology | Rationale |
|-----------|------------|-----------|
| Schema Validation | Zod | TypeScript-first, excellent error messages |
| HTTP Client | undici (built-in) | Node.js native, performant |
| Logging | Pino | Structured JSON, high performance |
| Environment | dotenv | Standard .env file support |

### DevOps & Deployment
| Component | Technology | Rationale |
|-----------|------------|-----------|
| Hosting | Railway | Simple deployment, PostgreSQL included, automatic HTTPS |
| CI/CD | Railway automatic deploys | Git push triggers deploy |
| Monitoring | Railway metrics + Pino logs | Built-in dashboards, log aggregation |

---

## Key Design Patterns

### 1. Fast-Ack Pattern
Return HTTP 200 immediately after validation, process asynchronously.

**Benefits**:
- Prevents HubSpot webhook timeouts and retries
- Decouples intake rate from processing rate
- Improves perceived reliability

**Implementation**:
```typescript
app.post('/webhook/hubspot', async (req, reply) => {
  // Sync: validate auth + payload
  validateAuth(req);
  const ticket = normalizePayload(req.body);

  // Return immediately
  reply.code(200).send({ status: 'accepted', ticket_id: ticket.ticket_id });

  // Async: process in background (don't await)
  processTicket(ticket).catch(logError);
});
```

### 2. Strategy Pattern for Providers
Encapsulate provider-specific logic, enable easy switching.

**Benefits**:
- Clean separation of local vs. cloud logic
- Easy to add new providers (Anthropic, OpenAI)
- Testable with mock providers

### 3. Circuit Breaker (Future Enhancement)
Track local provider health, skip unhealthy provider temporarily.

**Implementation (Phase 2)**:
- Track consecutive failures per provider
- After 5 failures, "open" circuit for 60 seconds
- Direct traffic to fallback during open state

### 4. Idempotent Processing
Use unique constraint to ensure exactly-once semantics.

**Benefits**:
- Safe webhook retries
- No duplicate notifications
- Atomic operation handles race conditions

---

## Scalability Considerations

### Current Design Capacity
| Metric | Capacity | Notes |
|--------|----------|-------|
| Tickets/day | 100-200 | Limited by Railway free tier (if applicable) |
| Concurrent requests | 50 | Fastify default, adjustable |
| Database records | ~10,000 | 7-day retention * 200/day |

### Scaling Path (Future)
1. **Horizontal scaling**: Railway supports multiple instances with shared PostgreSQL
2. **Connection pooling**: Add PgBouncer if connection limits reached
3. **Caching**: Add Redis for idempotency if PostgreSQL becomes bottleneck
4. **Queue**: Add BullMQ for processing queue if rate limiting needed

---

## Failure Modes & Recovery

| Failure | Detection | Recovery | Impact |
|---------|-----------|----------|--------|
| Local Ollama down | Timeout/connection error | Automatic Groq fallback | Increased cost, no UX impact |
| Groq API down | 5xx response | "Triage failed" notification | Manual triage required |
| PostgreSQL down | Connection error | Fail-open (process anyway) | Possible duplicates |
| Discord webhook down | 5xx/timeout | Retry 2x, then log for manual | Delayed notifications |
| Railway service crash | Platform monitoring | Automatic restart | Brief gap in processing |

---

## Security Overview

See `security-architecture.md` for detailed security design.

**Key Security Measures**:
- Token-based webhook authentication
- Cloudflare Tunnel authentication for local Ollama
- Prompt injection defenses in LLM prompt
- No sensitive data in logs
- HTTPS everywhere

---

## Monitoring & Observability

### Metrics (via Logs)
- `webhook_received`: Count, latency
- `inference_attempt`: Provider, success/failure, latency
- `validation_result`: Success, repair_needed, failed
- `discord_notification`: Success, retry_count
- `idempotency_hit`: Duplicate detected

### Alerts (Phase 2)
- Success rate < 95% over 1 hour
- Local inference rate < 50% (tunnel likely down)
- Discord failures > 5/hour
- PostgreSQL connection failures

### Dashboards
- Railway built-in metrics (CPU, memory, requests)
- Custom log queries in Railway Logs

---

## Dependencies & External Services

| Service | Purpose | SLA Dependency | Fallback |
|---------|---------|----------------|----------|
| HubSpot | Ticket source | Low - async webhooks | Manual ticket review |
| Discord | Notifications | Medium - team workflow | Log for manual notification |
| Groq | Fallback LLM | High - reliability guarantee | "Triage failed" notification |
| Railway | Hosting | Critical - system availability | None (single provider) |
| Cloudflare | Tunnel | Medium - local access | Groq fallback |

---

## Document References

- **Technical Decisions**: `technical-decisions.md` - ADRs for key architectural choices
- **API Contracts**: `api-contracts.md` - Detailed endpoint specifications
- **Security Architecture**: `security-architecture.md` - Security design and controls
- **Infrastructure Design**: `infrastructure-design.md` - Deployment and configuration
- **Implementation Plan**: `implementation-plan.md` - Build sequence and testing strategy

---

**Approved By**: Architecture Agent
**Review Date**: 2025-12-14
**Next Review**: Post-Phase 1 launch
