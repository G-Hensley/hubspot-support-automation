# Product Requirements Document: HubSpot Support Triage Automation

## Executive Summary

The HubSpot Support Triage Automation system is an intelligent assistant that receives new support tickets from HubSpot, analyzes them using hybrid LLM inference (local Ollama with Groq fallback), and delivers structured triage recommendations via Discord notifications. This system augments the support team's decision-making by providing priority classifications, handling recommendations, draft responses, and internal action suggestions - while **never taking automated actions** that could impact customers or create obligations.

**Strategic Value**: Reduce support team response time by 40-60%, improve consistency in ticket prioritization, and enable faster escalation of critical issues while maintaining full human control over all customer-facing and task-creation actions.

**Target Launch**: Phase 1 (MVP) within 4-6 weeks

## Problem Statement

### Current State
Support teams manually review every incoming HubSpot ticket to:
- Assess priority and urgency
- Determine handling approach (immediate reply, escalation, more information needed)
- Draft initial customer responses
- Decide if internal engineering/security escalation is needed
- Create Asana tickets for bugs, feedback, or escalations

### Pain Points
1. **Response Time Variability**: First response time ranges from 15 minutes to 4+ hours depending on team availability and ticket complexity
2. **Inconsistent Prioritization**: Different support team members may prioritize similar issues differently
3. **Context Switching Cost**: Each new ticket requires full context loading and decision-making
4. **Delayed Critical Issue Detection**: Security or outage-related tickets may not be immediately identified in high-volume periods
5. **Repetitive Work**: Many tickets follow standard patterns but still require manual triage

### Impact
- **Customer Satisfaction**: Delayed responses correlate with 23% lower CSAT scores
- **Team Efficiency**: Support team spends 35-40% of time on triage vs. actual problem resolution
- **Escalation Delays**: Average 45-minute delay from ticket receipt to engineering escalation for critical bugs

## Proposed Solution

An automated triage pipeline that:

1. **Receives Webhooks**: HubSpot workflow sends new ticket data to a Railway-hosted endpoint
2. **Intelligent Analysis**: Hybrid LLM system (local Ollama first, Groq fallback) analyzes ticket content against support SOPs and generates structured recommendations
3. **Structured Output**: Produces validated JSON with priority, handling mode, draft responses, and internal action recommendations
4. **Team Notification**: Posts rich Discord embed with all triage information and HubSpot ticket link
5. **Human-in-the-Loop**: Support team reviews recommendations and takes all final actions

### Key Differentiator
Unlike fully automated support systems, this solution is **recommendation-only**. It never sends emails, creates tasks, or takes any action that could create customer obligations or internal commitments. This ensures:
- Full human oversight for all customer communication
- No risk of inappropriate automated responses
- Flexibility to override recommendations
- Audit trail of human decisions

## Scope

### In-Scope (Phase 1 MVP)

**Core Functionality**:
- HubSpot webhook intake with authentication
- Hybrid inference strategy (local Ollama → Groq fallback)
- Structured JSON output with validation and repair
- Discord notification with rich embeds
- Idempotency to prevent duplicate processing
- Basic observability (logging provider usage, success/failure)

**Triage Capabilities**:
- Priority classification (low/medium/high/critical)
- Handling mode recommendation (5 modes)
- Customer-facing reply drafts
- Internal action recommendations
- Asana ticket type suggestions (advisory only)
- Confidence scoring

**Deployment**:
- Railway-hosted orchestrator service
- Local Ollama via secure tunnel
- Environment-based configuration

### In-Scope (Phase 2 - Future)

**Enhanced Intelligence**:
- RAG over support documentation and APIsec product docs
- Vector embeddings for context retrieval
- Historical ticket pattern analysis
- Customer tier-based response customization

**Advanced Features**:
- Multi-language support detection and routing
- Sentiment analysis for escalation
- Similar ticket detection
- Auto-tagging for reporting

### Out-of-Scope

**Explicitly NOT Included**:
- Automatic email sending to customers
- Automatic Asana ticket creation
- Automatic HubSpot field updates
- Automatic assignment to team members
- SLA enforcement automation
- Customer data storage (beyond transient idempotency tracking)
- Full HubSpot integration app with OAuth

### Non-Goals

- Replacing human support team members
- Achieving 100% accuracy in triage (target: 85%+ helpful recommendations)
- Supporting all HubSpot object types (focus on tickets only)
- Real-time chat/live support integration
- Multi-platform support (email, Slack, etc.) in Phase 1

## Target Users

### Primary Persona: Support Team Member

**Profile**:
- Role: Customer Support Specialist
- Experience: 1-3 years in technical support
- Daily Workflow: Monitors HubSpot and Discord, responds to 15-25 tickets/day
- Pain Points: Context switching, prioritization decisions, draft writing

**Needs**:
1. Fast initial assessment when new tickets arrive
2. Confidence in priority recommendations
3. Quality draft responses to reduce writing time
4. Clear escalation guidance
5. Quick access to original ticket in HubSpot

