# Success Metrics: HubSpot Support Triage Automation

## North Star Metric

**Average Time from Ticket Creation to First Meaningful Response**

**Rationale**: This metric directly reflects the customer experience and is influenced by all system capabilities (fast triage, quality recommendations, efficient team workflow). It balances speed with quality (meaningful response, not just any response).

**Current Baseline**: 2.5 hours (average during business hours)
**Target**: 1.0 hour (60% reduction)
**Measurement**: HubSpot timestamp (ticket created) to HubSpot timestamp (first response sent)

---

## Primary Metrics

### 1. Triage Decision Time (Team Efficiency)

**Definition**: Time from Discord notification received to support team member completing their triage decision (accepts recommendation, modifies, or overrides)

**Current Baseline**: 5-8 minutes per ticket (manual triage without automation)
**Target**: Under 2 minutes per ticket (75% reduction)

**Measurement Methodology**:
- Proxy: Manual time tracking for 20 random tickets per week during beta
- Future: Discord reaction timestamp (thumbs up = accepted recommendation quickly)

**Success Criteria**:
- 70% of tickets triaged in under 2 minutes
- 90% of tickets triaged in under 4 minutes
- Zero tickets delayed due to system failures

**Reporting Cadence**: Weekly during beta, monthly post-launch

---

### 2. Recommendation Acceptance Rate (Quality)

**Definition**: Percentage of tickets where support team uses the system's recommendation as-is or with minor modifications

**Current Baseline**: N/A (new capability)
**Target**: 70%+ acceptance rate

**Measurement Methodology**:
- Discord reactions: Thumbs-up on notification = "recommendation was helpful"
- Weekly survey: "How many tickets this week did you use the draft reply or follow the handling mode recommendation?"
- Acceptance = Team member used draft as starting point OR followed handling mode recommendation

**Success Criteria**:
- 70%+ acceptance rate by end of beta (Week 4)
- 80%+ acceptance rate by Week 8 post-full-launch
- Less than 10% "thumbs down" reactions (not helpful)

**Reporting Cadence**: Weekly

**Breakdown Dimensions**:
- By priority level (expect higher acceptance for low/medium, lower for critical)
- By handling mode (expect high acceptance for reply_only, lower for complex modes)
- By ticket type (how-to questions vs. bug reports vs. escalations)

---

### 3. Critical Issue Detection Time (Risk Mitigation)

**Definition**: Time from ticket creation to support team identifying it as critical/high priority requiring immediate action

**Current Baseline**: 45 minutes average (some discovered in 10 min, others in 2+ hours)
**Target**: 95% of critical tickets flagged within 5 minutes

**Measurement Methodology**:
- For tickets ultimately marked critical by humans: timestamp of ticket creation to timestamp of Discord notification with critical flag
- Assumes Discord monitoring during business hours (8am-6pm)

**Success Criteria**:
- 95% of truly critical tickets flagged by system within 5 minutes (system latency + Discord notification)
- False critical rate under 5% (tickets flagged critical but downgraded by humans)
- Zero missed critical security issues (validated weekly)

**Reporting Cadence**: Weekly

---

### 4. System Reliability (Uptime & Success Rate)

**Definition**: Percentage of webhook requests successfully processed end-to-end (webhook received → triage completed → Discord notification sent)

**Current Baseline**: N/A (new system)
**Target**: 99%+ successful processing

**Measurement Methodology**:
- Automated: Log-based calculation of (successful_notifications / total_webhooks_received) * 100
- Successful = Discord notification posted with valid triage JSON
- Failed = LLM timeout, validation failure, Discord posting failure

**Success Criteria**:
- 99%+ success rate during beta
- 99.5%+ success rate post-launch
- Average webhook-to-Discord latency under 15 seconds (p95)
- Zero data loss (failed tickets logged for manual processing)

**Reporting Cadence**: Daily monitoring, weekly reporting

**Breakdown Dimensions**:
- By failure type (LLM timeout, validation error, Discord failure)
- By provider (local Ollama vs. Groq)
- By time of day (detect off-hours issues)

---

## Secondary Metrics

### 5. Cost Efficiency (Local vs. Groq Usage)

