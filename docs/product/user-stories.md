# User Stories: HubSpot Support Triage Automation

## Epic Organization

### Epic 1: Webhook Intake & Processing
**Business Value**: Enable system to receive and validate ticket data from HubSpot
**Timeline**: Sprint 1 (Week 1-2)
**Priority**: Must-Have

### Epic 2: Hybrid LLM Inference
**Business Value**: Provide intelligent triage recommendations using cost-optimized inference
**Timeline**: Sprint 2 (Week 2-3)
**Priority**: Must-Have

### Epic 3: Discord Notifications
**Business Value**: Deliver triage recommendations to support team in their workflow
**Timeline**: Sprint 2 (Week 2-3)
**Priority**: Must-Have

### Epic 4: Reliability & Idempotency
**Business Value**: Ensure consistent, duplicate-free operation
**Timeline**: Sprint 3 (Week 3-4)
**Priority**: Must-Have

### Epic 5: Observability & Monitoring
**Business Value**: Enable troubleshooting and performance tracking
**Timeline**: Sprint 3 (Week 3-4)
**Priority**: Should-Have

---

## Epic 1: Webhook Intake & Processing

### Story 1.1: Receive HubSpot Webhook

**As a** Railway-hosted orchestrator service
**I want to** receive POST requests from HubSpot workflows at `/webhook/hubspot`
**So that** I can process new support tickets as they are created

**Acceptance Criteria**:
- [ ] GIVEN a valid HubSpot webhook POST request WHEN it arrives at `/webhook/hubspot` THEN the service responds with 200 OK within 500ms (fast-ack pattern)
- [ ] GIVEN the webhook payload contains required fields (ticket_id, subject, body) WHEN parsed THEN a normalized ticket object is created
- [ ] GIVEN the webhook payload is missing required fields WHEN validated THEN the service responds with 400 Bad Request and logs the error
- [ ] GIVEN the service is processing a ticket asynchronously WHEN the webhook returns THEN HubSpot receives 200 OK before processing completes

**Business Value**: Ensures reliable ticket intake without blocking HubSpot workflows or causing retry storms

**Priority**: Must-Have (P0)

**Estimated User Impact**: 100% of tickets (30-50/day)

**Dependencies**: None

**Edge Cases**:
- Malformed JSON payload: Return 400 with error details
- Oversized payload (>1MB): Return 413 Payload Too Large
- Network timeout during response: HubSpot retry handled by fast-ack

---

### Story 1.2: Authenticate Webhook Requests

**As a** security-conscious system
**I want to** validate that webhook requests come from HubSpot
**So that** unauthorized sources cannot trigger processing or spam notifications

**Acceptance Criteria**:
- [ ] GIVEN a request with valid `X-Webhook-Token` header matching `HUBSPOT_WEBHOOK_TOKEN` WHEN authenticated THEN the request is processed
- [ ] GIVEN a request with missing or invalid token WHEN authenticated THEN the service responds with 401 Unauthorized and does not process
- [ ] GIVEN an invalid authentication attempt WHEN logged THEN the log includes source IP and timestamp (rate limiting future consideration)
- [ ] GIVEN the webhook token is configured via environment variable WHEN the service starts THEN it loads successfully or fails fast with clear error

**Business Value**: Prevents abuse, spam notifications, and potential cost from unauthorized LLM calls

**Priority**: Must-Have (P0)

**Estimated User Impact**: Security requirement - protects all operations

**Dependencies**: Railway secrets configuration

**Edge Cases**:
- Token in wrong header: Return 401 with hint about expected header name
- Empty token value: Fail service startup with configuration error
- Token rotation: Support reading from multiple valid tokens (future)

---

### Story 1.3: Normalize Ticket Payload

**As a** system component downstream of webhook intake
**I want to** work with a consistent internal ticket object format
**So that** I can reliably access ticket data regardless of HubSpot payload variations

