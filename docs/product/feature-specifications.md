# Feature Specifications: HubSpot Support Triage Automation

## Table of Contents
1. [Webhook Intake Feature](#1-webhook-intake-feature)
2. [Hybrid Inference Feature](#2-hybrid-inference-feature)
3. [LLM Output Validation Feature](#3-llm-output-validation-feature)
4. [Discord Notification Feature](#4-discord-notification-feature)
5. [Idempotency Feature](#5-idempotency-feature)

---

## 1. Webhook Intake Feature

### Overview
The Webhook Intake feature provides a secure, reliable HTTP endpoint that receives new support ticket notifications from HubSpot workflows and prepares them for downstream triage processing.

### Business Value
- Enables real-time ticket intake without manual polling
- Ensures system can scale to handle ticket volume spikes (50+ tickets/hour)
- Prevents processing delays that would impact time-to-first-response metrics

### Functional Requirements

#### FR-1.1: Endpoint Availability
- Railway service MUST expose `POST /webhook/hubspot` endpoint
- Endpoint MUST be publicly accessible via HTTPS
- Endpoint MUST respond to OPTIONS requests for CORS preflight (if HubSpot requires)

#### FR-1.2: Authentication
- Incoming requests MUST include `X-Webhook-Token` header
- Token value MUST match `HUBSPOT_WEBHOOK_TOKEN` environment variable
- Requests with missing or invalid token MUST return 401 Unauthorized
- Invalid authentication attempts MUST be logged with source IP

#### FR-1.3: Fast-Ack Pattern
- Endpoint MUST return 200 OK within 500ms of receiving valid request
- Response MUST be sent before LLM processing begins (async processing)
- Response body MUST include: `{"status": "accepted", "ticket_id": "..."}`
- Long-running operations (LLM inference, Discord posting) MUST occur after response sent

#### FR-1.4: Payload Validation
- Request Content-Type MUST be `application/json`
- Payload MUST contain required fields: `ticket_id`, `subject`, `body`
- Missing required fields MUST return 400 Bad Request with error details
- Malformed JSON MUST return 400 Bad Request
- Oversized payloads (>1MB) MUST return 413 Payload Too Large

#### FR-1.5: Payload Normalization
- Incoming HubSpot payload MUST be transformed into canonical internal format:

```json
{
  "ticket_id": "string (required)",
  "subject": "string (required)",
  "body": "string (required)",
  "from_email": "string|null",
  "customer_name": "string|null",
  "customer_tier": "string|null",
  "product_area": "string|null",
  "hubspot_ticket_url": "string|null",
  "received_at": "ISO-8601 timestamp (auto-generated if not provided)"
}
```

- Missing optional fields MUST be set to `null` (not omitted)
- Empty strings MUST be normalized to `null`
- Whitespace-only values MUST be trimmed and converted to `null`
- HTML in ticket body MUST be preserved (LLM can parse HTML)

### User Flows

#### Happy Path: Valid Webhook Request
1. HubSpot workflow triggers on new ticket creation
2. HubSpot sends POST to `https://[railway-url]/webhook/hubspot` with ticket data and auth token
3. Railway service validates auth token (pass)
4. Service validates payload structure (pass)
5. Service normalizes payload to internal format
6. Service returns 200 OK with `{"status": "accepted", "ticket_id": "12345"}` in <500ms
7. Service asynchronously processes ticket (idempotency check → LLM inference → Discord)

#### Error Path: Missing Authentication
1. HubSpot sends POST without `X-Webhook-Token` header
2. Service validates auth token (fail)
3. Service returns 401 Unauthorized with `{"error": "Missing or invalid webhook token"}`
4. Service logs authentication failure with timestamp and source IP
5. No processing occurs

#### Error Path: Invalid Payload
1. HubSpot sends POST with valid auth but missing `subject` field
2. Service validates auth token (pass)
3. Service validates payload structure (fail - missing required field)
4. Service returns 400 Bad Request with `{"error": "Missing required field: subject"}`
5. Service logs validation error with ticket_id (if present) and error details
6. No processing occurs

### Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Duplicate `ticket_id` received within 1 second (race condition) | Both requests return 200 OK, idempotency layer handles deduplication |
| HubSpot payload includes extra unknown fields | Accept and ignore unknown fields, log warning for schema monitoring |
| `received_at` timestamp is in the future | Accept but log warning (clock skew issue) |
| Ticket body contains special characters (emoji, unicode) | Preserve exactly as received, ensure UTF-8 encoding |
| Extremely long ticket body (50,000+ chars) | Accept if under 1MB limit, may truncate for Discord display later |
| Request from non-HubSpot IP address but valid token | Accept (IP whitelisting not implemented in Phase 1) |
| Service restarting during webhook delivery | HubSpot retries after timeout, fast-ack pattern minimizes window |

### Non-Functional Requirements

**Performance**:
- Response time: p95 under 500ms, p99 under 1000ms
- Throughput: Handle 100 concurrent requests (burst capacity)
- Payload size: Support up to 1MB requests

**Security**:
- HTTPS only (Railway enforces)
- Token-based authentication (header-based)
- Rate limiting: Not implemented in Phase 1 (Railway may provide platform-level protection)
- No customer PII logged (ticket_id and error details only)

**Reliability**:
- Gracefully handle malformed requests without crashing service
- Log all errors for debugging without exposing sensitive data
- Return appropriate HTTP status codes per RFC 7231

### Dependencies
- Railway HTTPS endpoint provisioning
- `HUBSPOT_WEBHOOK_TOKEN` environment variable configured
- JSON parsing library (e.g., Express.js body-parser)

### Open Questions
- What exact fields are available in HubSpot webhook payload? (requires payload sample from HubSpot admin)
- Does HubSpot require CORS headers for webhook delivery? (likely no, but verify)
- What is HubSpot's retry behavior on 5xx errors? (fast-ack pattern should minimize)

---

## 2. Hybrid Inference Feature

### Overview
The Hybrid Inference feature implements a cost-optimized LLM strategy that attempts local Ollama inference first and falls back to cloud-based Groq API when local is unavailable, ensuring high availability while minimizing operating costs.

### Business Value
- Reduces LLM costs by 80-90% vs. cloud-only approach (estimated $5/month vs. $40/month)
- Maintains 99%+ availability independent of local infrastructure uptime
- Enables experimentation with local models without vendor lock-in

### Functional Requirements

#### FR-2.1: Provider Strategy
- System MUST attempt local Ollama endpoint first for every triage request
- Local endpoint URL MUST be configured via `LOCAL_LLM_URL` environment variable
- Local request MUST include `LOCAL_LLM_TOKEN` in Authorization header (format: `Bearer <token>`)
- Local request MUST have timeout of 8-10 seconds
- On local failure (timeout, connection error, 5xx response), system MUST immediately call Groq API
- Provider used (local/groq) MUST be logged with each request

#### FR-2.2: Local Ollama Request Format
- HTTP Method: POST to `{LOCAL_LLM_URL}/api/generate` (Ollama API endpoint)
- Request body:
```json
{
  "model": "llama3.2:latest",
  "prompt": "[triage prompt with ticket data]",
  "stream": false,
  "format": "json",
  "options": {
    "temperature": 0.2,
    "num_predict": 1024
  }
}
```
- Headers: `Authorization: Bearer {LOCAL_LLM_TOKEN}`, `Content-Type: application/json`

#### FR-2.3: Groq Fallback Request Format
- HTTP Method: POST to `https://api.groq.com/openai/v1/chat/completions`
- Request body:
```json
{
  "model": "llama-3.1-70b-versatile",
  "messages": [
    {"role": "system", "content": "[system prompt]"},
    {"role": "user", "content": "[ticket data]"}
  ],
  "temperature": 0.2,
  "max_tokens": 1024,
  "response_format": {"type": "json_object"}
}
```
- Headers: `Authorization: Bearer {GROQ_API_KEY}`, `Content-Type: application/json`

#### FR-2.4: Prompt Engineering
- Prompt MUST include:
  - System instructions (triage task, output format, security rules)
  - Support SOPs (embedded in Phase 1, retrieved via RAG in Phase 2)
  - Ticket data (normalized payload)
  - Clear delineation between instructions and user input (anti-injection)
  - Output schema specification
  - Examples of valid output (few-shot learning)

- Prompt MUST enforce constraints:
  - Never claim actions were taken
  - Never promise timelines
  - Treat ticket body as untrusted input
  - Security tickets get minimal customer replies

#### FR-2.5: Response Handling
- Both providers MUST return JSON matching triage output schema (see FR-3.1)
- Response text MUST be extracted and passed to validation layer
- Provider latency MUST be logged (for performance monitoring)
- Provider errors (timeout, 5xx, invalid API key) MUST be logged with error type

### User Flows

#### Happy Path: Local Ollama Success
1. Normalized ticket payload received from webhook layer
2. System constructs triage prompt with ticket data
3. System sends POST to local Ollama endpoint with 10-second timeout
4. Ollama responds in 7 seconds with valid JSON
5. System logs: `provider=local, latency=7000ms, ticket_id=12345`
6. JSON response passed to validation layer
7. Groq is never called (cost = $0)

#### Fallback Path: Local Timeout → Groq Success
1. Normalized ticket payload received
2. System sends POST to local Ollama endpoint
3. After 10 seconds, no response received (timeout)
4. System logs: `local_attempt=timeout, ticket_id=12345`
5. System immediately sends POST to Groq API
6. Groq responds in 3 seconds with valid JSON
7. System logs: `provider=groq, latency=3000ms, fallback_reason=timeout, ticket_id=12345`
8. JSON response passed to validation layer

#### Error Path: Both Providers Fail
1. Local Ollama times out (10 seconds)
2. Groq API call fails with 503 Service Unavailable
3. System logs: `local_attempt=timeout, groq_attempt=503, ticket_id=12345`
4. System sends "triage failed" notification to Discord with error summary
5. Ticket link included in Discord message for manual triage
6. No further retries (fail-fast for this ticket)

### Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Local Ollama returns 5xx error | Treat as failure, immediately fall back to Groq |
| Local Ollama returns 401 Unauthorized | Log auth failure, fall back to Groq, alert for LOCAL_LLM_TOKEN issue |
| Groq API rate limit exceeded (429) | Log rate limit, send "triage failed" notification, monitor for quota issues |
| Groq API returns invalid API key (401) | Log auth failure, send "triage failed" notification, alert for GROQ_API_KEY issue |
| Local returns response in 9.8 seconds (just under timeout) | Accept as success, log latency warning if frequently near timeout |
| Prompt exceeds model context window | Truncate ticket body to fit, log truncation, include note in internal_notes |
| Both providers return non-JSON responses | Attempt repair (see Feature 3), if both repairs fail, send "triage failed" notification |
| Concurrent requests (10 tickets in 1 minute) | Both local and Groq should handle concurrency independently, no queuing |

### Non-Functional Requirements

**Performance**:
- Local inference target latency: 6-8 seconds average
- Groq inference target latency: 2-4 seconds average
- Total triage time (including fallback): Under 15 seconds p95

**Availability**:
- Local success rate target: 80%+ during business hours (9am-5pm when PC likely running)
- Groq fallback must handle 100% of load if local is down for extended period
- Combined system availability: 99%+ (dependent on Groq SLA)

**Cost**:
- Target: 80% local, 20% Groq → ~$8/month (based on 40 tickets/day * 30 days * 20% * $0.0008/request estimate)
- Maximum acceptable: 100% Groq → ~$40/month (validates fallback-only scenario)

**Security**:
- Tunnel authentication prevents unauthorized access to local Ollama
- Groq API key secured in Railway environment variables
- Ticket data sent to Groq is transient (not stored by Groq per their policy)

### Dependencies
- Local Ollama installation running `llama3.2:latest` model (or configured model)
- Secure tunnel (Cloudflare Tunnel / Tailscale Funnel / ngrok) exposing Ollama to Railway
- Groq API account with sufficient quota
- Prompt template with embedded SOPs

### Open Questions
- Which specific Ollama model performs best for triage? (requires testing llama3.2 vs. mistral vs. others)
- What is acceptable Groq monthly cost limit? (requires budget approval)
- Should local bridge service be implemented vs. direct Ollama access? (security/reliability trade-off)
- What is Groq's rate limit for our API tier? (validate with Groq documentation)

---

## 3. LLM Output Validation Feature

### Overview
The LLM Output Validation feature ensures that responses from both local and cloud LLM providers conform to the required JSON schema, handles parsing errors gracefully, and attempts automatic repair before failing.

### Business Value
- Improves system reliability from ~95% to 99%+ by recovering from LLM output inconsistencies
- Prevents downstream errors in Discord notification formatting
- Provides actionable error data for prompt improvement

### Functional Requirements

#### FR-3.1: Output Schema Definition
LLM output MUST conform to the following JSON schema:

```json
{
  "priority": "low|medium|high|critical",
  "handling_mode": "reply_only|reply_and_internal_followup|internal_followup_only|request_more_info|no_action",
  "recommended_internal_action": "Create bug report|Create feedback ticket|Escalate to engineering|Escalate to security|None",
  "asana_ticket_type_if_needed": "Bug|Feedback|Escalation|None",
  "customer_summary": "string (1-300 chars)",
  "reply_needed": true|false,
  "reply_draft": "string|null",
  "questions_for_customer": ["string", "string", ...],
  "internal_notes": ["string", "string", ...],
  "confidence": 0.0-1.0
}
```

**Field Constraints**:
- `priority`: MUST be exactly one of the four allowed values (case-sensitive)
- `handling_mode`: MUST be exactly one of the five allowed values
- `reply_needed`: If `false`, `reply_draft` MUST be `null`
- `reply_draft`: If `reply_needed` is `true`, SHOULD NOT be null (but may be empty string if intentional)
- `confidence`: MUST be numeric value between 0.0 and 1.0 inclusive
- `customer_summary`: MUST NOT exceed 300 characters
- `questions_for_customer`: Array may be empty but MUST be present
- `internal_notes`: Array may be empty but MUST be present

#### FR-3.2: Validation Process
1. Attempt to parse LLM response text as JSON
2. If JSON parse fails, attempt to extract JSON from surrounding text (e.g., markdown code blocks)
3. Validate all required fields are present
4. Validate enum values match allowed values exactly
5. Validate numeric ranges (confidence 0.0-1.0)
6. Validate conditional requirements (reply_needed vs reply_draft)
7. If validation passes, return validated output
8. If validation fails, proceed to repair attempt (FR-3.3)

#### FR-3.3: Automatic Repair
- On validation failure, construct repair prompt:
```
The previous output was invalid. Error: [specific validation error]

Please return ONLY valid JSON matching this schema:
[schema specification]

Original ticket data:
[ticket data]

Return corrected JSON with no surrounding text.
```

- Send repair prompt to the SAME provider that generated original output
- Use same timeout as original request
- Parse and validate repair attempt
- If repair succeeds, log successful repair and use output
- If repair fails, proceed to failure notification (FR-3.4)

#### FR-3.4: Failure Handling
- On exhausted repair attempts, construct "triage failed" notification:
  - Include ticket_id and HubSpot link
  - Include error type (JSON parse error, validation error, field constraint error)
  - Include raw LLM output snippet (first 500 chars, sanitized)
  - Include provider used (local/groq)
  - Mark as urgent for manual review

- Send failure notification to Discord
- Log full error details for debugging
- Do NOT retry the entire triage process (fail-fast)

### User Flows

#### Happy Path: Valid Output on First Attempt
1. LLM returns response text
2. Validation layer parses as JSON (success)
3. All required fields present and valid
4. Enum values match allowed values
5. Conditional requirements satisfied (reply_needed=false, reply_draft=null)
6. Validation passes
7. Output forwarded to Discord notification layer

#### Repair Path: Invalid JSON Syntax
1. LLM returns: `Here's the triage: {"priority": "high", ...}` (text + JSON)
2. JSON parse fails (unexpected token "Here")
3. System attempts to extract JSON block using regex pattern `\{.*\}` (greedy)
4. Extracted JSON parses successfully
5. Validation passes
6. Log: `json_extraction=true, ticket_id=12345`
7. Output forwarded to Discord notification layer

#### Repair Path: Missing Field
1. LLM returns valid JSON but missing `confidence` field
2. JSON parse succeeds
3. Field validation fails: `missing required field: confidence`
4. System constructs repair prompt with specific error
5. System re-calls LLM (same provider) with repair prompt
6. Repair response includes `confidence: 0.7`
7. Validation passes
8. Log: `repair_attempted=true, repair_succeeded=true, ticket_id=12345`
9. Output forwarded to Discord notification layer

#### Failure Path: Irreparable Output
1. LLM returns valid JSON but `priority: "urgent"` (invalid enum)
2. Validation fails: `invalid enum value for priority: urgent`
3. Repair prompt sent
4. Repair response returns `priority: "urgent"` again (model confused)
5. Validation fails again
6. System logs: `repair_attempted=true, repair_succeeded=false, error=invalid_enum, ticket_id=12345`
7. "Triage failed" notification sent to Discord with error details
8. Manual triage required

### Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Reply needed but draft is null | Log warning, allow (may be intentional for "request more info" mode) |
| Confidence score is 1.5 (out of range) | Fail validation, repair prompt specifies range 0.0-1.0 |
| Customer summary exceeds 300 chars | Truncate to 300 chars, log truncation |
| Empty arrays for questions/notes | Accept as valid (arrays present but empty) |
| Extra unknown fields in JSON | Ignore and accept (forward compatibility) |
| Multiple JSON objects in response | Use first valid object that passes schema validation |
| Nested JSON escaped as string | Attempt one level of JSON.parse on escaped strings |
| Unicode/emoji in text fields | Preserve exactly (UTF-8 encoding) |

### Non-Functional Requirements

**Reliability**:
- Validation success rate target: 99%+ after repair attempts
- Repair success rate target: 80%+ of initial failures (implies 4% overall repair needed)
- Zero false positives (valid output incorrectly rejected)

**Performance**:
- Validation processing time: Under 100ms
- Repair attempt adds 2-4 seconds (additional LLM call)
- Total validation + repair: Under 5 seconds p95

**Maintainability**:
- JSON schema defined in single central module
- Validation logic unit-testable with mock outputs
- Clear error messages for debugging prompt issues

### Dependencies
- JSON parsing library with error handling (JSON.parse with try-catch)
- JSON schema validation library (e.g., ajv, joi)
- Regex utilities for JSON extraction

### Open Questions
- Should repair prompt include examples of valid output? (may improve success rate)
- How many repair attempts are acceptable? (current: 1, could increase to 2)
- Should different validation strictness levels exist for different priorities? (e.g., be more lenient for low priority)

---

## 4. Discord Notification Feature

### Overview
The Discord Notification feature delivers formatted, actionable triage summaries to the support team via Discord webhooks, enabling rapid response without context switching to HubSpot.

### Business Value
- Integrates triage intelligence into team's existing workflow (Discord)
- Reduces context switching and tool fragmentation
- Enables real-time awareness of critical issues via @mentions
- Provides at-a-glance summary for quick decision-making

### Functional Requirements

#### FR-4.1: Discord Webhook Integration
- System MUST post to Discord webhook URL configured in `DISCORD_WEBHOOK_URL` environment variable
- Webhook URL MUST be validated at service startup (format check, not test post)
- POST request format MUST comply with Discord webhook API specification
- Content-Type header MUST be `application/json`

#### FR-4.2: Embed Structure
Discord message MUST use embed format with the following structure:

```json
{
  "embeds": [{
    "title": "[PRIORITY] Ticket #[ticket_id]: [subject]",
    "description": "[customer_summary]",
    "color": [priority color code],
    "fields": [
      {"name": "Handling Mode", "value": "[handling_mode]", "inline": true},
      {"name": "Confidence", "value": "[confidence * 100]%", "inline": true},
      {"name": "Internal Action", "value": "[recommended_internal_action]", "inline": false},
      {"name": "Asana Ticket Type", "value": "[asana_ticket_type_if_needed]", "inline": true},
      {"name": "Questions for Customer", "value": "[questions list or 'None']", "inline": false},
      {"name": "Reply Draft", "value": "[truncated reply or 'No reply needed']", "inline": false},
      {"name": "Internal Notes", "value": "[notes list or 'None']", "inline": false}
    ],
    "footer": {"text": "Triaged via [provider] | [timestamp]"},
    "url": "[hubspot_ticket_url]"
  }]
}
```

**Color Coding**:
- Critical: 0xFF0000 (bright red)
- High: 0xFF8800 (orange)
- Medium: 0xFFDD00 (yellow)
- Low: 0x00FF00 (green)

**Title Formatting**:
- Critical priority: Title prefixed with "CRITICAL"
- Security escalation: Title includes security emoji (e.g., shield icon)

#### FR-4.3: Content Formatting
- **Customer Summary**: Display in description field, maximum 300 chars (truncate if needed)
- **Reply Draft**:
  - If `reply_needed=false`: Display "No reply needed"
  - If draft exceeds 500 chars: Truncate with "... (see HubSpot for full draft)"
  - Preserve line breaks but remove excessive whitespace
- **Questions for Customer**:
  - If array empty: Display "None"
  - If array has items: Format as numbered list (1. Question 1\n2. Question 2)
- **Internal Notes**:
  - If array empty: Display "None"
  - If array has items: Format as bullet list (• Note 1\n• Note 2)

#### FR-4.4: Critical Issue Alerts
- If `priority="critical"` THEN:
  - Include `@here` mention in message content (outside embed)
  - Use bright red color
  - Prefix title with "CRITICAL"
- If `recommended_internal_action` includes "Escalate to security" THEN:
  - Include additional warning text: "SECURITY ESCALATION RECOMMENDED"
  - Consider separate @mention for security team (configurable)

#### FR-4.5: Retry Logic
- On Discord webhook POST failure:
  - If 5xx error: Retry up to 2 times with exponential backoff (1s, 3s)
  - If 4xx error (bad request, unauthorized): Do not retry, log error
  - If connection timeout: Retry once after 2 seconds
- On all retries exhausted:
  - Log error with ticket_id, triage output, and error details
  - Do NOT fail silently (log must be actionable for manual follow-up)

### User Flows

#### Happy Path: Standard Priority Ticket
1. Validated triage output received
2. System constructs Discord embed with all fields
3. Priority is "medium" (yellow color, no @mention)
4. Reply draft is 200 chars (no truncation needed)
5. System POSTs to Discord webhook
6. Discord responds with 204 No Content
7. Notification appears in support team's Discord channel
8. Team member clicks HubSpot link in embed
9. Team reviews recommendation and drafts response

#### Alert Path: Critical Security Issue
1. Triage output: `priority="critical", recommended_internal_action="Escalate to security"`
2. System constructs embed with red color, "CRITICAL" prefix
3. Message content includes: `@here SECURITY ESCALATION RECOMMENDED`
4. System POSTs to Discord webhook
5. Discord responds with 204 No Content
6. All online team members receive notification ping
7. Security team member reviews ticket within 5 minutes
8. Immediate internal escalation initiated

#### Error Path: Discord Webhook Failure with Retry
1. System POSTs to Discord webhook
2. Discord responds with 503 Service Unavailable
3. System logs: `discord_post=failed, status=503, retry=1, ticket_id=12345`
4. System waits 1 second
5. System retries POST
6. Discord responds with 204 No Content
7. System logs: `discord_post=success, retry=1, ticket_id=12345`
8. Notification delivered successfully

### Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Embed exceeds 6000 char limit | Truncate internal_notes first, then reply_draft, then customer_summary until under limit |
| Discord rate limit (30 msgs/min) | No queuing in Phase 1, log rate limit error, may lose notifications (monitor for volume issues) |
| Webhook URL expired/revoked | All posts return 401, log error, alert for DISCORD_WEBHOOK_URL update |
| HubSpot ticket URL is null | Use placeholder text: "HubSpot URL not available" |
| Special characters in subject (emoji, unicode) | Preserve in title (Discord supports UTF-8) |
| Empty customer_summary field | Use placeholder: "No summary available" |
| Extremely long ticket subject (>200 chars) | Truncate to 200 chars in title, full subject in HubSpot |
| Multiple critical tickets in 1 minute | Each gets @here mention (potential noise, monitor for alert fatigue) |

### Non-Functional Requirements

**Reliability**:
- Delivery success rate: 99.5%+ (after retries)
- Retry success rate: 90%+ of initial failures (implies ~1% permanent failures)

**Performance**:
- Embed construction time: Under 50ms
- Discord POST latency: 200-500ms (Discord API dependent)
- Total notification time (validation → Discord): Under 2 seconds p95

**Usability**:
- Embed is readable on mobile Discord app
- All critical information visible without clicking "Show More"
- HubSpot link is clickable and direct (no intermediate pages)

**Maintainability**:
- Embed template is centrally defined and version-controlled
- Field mapping is clear and documented
- Easy to add/remove fields in future iterations

### Dependencies
- Discord webhook URL configured and valid
- Discord channel permissions allow webhook posts and @mentions
- Support team actively monitors Discord channel during business hours

### Open Questions
- Should different channels be used for different priorities? (e.g., critical in separate channel)
- Should historical notifications be searchable/archived? (Discord native search vs. external logging)
- What is acceptable @mention frequency before it becomes noise? (monitor during beta)
- Should non-business-hour notifications behave differently (no @mentions)?

---

## 5. Idempotency Feature

### Overview
The Idempotency feature prevents duplicate processing of the same ticket by tracking processed ticket IDs in persistent storage, ensuring support team receives exactly one notification per unique ticket even if HubSpot sends duplicate webhooks.

### Business Value
- Prevents notification spam and team confusion
- Avoids wasted LLM API calls (cost savings)
- Ensures consistent user experience even during HubSpot webhook retries
- Enables safe webhook retry behavior without side effects

### Functional Requirements

#### FR-5.1: Idempotency Check
- Before processing any ticket, system MUST query idempotency store for `ticket_id`
- If `ticket_id` exists in store:
  - Log duplicate detection: `duplicate_ticket=true, ticket_id=12345, original_processed_at=[timestamp]`
  - Return 200 OK to HubSpot (acknowledge webhook)
  - Skip all downstream processing (LLM inference, Discord notification)
- If `ticket_id` does not exist:
  - Proceed with normal processing
  - After successful Discord notification, store `ticket_id` with current timestamp

#### FR-5.2: Storage Implementation
Choose one persistent storage backend (decision to be made during architecture phase):

**Option A: Redis**
- Key format: `triage:processed:{ticket_id}`
- Value: `{"processed_at": "ISO-8601 timestamp", "provider": "local|groq"}`
- TTL: 7 days (604800 seconds)
- Atomic operation: `SET NX` (set if not exists)

**Option B: PostgreSQL**
- Table: `processed_tickets` with columns: `ticket_id` (PK), `processed_at`, `provider`
- Index on `ticket_id` for fast lookup
- Cleanup job: Daily cron to delete records older than 7 days

**Option C: SQLite**
- Local file-based database on Railway persistent volume
- Same schema as PostgreSQL option
- Suitable for low-volume (<100 tickets/day)

**Selection Criteria**:
- Redis: Best performance, but adds service dependency and cost
- PostgreSQL: Railway-native, good performance, persistent, suitable for future analytics
- SQLite: Simplest, no external dependency, sufficient for MVP volume

#### FR-5.3: Storage Operations
**Store Operation** (after successful notification):
```
store(ticket_id, metadata):
  INSERT INTO processed_tickets (ticket_id, processed_at, provider)
  VALUES (ticket_id, NOW(), metadata.provider)
  ON CONFLICT DO NOTHING
```

**Check Operation** (before processing):
```
exists(ticket_id):
  SELECT COUNT(*) FROM processed_tickets WHERE ticket_id = ticket_id
  RETURN count > 0
```

**Cleanup Operation** (daily cron or on-demand):
```
cleanup():
  DELETE FROM processed_tickets WHERE processed_at < NOW() - INTERVAL '7 days'
```

#### FR-5.4: Failure Handling
- If idempotency store is unreachable during check:
  - Log error: `idempotency_check=failed, error=[details]`
  - Proceed with processing (fail-open behavior to avoid blocking legitimate tickets)
  - Log warning: `processing_without_idempotency=true, ticket_id=12345`
  - This may result in duplicate notifications, but prevents loss of new tickets

- If idempotency store fails during store operation:
  - Log error but do not retry (notification already sent)
  - Accept risk of duplicate on future retry (rare edge case)

#### FR-5.5: Race Condition Handling
- Use atomic operations (PostgreSQL `INSERT ON CONFLICT`, Redis `SET NX`) to handle concurrent requests
- If two webhooks arrive simultaneously for same `ticket_id`:
  - First request succeeds check (not found), proceeds to processing
  - Second request may also succeed check if first hasn't stored yet
  - Atomic store operation ensures only one actually stores
  - Worst case: Both process and send notification (rare, acceptable for MVP)

### User Flows

#### Happy Path: New Unique Ticket
1. Webhook received with `ticket_id=12345`
2. System queries idempotency store for `12345`
3. Result: Not found
4. System proceeds with LLM inference and Discord notification
5. After successful Discord POST, system stores `ticket_id=12345, processed_at=[now], provider=local`
6. Store operation succeeds
7. Processing complete

#### Duplicate Path: HubSpot Retry
1. Webhook received with `ticket_id=12345` (already processed 5 minutes ago)
2. System queries idempotency store for `12345`
3. Result: Found, `processed_at=5 minutes ago`
4. System logs: `duplicate_ticket=true, ticket_id=12345`
5. System returns 200 OK to HubSpot
6. No LLM call, no Discord notification
7. Processing complete (skipped)

#### Error Path: Store Unavailable During Check
1. Webhook received with `ticket_id=12345`
2. System queries idempotency store
3. Database connection timeout
4. System logs: `idempotency_check=failed, proceeding_anyway=true`
5. System proceeds with processing (fail-open)
6. LLM inference and Discord notification succeed
7. System attempts to store `ticket_id=12345`
8. Store operation fails (still unavailable)
9. System logs error but completes processing
10. Risk: If HubSpot retries and store is still down, duplicate notification may occur

### Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Same ticket_id received 100ms apart | Atomic store prevents duplicate, one notification sent |
| Store contains stale data (>7 days) | Cleanup job removes old records, ticket processed normally if re-received |
| Store full (disk space or record limit) | Log error, fail-open (process ticket), alert for capacity expansion |
| ticket_id is null or empty | Validation layer should catch before idempotency check, return 400 |
| Extremely high volume (1000 tickets/min) | Store performance may degrade, consider Redis for scale (future) |
| Manual re-processing request | Provide admin endpoint to clear specific ticket_id from store (future) |

### Non-Functional Requirements

**Performance**:
- Check operation latency: Under 50ms (p95)
- Store operation latency: Under 100ms (p95)
- No impact on webhook response time (async storage)

**Reliability**:
- Duplicate detection rate: 99%+ (allows rare race condition duplicates)
- Fail-open behavior prevents new ticket loss
- 7-day retention window covers typical HubSpot retry window (usually <1 hour)

**Data Persistence**:
- Store survives Railway service restarts (persistent volume or external database)
- No data loss on planned/unplanned restarts

**Scalability**:
- Support 50 tickets/day initially (MVP)
- Scale to 200+ tickets/day with same performance (future)
- 7-day retention = ~1400 records in store (minimal storage)

### Dependencies
- Database backend decision (Redis/PostgreSQL/SQLite)
- Railway persistent volume (if SQLite) or database service (if PostgreSQL/Redis)
- Database connection library and ORM (if applicable)

### Open Questions
- Which storage backend best balances simplicity, cost, and performance for MVP? (recommendation: PostgreSQL on Railway)
- Should retention period be configurable via environment variable? (future enhancement)
- Should store include additional metadata (e.g., triage output for analytics)? (Phase 2)
- Is 7-day retention sufficient or should it be 30 days? (validate against HubSpot retry behavior)

---

## Cross-Feature Integration Points

### Webhook → Idempotency → Inference → Validation → Discord Flow
1. Webhook receives request, authenticates, normalizes payload
2. Idempotency checks for duplicate (queries store)
3. If unique, inference attempts local then Groq
4. Validation ensures output schema compliance, repairs if needed
5. Discord constructs embed and posts notification
6. On success, idempotency stores ticket_id

### Error Propagation
- Webhook errors (401, 400): Stop immediately, no downstream processing
- Idempotency check failure: Log warning, proceed (fail-open)
- Inference failure (both providers): Send "triage failed" Discord notification, stop
- Validation failure (irreparable): Send "triage failed" Discord notification, stop
- Discord failure (all retries exhausted): Log error for manual notification, processing complete

### Observability Integration
All features must log to structured logging system with:
- `request_id`: UUID generated at webhook intake
- `ticket_id`: From HubSpot payload
- `timestamp`: ISO-8601 format
- `component`: Feature name (webhook, inference, validation, discord, idempotency)
- `event`: Event type (received, processed, failed, etc.)
- `metadata`: Feature-specific details

---

**Document Version**: 1.0
**Last Updated**: 2025-12-14
**Next Steps**: Architect review and technical design document creation