**Definition**: Percentage of successful inferences using local Ollama vs. paid Groq API

**Current Baseline**: N/A
**Target**: 80%+ local inference success rate

**Measurement Methodology**:
- Log-based tracking: (local_successes / total_inferences) * 100
- Estimated monthly Groq cost = Groq_calls * $0.0008/request (estimate based on token usage)

**Success Criteria**:
- 80%+ local success rate during typical work hours (9am-5pm when PC likely running)
- Monthly Groq cost under $40 (validates fallback-only usage)
- Local latency averaging 6-8 seconds

**Reporting Cadence**: Weekly

**Business Value**: At 80% local usage, estimated $5-10/month vs. $40/month all-Groq

---

### 6. Draft Reply Utilization Rate

**Definition**: Percentage of tickets where support team uses the LLM-generated draft reply (even if modified)

**Current Baseline**: 0% (no drafts available)
**Target**: 60%+ of tickets with reply_needed=true

**Measurement Methodology**:
- Weekly survey: "For how many tickets did you use the draft reply this week (even if you edited it)?"
- Qualitative feedback on draft quality

**Success Criteria**:
- 60%+ draft utilization by Week 6
- Average edit distance: Drafts require minor edits (under 30% of text changed)
- 80%+ of drafts are "helpful starting points" (qualitative)

**Reporting Cadence**: Weekly during beta, monthly post-launch

---

### 7. Escalation Accuracy

**Definition**: Percentage of tickets where system's recommended_internal_action aligns with support team's final decision

**Current Baseline**: N/A
**Target**: 75%+ accuracy on escalation recommendations

**Measurement Methodology**:
- Manual review: For 20 random tickets per week, compare system's recommended_internal_action to actual action taken (bug report created, escalated to engineering, etc.)
- Agreement = Recommendation matches action OR no action recommended and none taken

**Success Criteria**:
- 75%+ accuracy on escalation recommendations
- Zero missed security escalations (100% sensitivity for security issues)
- Under 15% false escalations (specificity - avoid alert fatigue)

**Reporting Cadence**: Weekly during beta

---

### 8. False Critical Rate (Quality Control)

**Definition**: Percentage of tickets flagged as critical priority by system but downgraded by support team

**Current Baseline**: N/A
**Target**: Under 5% false critical rate

**Measurement Methodology**:
- Manual tracking: Number of critical flags / Number later confirmed as truly critical
- Inverse: (Critical flags - True positives) / Critical flags

**Success Criteria**:
- Under 5% false critical rate (maintains alert urgency)
- 100% sensitivity for true critical issues (no false negatives)

**Reporting Cadence**: Weekly

**Mitigation**: If false critical rate exceeds 10%, adjust LLM prompt to increase critical threshold

---

## Tertiary Metrics (Monitoring Only)

### 9. Ticket Volume Handled

**Definition**: Total number of tickets processed by system

**Target**: 30-50 tickets/day initially, scaling to 100+ tickets/day as volume grows

**Measurement Methodology**: Count of successful webhook processings

**Reporting Cadence**: Weekly

---

### 10. LLM Confidence Score Distribution

**Definition**: Distribution of confidence scores (0.0-1.0) in triage outputs

**Target**: Average confidence >0.6, with fewer than 20% below 0.5

**Measurement Methodology**: Log all confidence scores, calculate weekly average and distribution

**Success Criteria**:
- Average confidence score >0.6
- Low confidence (<0.5) correlates with "request_more_info" handling mode

**Reporting Cadence**: Weekly

**Use**: Low confidence tickets may require prompt improvements or indicate edge cases

---

### 11. Discord Notification Latency

**Definition**: Time from webhook received to Discord notification posted

**Target**: p50 <10 seconds, p95 <15 seconds

**Measurement Methodology**: Timestamp difference in logs

**Reporting Cadence**: Daily

---

## Measurement Infrastructure

### Data Collection

**Automated Logging**:
- Timestamp: webhook_received, llm_start, llm_complete, discord_posted
- Provider: local/groq
- Latency: llm_latency_ms, total_latency_ms
- Quality: confidence_score, priority, handling_mode
- Errors: error_type, error_message