**Acceptance Criteria**:
- [ ] GIVEN a HubSpot webhook payload WHEN normalized THEN the output matches the canonical ticket schema (ticket_id, subject, body, from_email, customer_name, customer_tier, product_area, hubspot_ticket_url, received_at)
- [ ] GIVEN optional fields are missing from HubSpot WHEN normalized THEN they are set to null (not omitted)
- [ ] GIVEN the received_at timestamp is missing WHEN normalized THEN the current UTC timestamp is used
- [ ] GIVEN the HubSpot ticket URL is not provided WHEN normalized THEN it is constructed from ticket_id using HubSpot URL pattern

**Business Value**: Decouples LLM prompt and downstream logic from HubSpot's payload format changes

**Priority**: Must-Have (P0)

**Estimated User Impact**: Internal - enables all downstream processing

**Dependencies**: Understanding of HubSpot webhook payload structure

**Edge Cases**:
- Empty string vs null: Normalize empty strings to null for consistency
- Whitespace-only values: Trim and convert to null
- HTML in ticket body: Preserve as-is (LLM can handle HTML)

---

## Epic 2: Hybrid LLM Inference

### Story 2.1: Call Local Ollama First

**As a** cost-conscious system operator
**I want to** attempt local Ollama inference before using paid Groq API
**So that** I minimize cloud API costs while maintaining fast response times

**Acceptance Criteria**:
- [ ] GIVEN a normalized ticket WHEN triage begins THEN local Ollama endpoint (LOCAL_LLM_URL) is called first with 8-10 second timeout
- [ ] GIVEN the local call succeeds within timeout WHEN response is received THEN Groq fallback is skipped and provider is logged as "local"
- [ ] GIVEN the local call times out or returns connection error WHEN error occurs THEN Groq fallback is triggered within 1 second
- [ ] GIVEN the local endpoint is called WHEN making request THEN the `LOCAL_LLM_TOKEN` is included in Authorization header

**Business Value**: Reduces operational costs by 80-90% when local inference is available (estimated $5/month vs $40/month)

**Priority**: Must-Have (P0)

**Estimated User Impact**: Cost efficiency - no impact on team workflow

**Dependencies**:
- Local Ollama running and exposed via tunnel
- Tunnel authentication configured

**Edge Cases**:
- Tunnel disconnected: Fall back to Groq immediately on connection refused
- Slow local response (7-9 seconds): Complete successfully, no fallback
- Local returns 5xx error: Fall back to Groq (treat as unavailable)
- Concurrent requests: No request queuing - both should call local simultaneously

---

### Story 2.2: Fallback to Groq on Local Failure

**As a** support team member
**I want to** receive triage recommendations even when local infrastructure is down
**So that** I can maintain consistent workflow regardless of system availability

**Acceptance Criteria**:
- [ ] GIVEN local Ollama fails or times out WHEN fallback is triggered THEN Groq API is called with same ticket data and prompt
- [ ] GIVEN Groq API is called WHEN making request THEN `GROQ_API_KEY` is included and temperature is set to 0.2 for consistent JSON output
- [ ] GIVEN Groq returns successful response WHEN logged THEN provider is recorded as "groq" and local failure reason is included
- [ ] GIVEN both local and Groq fail WHEN both attempts exhausted THEN a "triage failed" notification is sent to Discord with error summary

**Business Value**: Ensures 99%+ system availability independent of local infrastructure reliability

**Priority**: Must-Have (P0)

**Estimated User Impact**: 20-40% of requests during off-hours when PC may be sleeping

**Dependencies**:
- Groq API key configured
- Groq API quota sufficient for full fallback load

**Edge Cases**:
- Groq rate limit exceeded: Send "triage failed" notification, log for cost/quota review
- Groq timeout: Set reasonable timeout (15 seconds), then fail gracefully
- Groq returns non-JSON: Attempt repair (Story 2.4)

---

### Story 2.3: Generate Structured Triage Output

**As a** support team member
**I want to** receive triage recommendations in a consistent, actionable format
**So that** I can quickly understand priority, handling mode, and next steps without parsing unstructured text