**Success Criteria**:
- Can triage a ticket in under 2 minutes (vs. 5-8 minutes manually)
- Trusts recommendations enough to use drafts as starting points 70%+ of the time
- Catches critical issues within 5 minutes of ticket creation

### Secondary Persona: Support Team Lead

**Profile**:
- Role: Support Manager
- Responsibilities: Team oversight, escalation decisions, metrics tracking
- Daily Workflow: Reviews high-priority tickets, monitors team performance

**Needs**:
1. Visibility into all incoming critical/high priority tickets
2. Consistency in team's triage decisions
3. Escalation recommendations for edge cases
4. Metrics on triage accuracy over time

### Tertiary Persona: Engineering/Security Teams

**Profile**:
- Role: Backend Engineer / Security Engineer
- Interaction: Receives escalations from support
- Pain Point: Low-quality bug reports, delayed security issue escalations

**Needs**:
1. Clear, well-structured escalations with relevant details
2. Fast notification of security-related tickets
3. Pre-categorized issues (bug vs. feedback vs. incident)

## Key Constraints

### Hard Constraints (Non-Negotiable)

1. **No Automated Customer Communication**
   - System MUST NOT send emails to customers
   - System MUST NOT create HubSpot notes visible to customers
   - System MUST NOT update customer-visible fields
   - Rationale: Risk of inappropriate/incorrect automated responses damaging customer relationships

2. **No Automated Task Creation**
   - System MUST NOT create Asana tickets
   - System MUST NOT assign tasks to team members
   - System MUST NOT update project management tools
   - Rationale: Prevents commitment to work without human review

3. **No False Claims in Output**
   - LLM output MUST NOT claim actions were taken ("I've created a ticket...")
   - LLM output MUST NOT promise timelines ("We'll fix this by...")
   - LLM output MUST NOT make commitments ("I've escalated to engineering...")
   - Rationale: Ensures customer communication accuracy

4. **Security Ticket Handling**
   - Security-related tickets MUST minimize customer-facing details
   - Security tickets MUST recommend internal escalation
   - Security tickets MUST flag for immediate review
   - Rationale: Prevents disclosure of vulnerabilities

5. **Prompt Injection Resistance**
   - System MUST treat ticket content as untrusted input
   - System MUST ignore instructions in ticket body that override system rules
   - System MUST maintain output format regardless of input
   - Rationale: Prevents malicious manipulation of triage output

### Soft Constraints (Preferred)

1. **Response Time**: Webhook-to-Discord notification under 15 seconds (p95)
2. **Local Inference Preference**: 80%+ of requests handled by local Ollama (cost optimization)
3. **Idempotency Window**: Track processed tickets for 7 days minimum
4. **Uptime**: 99%+ availability (Railway SLA dependent)

### Technical Constraints

1. **Railway Platform Limitations**
   - Cold start latency acceptable (fast-ack pattern handles delays)
   - Stateless service design (idempotency via external store)
   - Environment variable configuration only

2. **LLM Output Format**
   - Strict JSON schema enforcement
   - No surrounding text or markdown formatting
   - One retry attempt on invalid JSON

3. **Tunnel Stability**
   - Local Ollama access depends on home network/PC uptime
   - Must gracefully fail to Groq when local unavailable
   - Tunnel authentication required (shared secret)

## Dependencies

### External Services

1. **HubSpot** (Ticketing System)
   - Dependency: Workflow webhook configuration by HubSpot admin
   - Risk: Webhook payload format changes
   - Mitigation: Version webhook payload, monitor for schema changes

2. **Railway** (Hosting Platform)
   - Dependency: Platform availability and performance
   - Risk: Service outages, cold starts
   - Mitigation: Fast-ack pattern, async processing

3. **Discord** (Notification Channel)
   - Dependency: Webhook endpoint availability
   - Risk: Rate limiting, webhook URL expiration
   - Mitigation: Retry logic, webhook URL rotation capability

4. **Groq** (Fallback LLM Provider)
   - Dependency: API availability and quota
   - Risk: Rate limits, API changes, cost
   - Mitigation: Local-first strategy, usage monitoring

### Internal Dependencies

