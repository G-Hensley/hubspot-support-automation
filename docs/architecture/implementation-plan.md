# Implementation Plan: HubSpot Support Triage Automation

**Version**: 1.0
**Last Updated**: 2025-12-14
**Status**: Approved for Implementation

This document provides the implementation roadmap, including folder structure, build sequence, testing strategy, and deployment checklist.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Implementation Sequence](#2-implementation-sequence)
3. [Sprint Breakdown](#3-sprint-breakdown)
4. [Integration Points](#4-integration-points)
5. [Testing Strategy](#5-testing-strategy)
6. [Deployment Checklist](#6-deployment-checklist)
7. [Handoff to Implementation](#7-handoff-to-implementation)

---

## 1. Project Structure

### Recommended Folder Structure

```
hubspot-support-automation/
├── .github/
│   └── workflows/
│       └── deploy.yml              # CI/CD pipeline
├── docs/
│   ├── architecture/               # Architecture documents (this folder)
│   │   ├── architecture-overview.md
│   │   ├── technical-decisions.md
│   │   ├── api-contracts.md
│   │   ├── security-architecture.md
│   │   ├── infrastructure-design.md
│   │   └── implementation-plan.md
│   └── product/                    # Product documents
│       ├── product-requirements.md
│       ├── user-stories.md
│       ├── success-metrics.md
│       └── feature-specifications.md
├── prisma/
│   ├── schema.prisma               # Database schema
│   └── migrations/                 # Database migrations
├── src/
│   ├── index.ts                    # Application entry point
│   ├── server.ts                   # Fastify server setup
│   ├── config/
│   │   ├── index.ts                # Configuration loader
│   │   └── environment.ts          # Environment validation
│   ├── routes/
│   │   ├── index.ts                # Route registration
│   │   ├── webhook.ts              # POST /webhook/hubspot
│   │   └── health.ts               # GET /health
│   ├── services/
│   │   ├── index.ts                # Service exports
│   │   ├── triage.service.ts       # Main triage orchestration
│   │   ├── inference.service.ts    # LLM provider management
│   │   ├── validation.service.ts   # JSON validation & repair
│   │   ├── discord.service.ts      # Discord notification
│   │   └── idempotency.service.ts  # Duplicate prevention
│   ├── providers/
│   │   ├── index.ts                # Provider exports
│   │   ├── base.provider.ts        # Abstract provider interface
│   │   ├── ollama.provider.ts      # Local Ollama provider
│   │   └── groq.provider.ts        # Groq API provider
│   ├── schemas/
│   │   ├── index.ts                # Schema exports
│   │   ├── webhook.schema.ts       # Webhook payload validation
│   │   ├── ticket.schema.ts        # Internal ticket format
│   │   └── triage.schema.ts        # LLM output validation
│   ├── prompts/
│   │   ├── index.ts                # Prompt exports
│   │   ├── system.prompt.ts        # System prompt template
│   │   └── repair.prompt.ts        # Repair prompt template
│   ├── utils/
│   │   ├── index.ts                # Utility exports
│   │   ├── logger.ts               # Pino logger setup
│   │   ├── retry.ts                # Retry with backoff
│   │   └── normalize.ts            # Payload normalization
│   └── types/
│       └── index.ts                # TypeScript type definitions
├── tests/
│   ├── unit/
│   │   ├── services/
│   │   │   ├── validation.test.ts
│   │   │   ├── inference.test.ts
│   │   │   └── discord.test.ts
│   │   └── providers/
│   │       ├── ollama.test.ts
│   │       └── groq.test.ts
│   ├── integration/
│   │   ├── webhook.test.ts         # Webhook endpoint tests
│   │   └── triage.test.ts          # Full pipeline tests
│   └── fixtures/
│       ├── webhooks/               # Sample webhook payloads
│       │   ├── valid-ticket.json
│       │   ├── security-ticket.json
│       │   └── malformed-ticket.json
│       └── llm-outputs/            # Sample LLM responses
│           ├── valid-output.json
│           ├── invalid-json.txt
│           └── invalid-schema.json
├── .env.example                    # Environment template
├── .gitignore
├── .eslintrc.js                    # ESLint configuration
├── .prettierrc                     # Prettier configuration
├── package.json
├── tsconfig.json                   # TypeScript configuration
├── railway.toml                    # Railway deployment config
├── CLAUDE.md                       # AI assistant guidance
├── PROJECT_SPEC.md                 # Project specification
└── README.md                       # Project documentation
```

### Key File Descriptions

| File | Purpose |
|------|---------|
| `src/index.ts` | Application bootstrap, starts server |
| `src/server.ts` | Fastify instance, middleware, error handling |
| `src/services/triage.service.ts` | Orchestrates full triage pipeline |
| `src/services/inference.service.ts` | Manages local-first, Groq fallback strategy |
| `src/providers/base.provider.ts` | Abstract interface for LLM providers |
| `src/schemas/triage.schema.ts` | Zod schema for LLM output validation |
| `src/prompts/system.prompt.ts` | System prompt with SOPs and rules |

---

## 2. Implementation Sequence

### Dependency Graph

```
┌─────────────────┐
│ 1. Project      │
│    Setup        │
└────────┬────────┘
         │
         v
┌─────────────────┐     ┌─────────────────┐
│ 2. Config &     │────>│ 3. Database     │
│    Logging      │     │    (Prisma)     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         v                       v
┌─────────────────┐     ┌─────────────────┐
│ 4. Schemas      │     │ 5. Idempotency  │
│    (Zod)        │     │    Service      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         v                       │
┌─────────────────┐              │
│ 6. Webhook      │<─────────────┘
│    Handler      │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ 7. LLM Prompts  │
│                 │
└────────┬────────┘
         │
         v
┌─────────────────┐     ┌─────────────────┐
│ 8. Ollama       │     │ 9. Groq         │
│    Provider     │     │    Provider     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         v                       v
┌─────────────────────────────────────────┐
│ 10. Inference Service                   │
│     (Provider orchestration)            │
└─────────────────┬───────────────────────┘
                  │
                  v
┌─────────────────────────────────────────┐
│ 11. Validation Service                  │
│     (JSON validation + repair)          │
└─────────────────┬───────────────────────┘
                  │
                  v
┌─────────────────────────────────────────┐
│ 12. Discord Service                     │
│     (Notification formatting)           │
└─────────────────┬───────────────────────┘
                  │
                  v
┌─────────────────────────────────────────┐
│ 13. Triage Service                      │
│     (Full pipeline orchestration)       │
└─────────────────┬───────────────────────┘
                  │
                  v
┌─────────────────────────────────────────┐
│ 14. Integration & E2E Tests             │
│                                         │
└─────────────────┬───────────────────────┘
                  │
                  v
┌─────────────────────────────────────────┐
│ 15. Deployment & Infrastructure         │
│                                         │
└─────────────────────────────────────────┘
```

### Implementation Order Rationale

1. **Project Setup First**: Establishes foundation (TypeScript, Fastify, testing framework)
2. **Config & Logging Early**: Required by all other components
3. **Database Before Services**: Idempotency depends on database
4. **Schemas Before Handlers**: Validation logic used everywhere
5. **Providers Before Inference**: Inference service orchestrates providers
6. **Bottom-Up Integration**: Each layer tested before integration

---

## 3. Sprint Breakdown

### Sprint 1 (Week 1-2): Foundation

**Goal**: Basic webhook endpoint receiving and validating HubSpot requests

**Tasks**:

| Task | Est. Hours | Priority | Dependencies |
|------|------------|----------|--------------|
| Project setup (npm, TypeScript, Fastify) | 2 | P0 | None |
| Config module with env validation | 2 | P0 | Project setup |
| Pino logging setup | 1 | P0 | Config |
| Prisma setup + database schema | 3 | P0 | Project setup |
| Webhook payload Zod schema | 2 | P0 | Project setup |
| Internal ticket schema | 1 | P0 | Webhook schema |
| Webhook route handler | 4 | P0 | Schemas, logging |
| Health check endpoint | 1 | P1 | Fastify setup |
| Idempotency service | 4 | P0 | Prisma |
| Unit tests for validation | 4 | P0 | Schemas |

**Deliverables**:
- [ ] Webhook endpoint accepting valid HubSpot payloads
- [ ] Auth token validation working
- [ ] Payload normalization working
- [ ] Fast-ack response pattern implemented
- [ ] Idempotency preventing duplicates
- [ ] Unit tests passing

### Sprint 2 (Week 2-3): LLM Integration

**Goal**: Working hybrid inference with local Ollama and Groq fallback

**Tasks**:

| Task | Est. Hours | Priority | Dependencies |
|------|------------|----------|--------------|
| System prompt template | 3 | P0 | None |
| Repair prompt template | 1 | P0 | System prompt |
| Triage output Zod schema | 2 | P0 | None |
| Base LLM provider interface | 2 | P0 | None |
| Ollama provider implementation | 4 | P0 | Base provider |
| Groq provider implementation | 3 | P0 | Base provider |
| Inference service (orchestration) | 4 | P0 | Both providers |
| Validation service (JSON + repair) | 4 | P0 | Triage schema |
| Unit tests for providers | 4 | P0 | Providers |
| Unit tests for validation | 3 | P0 | Validation service |

**Deliverables**:
- [ ] Local Ollama provider working
- [ ] Groq fallback provider working
- [ ] Automatic fallback on local failure
- [ ] JSON validation catching invalid output
- [ ] Repair prompt recovering from common errors
- [ ] Unit tests passing

### Sprint 3 (Week 3-4): Discord & Pipeline

**Goal**: Full end-to-end triage pipeline with Discord notifications

**Tasks**:

| Task | Est. Hours | Priority | Dependencies |
|------|------------|----------|--------------|
| Discord embed builder | 3 | P0 | Triage schema |
| Discord webhook client | 2 | P0 | None |
| Retry logic for Discord | 2 | P1 | Discord client |
| Critical issue alerts (@here) | 1 | P1 | Discord embed |
| Triage service (orchestration) | 4 | P0 | All services |
| "Triage failed" notification | 2 | P0 | Discord service |
| Integration tests | 6 | P0 | Triage service |
| Prompt injection tests | 3 | P0 | Integration tests |
| Error handling improvements | 2 | P1 | Integration tests |
| Documentation (README) | 2 | P1 | All features |

**Deliverables**:
- [ ] Discord notifications formatted correctly
- [ ] Priority color coding working
- [ ] Critical alerts with @here mentions
- [ ] Full pipeline test passing
- [ ] Prompt injection tests passing
- [ ] README with setup instructions

### Sprint 4 (Week 4-5): Deployment & Hardening

**Goal**: Production deployment on Railway with monitoring

**Tasks**:

| Task | Est. Hours | Priority | Dependencies |
|------|------------|----------|--------------|
| Railway deployment config | 2 | P0 | None |
| CI/CD pipeline (GitHub Actions) | 3 | P0 | Railway config |
| Cloudflare tunnel setup | 3 | P0 | None |
| Cloudflare Access policy | 2 | P0 | Tunnel setup |
| Environment variables in Railway | 1 | P0 | Deployment |
| HubSpot webhook configuration | 2 | P0 | Deployment |
| Production smoke tests | 2 | P0 | HubSpot config |
| Log review and monitoring setup | 2 | P1 | Deployment |
| Security review | 3 | P0 | All |
| Performance testing | 2 | P2 | All |

**Deliverables**:
- [ ] Railway service deployed and healthy
- [ ] Cloudflare tunnel operational
- [ ] CI/CD pipeline deploying on merge
- [ ] HubSpot webhook triggering successfully
- [ ] Full production test passing
- [ ] Security checklist completed

---

## 4. Integration Points

### External Service Integration

```
┌──────────────────────────────────────────────────────────────────┐
│                       INTEGRATION POINTS                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  HubSpot ─────────────────┐                                      │
│  • Configure workflow      │                                      │
│  • Set webhook URL         │                                      │
│  • Add auth token          │                                      │
│                            v                                      │
│                    ┌───────────────┐                             │
│                    │   Railway     │                             │
│                    │   Service     │                             │
│                    └───────┬───────┘                             │
│                            │                                      │
│            ┌───────────────┼───────────────┐                     │
│            │               │               │                     │
│            v               v               v                     │
│     ┌──────────┐   ┌──────────┐   ┌──────────┐                  │
│     │ Ollama   │   │ Groq     │   │ Discord  │                  │
│     │ (Local)  │   │ (Cloud)  │   │ Webhook  │                  │
│     └──────────┘   └──────────┘   └──────────┘                  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Integration Configuration

| Service | Configuration Required | When to Configure |
|---------|----------------------|-------------------|
| **HubSpot** | Workflow webhook URL, auth token | After Railway deployment |
| **Discord** | Webhook URL from channel settings | Before deployment |
| **Groq** | API key from Groq dashboard | Before deployment |
| **Cloudflare** | Tunnel + Access policy | After local Ollama running |
| **Railway** | PostgreSQL, environment variables | During deployment |

### Integration Test Scenarios

```typescript
// tests/integration/pipeline.test.ts

describe('Full Pipeline Integration', () => {
  // Test 1: Happy path - Local Ollama success
  it('should process ticket via local Ollama and notify Discord', async () => {
    // Mock: Ollama returns valid JSON
    // Assert: Discord webhook called with correct embed
    // Assert: Idempotency record created
  });

  // Test 2: Fallback path - Local timeout, Groq success
  it('should fallback to Groq when local times out', async () => {
    // Mock: Ollama times out after 10s
    // Mock: Groq returns valid JSON
    // Assert: Discord webhook called
    // Assert: Logs show fallback occurred
  });

  // Test 3: Duplicate detection
  it('should skip processing for duplicate ticket', async () => {
    // Setup: Process ticket once
    // Action: Send same webhook again
    // Assert: Second request returns 200 with "duplicate" status
    // Assert: Discord not called second time
  });

  // Test 4: Validation failure and repair
  it('should attempt repair on invalid JSON', async () => {
    // Mock: Ollama returns invalid JSON
    // Mock: Repair prompt returns valid JSON
    // Assert: Discord webhook called with repaired output
  });

  // Test 5: Both providers fail
  it('should send failure notification when both providers fail', async () => {
    // Mock: Ollama times out
    // Mock: Groq returns 503
    // Assert: Discord called with "triage failed" embed
  });
});
```

---

## 5. Testing Strategy

### Test Pyramid

```
                    /\
                   /  \
                  / E2E \           <- 5 tests (critical paths only)
                 /      \
                /────────\
               / Integration\       <- 15 tests (API + service layer)
              /            \
             /──────────────\
            /     Unit       \      <- 50+ tests (services, utils, schemas)
           /                  \
          /────────────────────\
```

### Unit Tests

**Coverage Target**: 80% for business logic (services, providers, schemas)

**What to Test**:
- Schema validation (all valid/invalid cases)
- Payload normalization
- Provider response parsing
- Discord embed construction
- Retry logic
- Error handling

**Example Unit Test**:
```typescript
// tests/unit/services/validation.test.ts
import { validateTriageOutput } from '../../../src/services/validation.service';

describe('validateTriageOutput', () => {
  it('should accept valid triage output', () => {
    const valid = {
      priority: 'medium',
      handling_mode: 'reply_only',
      // ... all required fields
      confidence: 0.85
    };
    expect(validateTriageOutput(valid)).toEqual({ success: true, data: valid });
  });

  it('should reject invalid priority value', () => {
    const invalid = { ...validOutput, priority: 'urgent' };
    const result = validateTriageOutput(invalid);
    expect(result.success).toBe(false);
    expect(result.error).toContain('priority');
  });

  it('should reject when reply_needed=true but reply_draft=null', () => {
    const invalid = { ...validOutput, reply_needed: true, reply_draft: null };
    const result = validateTriageOutput(invalid);
    expect(result.success).toBe(false);
  });
});
```

### Integration Tests

**Coverage Target**: All API endpoints, all error paths

**What to Test**:
- Webhook endpoint (auth, validation, async processing)
- Health check endpoint
- Database operations (idempotency)
- Full triage pipeline (mocked external services)

**Test Environment**:
```typescript
// tests/setup.ts
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server';
import { PrismaClient } from '@prisma/client';

let app: FastifyInstance;
let prisma: PrismaClient;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://localhost:5432/triage_test';
  prisma = new PrismaClient();
  app = await buildServer();
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  // Clean test database
  await prisma.processedTicket.deleteMany();
});
```

### E2E Tests

**Coverage Target**: Critical user paths only

**What to Test**:
- Real webhook → Real Discord (staging channel)
- Real HubSpot → Real Railway (staging environment)

**When to Run**:
- Before production deployment
- Weekly scheduled run
- After major changes

### Test Fixtures

```
tests/fixtures/
├── webhooks/
│   ├── valid-ticket.json         # Standard valid payload
│   ├── minimal-ticket.json       # Only required fields
│   ├── security-ticket.json      # Contains security keywords
│   ├── injection-attempt.json    # Prompt injection patterns
│   └── malformed-ticket.json     # Invalid JSON structure
├── llm-outputs/
│   ├── valid-output.json         # Correct triage response
│   ├── valid-security.json       # Security escalation response
│   ├── invalid-json.txt          # Not valid JSON
│   ├── invalid-enum.json         # Invalid enum value
│   ├── missing-field.json        # Missing required field
│   └── markdown-wrapped.json     # JSON in markdown code block
└── discord/
    ├── expected-medium.json      # Expected embed for medium priority
    ├── expected-critical.json    # Expected embed for critical
    └── expected-failed.json      # Expected failure notification
```

### Mocking Strategy

**External Services to Mock**:
| Service | Mock Library | Mock Strategy |
|---------|--------------|---------------|
| Ollama API | nock | Intercept HTTP requests |
| Groq API | nock | Intercept HTTP requests |
| Discord Webhook | nock | Intercept HTTP requests |
| PostgreSQL | Test database | Real DB, clean between tests |

**Mock Example**:
```typescript
import nock from 'nock';

describe('Inference Service', () => {
  beforeEach(() => {
    // Mock local Ollama
    nock(process.env.LOCAL_LLM_URL!)
      .post('/api/generate')
      .reply(200, {
        response: JSON.stringify(validTriageOutput),
        done: true
      });
  });

  afterEach(() => {
    nock.cleanAll();
  });
});
```

---

## 6. Deployment Checklist

### Pre-Deployment (Local Testing)

- [ ] All unit tests passing (`npm test`)
- [ ] All integration tests passing (`npm run test:integration`)
- [ ] TypeScript compilation succeeds (`npm run build`)
- [ ] Linting passes (`npm run lint`)
- [ ] Environment variables documented in `.env.example`
- [ ] README has setup instructions

### Infrastructure Setup

- [ ] **Railway Project**
  - [ ] Create Railway project
  - [ ] Connect GitHub repository
  - [ ] Provision PostgreSQL database
  - [ ] Note DATABASE_URL from Railway

- [ ] **Cloudflare**
  - [ ] Create Cloudflare account
  - [ ] Add domain to Cloudflare
  - [ ] Install cloudflared locally
  - [ ] Create tunnel (`cloudflared tunnel create`)
  - [ ] Configure tunnel (`config.yml`)
  - [ ] Create DNS route for tunnel
  - [ ] Create Access application
  - [ ] Create service token
  - [ ] Note CF-Access-Client-Id and CF-Access-Client-Secret

- [ ] **Local Machine**
  - [ ] Install Ollama
  - [ ] Pull model (`ollama pull llama3.2:latest`)
  - [ ] Start Ollama service
  - [ ] Start cloudflared tunnel
  - [ ] Verify tunnel accessible

- [ ] **External Services**
  - [ ] Get Discord webhook URL from channel settings
  - [ ] Get Groq API key from Groq dashboard

### Railway Environment Variables

- [ ] `DATABASE_URL` (auto-populated)
- [ ] `HUBSPOT_WEBHOOK_TOKEN` (generate secure token)
- [ ] `DISCORD_WEBHOOK_URL` (from Discord)
- [ ] `GROQ_API_KEY` (from Groq)
- [ ] `LOCAL_LLM_URL` (Cloudflare tunnel URL)
- [ ] `CF_ACCESS_CLIENT_ID` (from Cloudflare)
- [ ] `CF_ACCESS_CLIENT_SECRET` (from Cloudflare)
- [ ] `NODE_ENV=production`
- [ ] `LOG_LEVEL=info`

### Deployment

- [ ] Push code to main branch
- [ ] Monitor GitHub Actions workflow
- [ ] Monitor Railway deployment logs
- [ ] Verify health check returns 200
- [ ] Check Railway logs for startup errors

### Post-Deployment Verification

- [ ] **Health Check**
  - [ ] `curl https://[railway-url]/health` returns 200

- [ ] **Webhook Test**
  ```bash
  curl -X POST https://[railway-url]/webhook/hubspot \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Token: [your-token]" \
    -d '{"objectId":123,"subscriptionType":"ticket.creation","portalId":456,"occurredAt":1702555200000,"properties":{"hs_ticket_id":"TEST-001","subject":"Test ticket","content":"This is a test ticket."}}'
  ```
  - [ ] Returns 200 with `status: accepted`
  - [ ] Discord notification received

- [ ] **Local Ollama Test**
  - [ ] Send test webhook
  - [ ] Check logs for `provider=local`

- [ ] **Groq Fallback Test**
  - [ ] Stop local Ollama
  - [ ] Send test webhook
  - [ ] Check logs for `provider=groq, fallback_reason=timeout`
  - [ ] Restart local Ollama

### HubSpot Configuration

- [ ] Create HubSpot workflow for new ticket trigger
- [ ] Add "Send webhook" action
- [ ] Configure webhook URL: `https://[railway-url]/webhook/hubspot`
- [ ] Add custom header: `X-Webhook-Token: [your-token]`
- [ ] Configure payload to include required fields
- [ ] Test workflow with test ticket
- [ ] Verify Discord notification received
- [ ] Activate workflow

### Go-Live

- [ ] Notify support team of new Discord channel
- [ ] Monitor logs for first few production tickets
- [ ] Verify triage quality on initial tickets
- [ ] Document any issues for prompt improvement

---

## 7. Handoff to Implementation

### Architecture Handoff Template

```markdown
## Architecture Handoff: HubSpot Support Triage Automation - Phase 1 MVP

### Design Artifacts
- Architecture Overview: `/docs/architecture/architecture-overview.md`
- Technical Decisions (ADRs): `/docs/architecture/technical-decisions.md`
- API Contracts: `/docs/architecture/api-contracts.md`
- Security Architecture: `/docs/architecture/security-architecture.md`
- Infrastructure Design: `/docs/architecture/infrastructure-design.md`
- Implementation Plan: `/docs/architecture/implementation-plan.md`

### Implementation Scope
Build a complete support ticket triage pipeline that:
1. Receives webhooks from HubSpot (authenticated, validated)
2. Performs LLM-based triage (local Ollama first, Groq fallback)
3. Validates and repairs LLM JSON output
4. Sends formatted notifications to Discord
5. Prevents duplicate processing via idempotency

### Technical Constraints
- **Framework**: Fastify (Node.js 20, TypeScript)
- **Database**: PostgreSQL via Prisma ORM
- **Validation**: Zod for all schemas
- **LLM Providers**: Ollama (local), Groq (cloud fallback)
- **Tunnel**: Cloudflare Tunnel with Access authentication
- **Hosting**: Railway (includes PostgreSQL)

### Success Criteria
- [ ] Webhook endpoint returns 200 within 500ms (fast-ack)
- [ ] Authentication rejects invalid tokens
- [ ] Idempotency prevents duplicate processing
- [ ] Local Ollama used when available (target 80%)
- [ ] Groq fallback works on local failure
- [ ] JSON validation catches invalid output
- [ ] Repair prompt recovers common errors
- [ ] Discord notifications formatted correctly
- [ ] Critical issues trigger @here mention
- [ ] All tests passing (80% coverage)
- [ ] Security checklist completed

### Integration Points
- **HubSpot**: Workflow webhook (configured by HubSpot admin)
- **Discord**: Webhook URL (from channel settings)
- **Groq**: API key (from Groq dashboard)
- **Cloudflare**: Tunnel + Access service token

### Open Questions for Implementation
1. Exact HubSpot webhook payload structure (need sample from admin)
2. Discord channel for notifications (need URL from team lead)
3. Local machine specs for Ollama (verify meets requirements)

### Assigned To
Implementation Agent / Development Team

### Review Process
1. PR review required for all code changes
2. Architecture review for any deviations from spec
3. Security review before production deployment
```

### Key Files for Implementation Team

| File | What to Implement | Reference |
|------|-------------------|-----------|
| `src/routes/webhook.ts` | Webhook handler | api-contracts.md Section 1 |
| `src/routes/health.ts` | Health endpoint | api-contracts.md Section 2 |
| `src/schemas/webhook.schema.ts` | Payload validation | api-contracts.md Section 3 |
| `src/schemas/triage.schema.ts` | Output validation | api-contracts.md Section 5 |
| `src/prompts/system.prompt.ts` | LLM prompt | api-contracts.md Section 4 |
| `src/providers/ollama.provider.ts` | Local LLM | technical-decisions.md ADR-004 |
| `src/providers/groq.provider.ts` | Cloud LLM | technical-decisions.md ADR-002 |
| `src/services/inference.service.ts` | Provider orchestration | architecture-overview.md |
| `src/services/validation.service.ts` | JSON validation | technical-decisions.md ADR-005 |
| `src/services/discord.service.ts` | Discord integration | api-contracts.md Section 6 |
| `src/services/idempotency.service.ts` | Duplicate prevention | technical-decisions.md ADR-001 |

### Definition of Done

A feature is complete when:
- [ ] Code implements the specification exactly
- [ ] Unit tests cover happy path and error cases
- [ ] Integration tests verify API behavior
- [ ] TypeScript compiles without errors
- [ ] ESLint passes with no warnings
- [ ] PR approved by reviewer
- [ ] Documentation updated (if applicable)
- [ ] Deployed to staging and manually verified

---

**Approved By**: Architecture Agent
**Handoff Date**: 2025-12-14
**Implementation Start**: Ready for Sprint 1