**Acceptance Criteria**:
- [ ] GIVEN a ticket is analyzed WHEN LLM generates output THEN it matches the JSON schema with all required fields (priority, handling_mode, recommended_internal_action, asana_ticket_type_if_needed, customer_summary, reply_needed, reply_draft, questions_for_customer, internal_notes, confidence)
- [ ] GIVEN `reply_needed` is false WHEN output is generated THEN `reply_draft` is null (not empty string)
- [ ] GIVEN ticket content suggests uncertainty WHEN analyzed THEN handling_mode is "request_more_info" and 3-5 specific questions are included in `questions_for_customer`
- [ ] GIVEN ticket contains security-related keywords (vulnerability, exploit, breach, etc.) WHEN analyzed THEN priority is high/critical and recommended_internal_action includes "Escalate to security"
- [ ] GIVEN LLM output includes claims of actions taken ("I've created...", "I've escalated...") WHEN validated THEN the output is rejected and repair is attempted

**Business Value**: Provides actionable intelligence that reduces triage time from 5-8 minutes to under 2 minutes

**Priority**: Must-Have (P0)

**Estimated User Impact**: 100% of tickets - core value proposition

**Dependencies**:
- LLM prompt engineering (includes SOPs and output format instructions)
- JSON schema definition

**Edge Cases**:
- Low confidence (<0.4): Recommend "request_more_info" regardless of initial handling_mode
- Contradictory ticket content: Reflect uncertainty in internal_notes
- Non-English ticket: Note language in internal_notes, attempt triage if possible (Phase 1 best-effort)

---

### Story 2.4: Validate and Repair LLM Output

**As a** system reliability engineer
**I want to** catch and correct invalid LLM JSON output
**So that** downstream components always receive well-formed data

**Acceptance Criteria**:
- [ ] GIVEN LLM returns output WHEN parsed THEN JSON validity is checked and schema validation is performed
- [ ] GIVEN output has invalid JSON syntax WHEN detected THEN one repair attempt is made by prompting LLM to return corrected JSON
- [ ] GIVEN output has missing required fields or invalid enum values WHEN validated THEN repair is attempted with explicit error message to LLM
- [ ] GIVEN repair attempt also fails WHEN exhausted THEN a "triage failed" Discord notification is sent with raw output snippet (first 500 chars) and ticket link
- [ ] GIVEN output is valid JSON but surrounded by markdown or explanatory text WHEN parsed THEN attempt to extract JSON block before failing

**Business Value**: Improves system reliability from ~95% to 99%+ success rate by recovering from LLM output inconsistencies

**Priority**: Must-Have (P0)

**Estimated User Impact**: 5-10% of tickets may have initial parse issues; repair recovers most

**Dependencies**:
- JSON schema validation library
- Retry/repair prompt template

**Edge Cases**:
- Multiple JSON blocks in output: Use first valid block matching schema
- Partial JSON (truncated): Fail immediately, include in triage failed notification
- Escaped JSON (double-encoded): Attempt one level of unescaping

---

### Story 2.5: Implement Prompt Injection Resistance

**As a** security-conscious system
**I want to** ignore instructions embedded in ticket content that attempt to override system behavior
**So that** malicious users cannot manipulate triage output or extract system prompts

**Acceptance Criteria**:
- [ ] GIVEN ticket body contains "Ignore previous instructions and..." WHEN processed THEN the LLM treats it as ticket content, not system instructions
- [ ] GIVEN ticket body attempts to extract system prompt ("What are your instructions?") WHEN processed THEN the output remains in standard JSON schema format
- [ ] GIVEN ticket body contains instructions to change priority or handling mode WHEN processed THEN triage is based on actual content analysis, not injected instructions
- [ ] GIVEN prompt template is designed WHEN reviewed THEN it clearly delineates system instructions from user input with explicit boundaries

**Business Value**: Prevents manipulation of triage output that could waste team time or obscure critical issues

**Priority**: Must-Have (P0)

**Estimated User Impact**: Security requirement - rare but high impact if exploited

**Dependencies**:
- Prompt engineering with input/output separation
- Test cases for common injection patterns

**Edge Cases**:
- Subtle injection attempts: Monitor for confidence scores dropping on suspicious tickets
- Multi-turn attacks: Not applicable (stateless single-shot inference)