1. **Local Infrastructure**
   - Dependency: Local machine running Ollama (developer's PC)
   - Risk: PC sleep, network outages, tunnel failures
   - Mitigation: Groq fallback handles 100% of failures

2. **Tunnel Service** (Cloudflare/Tailscale/ngrok)
   - Dependency: Stable HTTPS tunnel to local Ollama
   - Risk: Tunnel disconnections, auth issues
   - Mitigation: Health check endpoint, automatic fallback

3. **Idempotency Store** (Redis/SQLite/Postgres)
   - Dependency: Persistent storage for processed ticket IDs
   - Risk: Data loss causing duplicate notifications
   - Mitigation: Choice of Railway-provided database with backups

### Process Dependencies

1. **HubSpot Workflow Configuration**
   - Owner: HubSpot administrator
   - Timeline: Must be configured before system launch
   - Deliverable: Workflow that triggers webhook on new ticket creation

2. **Discord Channel Setup**
   - Owner: Support team lead
   - Timeline: Before system launch
   - Deliverable: Dedicated channel, webhook URL

3. **Support SOP Documentation**
   - Owner: Support team
   - Timeline: Phase 1 uses embedded SOPs, Phase 2 requires indexed docs
   - Deliverable: Structured support standard operating procedures

## Assumptions

### User Behavior Assumptions

1. Support team members actively monitor the designated Discord channel during business hours
2. Team will provide feedback on triage accuracy to enable continuous improvement
3. Team members have sufficient context to override recommendations when needed
4. Average ticket volume: 30-50 tickets/day (validates infrastructure sizing)

### Technical Assumptions

1. HubSpot webhook payload includes: ticket ID, subject, body, customer email, creation timestamp
2. HubSpot webhooks retry on 5xx responses (validates fast-ack pattern)
3. Local Ollama can respond within 8-10 seconds for typical ticket analysis
4. Groq API provides sufficient quota for 100% fallback coverage if needed
5. Railway service can maintain persistent connections for tunnel access
6. Discord embed limits (6000 chars) sufficient for triage summaries

### Business Assumptions

1. Current support team workload justifies investment in automation
2. Support team has capacity to review all recommendations (no blind auto-actions)
3. Cost of Groq fallback usage acceptable vs. value of uptime (estimate: $20-40/month at full fallback)
4. Phase 2 RAG investment justified by Phase 1 success metrics

### Data Assumptions

1. Ticket content is in English (multi-language support deferred to Phase 2)
2. Ticket body contains sufficient context for initial triage (80%+ of cases)
3. Customer tier information available in HubSpot payload or inferrable
4. Security-related keywords reliably detectable in ticket content

## Success Metrics (Detailed in success-metrics.md)

**Primary Metrics**:
- Average time-to-first-response: Reduce by 40%
- Triage decision time: Reduce from 5-8 min to under 2 min
- Critical issue detection time: Under 5 minutes for 95% of cases

**Quality Metrics**:
- Recommendation acceptance rate: 70%+ (team uses draft or follows handling mode)
- Triage accuracy: 85%+ priority classification matches human assessment
- False critical rate: Under 5%

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| LLM generates inappropriate response | High - Customer relationship damage | Medium | Human-in-loop design, no auto-send, content filters |
| Local Ollama extended downtime | Medium - Increased costs | Medium | Groq fallback, cost monitoring alerts |
| Webhook payload changes | High - System breaks | Low | Payload validation, version monitoring |
| Discord rate limiting | Medium - Delayed notifications | Low | Rate limit handling, batch notifications |
| Prompt injection attack | High - System manipulation | Medium | Input sanitization, strict output validation |
| Duplicate ticket processing | Low - Notification spam | Medium | Idempotency store with 7-day retention |

## Compliance & Security

### Data Handling
- Ticket content processed transiently (not stored beyond idempotency tracking)
- No customer PII stored in logs or databases
- Webhook authentication via shared secret (HubSpot → Railway)
- Tunnel authentication via token (Railway → Local Ollama)

### Privacy Considerations
- LLM processing may involve sending ticket content to Groq (third-party)
- Recommendation: Customer privacy notice update if using cloud LLM
- Local Ollama preferred for sensitive customer data (data never leaves infrastructure)

## Launch Plan

### Rollout Strategy
1. **Week 1-2**: Internal testing with synthetic tickets
2. **Week 3**: Shadow mode (notifications sent to test Discord channel, team continues normal workflow)
3. **Week 4**: Beta launch (live notifications, team uses recommendations for 20% of tickets)
4. **Week 5-6**: Full rollout (team uses recommendations for all tickets)

### Training Required
- 30-minute team session: System overview, Discord notification format, override procedures
- Quick reference guide: How to interpret handling modes, when to trust vs. override
- Feedback mechanism: Slack channel or form for reporting incorrect recommendations

### Communication Plan
- **Internal Announcement**: 1 week before shadow mode begins
- **Beta Launch**: Email to support team with expectations and success metrics
- **Full Launch**: Company-wide announcement highlighting support team efficiency gains

### Success Criteria for Full Launch
- System uptime: 99%+ during beta period
- Recommendation acceptance rate: 60%+ during beta
- Zero incidents of inappropriate automated actions (by design - should be impossible)
- Support team satisfaction: 7/10 or higher on usefulness survey

## Stakeholder Approval

**Product Owner**: [Name/Email]
**Support Team Lead**: [Name/Email]
**Engineering Lead**: [Name/Email]
**Security Review**: Required before processing production tickets

**Approval Status**: Draft - Pending Review

---

**Document Version**: 1.0
**Last Updated**: 2025-12-14
**Next Review**: Post-architecture review (before development begins)