**Manual Tracking** (Beta Period):
- Weekly survey to support team (5 questions, <2 min to complete)
- Spot-check review: 20 random tickets per week for accuracy validation
- Discord reaction tracking (if bot enabled)

### Reporting Dashboard (Future)

**Week 1-4 (Beta)**: Manual Google Sheets with weekly updates
**Week 5+**: Automated dashboard pulling from Railway logs
- Real-time: System uptime, provider usage, error rates
- Daily rollup: Volume, latency percentiles, confidence distribution
- Weekly rollup: Acceptance rate, escalation accuracy, cost

### Alerting Thresholds

**Immediate Alerts** (sent to engineering via Discord):
- Success rate drops below 95% in any 1-hour window
- Local inference success rate drops below 50% (tunnel likely down)
- False critical rate exceeds 15% in any week
- Any security escalation recommendation missed by team (weekly manual check)

**Weekly Review Triggers**:
- Acceptance rate below 60%
- Average confidence score below 0.55
- Groq cost exceeds $50/month

---

## Success Criteria for Launch Phases

### Shadow Mode Success (Week 3)
- [ ] System uptime >99% for 7 consecutive days
- [ ] Zero failed notifications to test Discord channel
- [ ] Manual review of 50 tickets: 70%+ of recommendations rated "helpful" by team lead
- [ ] Local inference success rate >75%

### Beta Launch Success (Week 4)
- [ ] Team acceptance rate >60%
- [ ] Average triage decision time <3 minutes
- [ ] Zero incidents of inappropriate automated actions (by design)
- [ ] Team satisfaction survey: 7/10 average "helpful for my workflow"

### Full Rollout Success (Week 6)
- [ ] North Star Metric: Time-to-first-response reduced to under 1.5 hours (interim target)
- [ ] Recommendation acceptance rate >70%
- [ ] Critical issue detection time <10 minutes for 90% of cases
- [ ] System reliability >99% for 2 consecutive weeks
- [ ] ROI validated: Team reports time savings equivalent to 10-15 hours/week (cost of automation justified)

---

## Long-Term Success (3 Months Post-Launch)

**Primary Outcome**: Time-to-first-response <1 hour consistently
**Quality Outcome**: Acceptance rate stabilizes at 80%+
**Efficiency Outcome**: Support team capacity increased by 25% (same team handles more tickets or focuses on complex issues)
**Cost Outcome**: Local inference remains at 80%+, total monthly cost <$50

**Strategic Outcome**: Justifies Phase 2 investment in RAG and multi-language support

---

## Baseline Measurement Plan (Pre-Launch)

To establish accurate baselines, collect the following data for 2 weeks before shadow mode:

1. **Manual Triage Time**: Support team tracks time spent on initial triage for 20 tickets (stopwatch method)
2. **Current Response Times**: Pull HubSpot data for ticket_created → first_response timestamps (last 30 days)
3. **Critical Issue Detection**: Review last 10 critical tickets, document when they were first flagged as critical
4. **Current Volume**: Average tickets/day, peak tickets/hour

**Baseline Report**: Document baseline data in spreadsheet before Week 1 of shadow mode

---

## Reporting Template (Weekly During Beta)

```
# Week [N] Triage Automation Report

## Summary
- Tickets Processed: [count]
- System Uptime: [%]
- Acceptance Rate: [%] (thumbs up/survey)
- Average Confidence: [0.0-1.0]

## Primary Metrics
- Triage Decision Time: [avg] minutes ([% under 2 min])
- Critical Detection Time: [avg] minutes ([% under 5 min])
- Success Rate: [%]

## Secondary Metrics
- Local Inference: [%]
- Draft Utilization: [%] (survey)
- False Critical Rate: [%]

## Issues & Improvements
- Top 3 failure types: [list]
- Prompt improvements: [actions taken]
- Team feedback summary: [themes]

## Next Week Focus
- [Action item 1]
- [Action item 2]
```

---

**Document Version**: 1.0
**Last Updated**: 2025-12-14
**Metrics Owner**: Product Manager
**Review Cadence**: Weekly during beta, monthly post-launch