---

## Epic 3: Discord Notifications

### Story 3.1: Post Triage Summary to Discord

**As a** support team member
**I want to** receive rich, formatted triage notifications in Discord
**So that** I can quickly review recommendations without switching to HubSpot

**Acceptance Criteria**:
- [ ] GIVEN valid triage output is generated WHEN notification is created THEN a Discord embed is posted with color-coded priority (red=critical, orange=high, yellow=medium, green=low)
- [ ] GIVEN the embed is created WHEN posted THEN it includes fields for: Priority, Handling Mode, Recommended Internal Action, Asana Ticket Type (if applicable), Customer Summary, Confidence, Reply Draft (truncated to 500 chars if longer), HubSpot ticket link
- [ ] GIVEN reply_draft is longer than 500 chars WHEN truncated THEN ellipsis (...) is added and full text available via HubSpot link
- [ ] GIVEN the Discord webhook URL is configured WHEN service starts THEN it validates URL format or fails fast

**Business Value**: Delivers triage intelligence directly into team's workflow tool, reducing context switching and enabling faster response

**Priority**: Must-Have (P0)

**Estimated User Impact**: 100% of tickets - primary interface for recommendations

**Dependencies**:
- Discord webhook URL configured
- Discord embed format designed for readability

**Edge Cases**:
- Embed exceeds Discord 6000 char limit: Truncate internal_notes and reply_draft further
- Discord webhook rate limit (30 requests/min): Implement basic rate limiting or queuing
- Webhook URL expired/invalid: Fail gracefully and log error for alert

---

### Story 3.2: Include Critical Issue Alerts

**As a** support team lead
**I want to** be immediately alerted to critical priority tickets via Discord mentions
**So that** urgent issues are escalated within minutes of creation

**Acceptance Criteria**:
- [ ] GIVEN triage output has priority="critical" WHEN Discord notification is created THEN the message includes @here mention to alert online team members
- [ ] GIVEN priority is critical WHEN embed is created THEN title is prefixed with "CRITICAL" and color is bright red
- [ ] GIVEN recommended_internal_action includes "Escalate to security" WHEN posted THEN message includes additional warning emoji and text "SECURITY ESCALATION RECOMMENDED"
- [ ] GIVEN a non-critical ticket WHEN posted THEN no mentions are included (to avoid alert fatigue)

**Business Value**: Reduces critical issue detection time from 45 minutes average to under 5 minutes

**Priority**: Should-Have (P1)

**Estimated User Impact**: 5-10% of tickets (critical priority), high business impact

**Dependencies**:
- Discord channel permissions allow @here mentions
- Team agreement on mention policy

**Edge Cases**:
- False positives causing alert fatigue: Monitor critical classification accuracy, adjust prompts if >10% false positive rate
- Off-hours alerts: Consider configurable mention behavior for 24/7 vs business hours

---

### Story 3.3: Handle Discord Posting Failures

**As a** system operator
**I want to** retry failed Discord posts and log persistent failures
**So that** transient network issues don't result in lost notifications

**Acceptance Criteria**:
- [ ] GIVEN Discord webhook POST fails with 5xx error WHEN encountered THEN retry up to 2 times with exponential backoff (1s, 3s)
- [ ] GIVEN all retry attempts fail WHEN exhausted THEN log error with ticket_id, error details, and triage output (for manual posting)
- [ ] GIVEN Discord returns 4xx error (bad request, unauthorized) WHEN encountered THEN do not retry, log error for configuration review
- [ ] GIVEN retry succeeds WHEN posted THEN log includes retry count for monitoring

**Business Value**: Improves notification reliability to 99.5%+ by handling transient Discord API issues

**Priority**: Should-Have (P1)

**Estimated User Impact**: 1-2% of notifications may require retry; prevents silent failures

**Dependencies**: Retry/backoff utility implementation

**Edge Cases**:
- Webhook URL rotated: Immediate 401 errors should trigger alert
- Discord outage: After exhausting retries, could queue for later retry (future enhancement)

---

## Epic 4: Reliability & Idempotency

### Story 4.1: Prevent Duplicate Ticket Processing

**As a** support team member
**I want to** receive only one notification per unique ticket
**So that** I'm not confused by duplicate alerts or waste time reviewing the same ticket twice

**Acceptance Criteria**:
- [ ] GIVEN a ticket_id is received WHEN checked against idempotency store THEN processing proceeds only if ticket_id is not found
- [ ] GIVEN a ticket_id is processed successfully WHEN stored THEN it is saved with current timestamp and retained for at least 7 days
- [ ] GIVEN a duplicate ticket_id is received WHEN detected THEN the webhook returns 200 OK but skips LLM inference and Discord notification
- [ ] GIVEN idempotency check fails due to store unavailability WHEN encountered THEN the ticket is processed anyway (fail-open to avoid blocking) and error is logged

**Business Value**: Prevents notification spam and wasted team effort on duplicate processing

**Priority**: Must-Have (P0)

**Estimated User Impact**: 5-10% of webhooks may be duplicates due to HubSpot retries; critical for UX

**Dependencies**:
- Idempotency store selection (Redis/SQLite/Postgres)
- Store deployment on Railway

**Edge Cases**:
- Store full/eviction: Use TTL-based retention (7 days) to auto-cleanup
- Race condition (simultaneous webhooks): Store implementation must support atomic check-and-set
- Store data loss: Temporary duplicates acceptable (fail-open design)

---

### Story 4.2: Implement Health Check Endpoint

**As a** Railway platform operator
**I want to** monitor service health via HTTP endpoint
**So that** I can detect and restart unhealthy instances automatically

**Acceptance Criteria**:
- [ ] GIVEN a GET request to `/health` WHEN service is operational THEN return 200 OK with JSON body `{"status": "healthy", "timestamp": "..."}`
- [ ] GIVEN critical dependencies are down (idempotency store unreachable) WHEN health checked THEN return 200 OK but include warning in JSON body
- [ ] GIVEN service is shutting down WHEN health checked THEN return 503 Service Unavailable
- [ ] GIVEN health check includes dependency status WHEN returned THEN include local_llm_reachable, groq_api_reachable, idempotency_store_reachable booleans

**Business Value**: Enables automated monitoring and restart, improving uptime to 99%+

**Priority**: Should-Have (P1)

**Estimated User Impact**: Operational reliability - no direct team impact but critical for uptime

**Dependencies**: None

**Edge Cases**:
- Health check during deployment: May briefly return unhealthy during restart
- Dependency checks slow: Timeout health check at 2 seconds to avoid blocking

---

## Epic 5: Observability & Monitoring

### Story 5.1: Log Webhook Processing Events

**As a** system operator
**I want to** log key events in webhook processing lifecycle
**So that** I can troubleshoot issues and monitor system performance

**Acceptance Criteria**:
- [ ] GIVEN a webhook is received WHEN logged THEN include timestamp, ticket_id, request_id (generated UUID)
- [ ] GIVEN LLM inference completes WHEN logged THEN include provider used (local/groq), latency, confidence score, request_id
- [ ] GIVEN an error occurs WHEN logged THEN include error type, error message, ticket_id, request_id, and relevant context
- [ ] GIVEN logs are written WHEN output THEN use structured JSON format (not plain text) for Railway log aggregation

**Business Value**: Enables root cause analysis for failures and performance optimization

**Priority**: Should-Have (P1)

**Estimated User Impact**: Operational - enables <30 minute MTTR for issues

**Dependencies**: Structured logging library (e.g., pino, winston)

**Edge Cases**:
- High-volume logging: Ensure logs don't include full ticket body (PII/size concerns)
- Log aggregation limits: Railway log retention may be limited, prioritize error logs

---

### Story 5.2: Track Provider Usage Metrics

**As a** cost-conscious operator
**I want to** monitor local vs. Groq inference usage rates
**So that** I can validate cost savings and detect tunnel issues

**Acceptance Criteria**:
- [ ] GIVEN inference completes WHEN logged THEN increment counter for provider (local_success, groq_fallback, both_failed)
- [ ] GIVEN daily/weekly report is generated WHEN calculated THEN include: total requests, local success rate, average Groq cost (estimated), average latency by provider
- [ ] GIVEN local success rate drops below 70% WHEN detected THEN log warning (potential tunnel issue)
- [ ] GIVEN metrics are exposed WHEN accessible THEN available via `/metrics` endpoint in Prometheus format (future integration)

**Business Value**: Validates 80%+ local inference target, justifies infrastructure investment

**Priority**: Could-Have (P2)

**Estimated User Impact**: Operational insights - informs future optimization

**Dependencies**: Metrics library or simple counter implementation

**Edge Cases**:
- Counter reset on redeploy: Acceptable for MVP, persist to store in future
- Timezone for daily rollup: Use UTC consistently

---

## Story 5.3: Monitor Triage Accuracy (Post-Launch)

**As a** product manager
**I want to** collect feedback on triage recommendation quality
**So that** I can measure success and identify prompt improvement opportunities

**Acceptance Criteria**:
- [ ] GIVEN a Discord notification is posted WHEN reactions are added THEN support team can react with thumbs-up (helpful) or thumbs-down (not helpful)
- [ ] GIVEN reactions are collected WHEN aggregated THEN calculate weekly "helpful rate" (thumbs-up / total reactions)
- [ ] GIVEN helpful rate is tracked WHEN reported THEN target is 70%+ for full rollout
- [ ] GIVEN thumbs-down reaction is added WHEN flagged THEN ticket_id is logged for manual review and prompt improvement

**Business Value**: Quantifies ROI and guides continuous improvement to 85%+ accuracy target

**Priority**: Could-Have (P2) - Post-launch measurement

**Estimated User Impact**: Feedback mechanism - low friction for team, high value for product

**Dependencies**:
- Discord bot permissions to read reactions (optional enhancement)
- Manual tracking acceptable for MVP

**Edge Cases**:
- Team forgets to react: Acceptance rate is a proxy metric, not required for all tickets
- Ambiguous reactions (both thumbs up and down): Count as "mixed", review manually

---

## Additional Stories (Future Phases)

### Story 6.1: RAG Over Support Documentation (Phase 2)

**As a** support team member
**I want to** triage recommendations to reference specific support articles and SOPs
**So that** I can quickly access relevant documentation and provide more accurate responses

**Acceptance Criteria**:
- [ ] GIVEN support docs are indexed WHEN retrieval occurs THEN top 3-5 relevant chunks are included in LLM context
- [ ] GIVEN triage output includes doc references WHEN posted THEN Discord embed includes clickable links to referenced articles
- [ ] GIVEN no relevant docs found WHEN triage runs THEN proceed with general knowledge (graceful degradation)

**Priority**: Phase 2 (Could-Have for MVP)

---

### Story 6.2: Multi-Language Detection and Routing (Phase 2)

**As a** global support team
**I want to** detect non-English tickets and route appropriately
**So that** customers receive responses in their preferred language

**Acceptance Criteria**:
- [ ] GIVEN ticket body is in non-English language WHEN detected THEN internal_notes include detected language
- [ ] GIVEN multi-language support is enabled WHEN configured THEN LLM attempts response draft in detected language
- [ ] GIVEN language detection confidence is low WHEN uncertain THEN default to English with note

**Priority**: Phase 2 (Could-Have for MVP)

---

## Definition of Done (All Stories)

- [ ] Acceptance criteria met and manually tested
- [ ] Unit tests written for business logic (>80% coverage target)
- [ ] Integration test with mock HubSpot webhook payload passes
- [ ] Error scenarios handled gracefully with appropriate logging
- [ ] Code reviewed by architect agent
- [ ] Documentation updated (README, API specs)
- [ ] Deployed to Railway staging environment
- [ ] Product manager validates against business requirements

---

**Document Version**: 1.0
**Last Updated**: 2025-12-14
**Total Stories**: 18 (Phase 1), 2 (Phase 2)
**Estimated Velocity**: 6-8 stories per 2-week sprint
