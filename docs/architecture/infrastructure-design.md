# Infrastructure Design: HubSpot Support Triage Automation

**Version**: 1.0
**Last Updated**: 2025-12-14
**Status**: Approved for Implementation

This document specifies the infrastructure configuration, deployment architecture, and operational requirements for the HubSpot Support Triage Automation system.

---

## Table of Contents

1. [Infrastructure Overview](#1-infrastructure-overview)
2. [Railway Configuration](#2-railway-configuration)
3. [PostgreSQL Database](#3-postgresql-database)
4. [Local Ollama Setup](#4-local-ollama-setup)
5. [Cloudflare Tunnel](#5-cloudflare-tunnel)
6. [Environment Variables](#6-environment-variables)
7. [Health Checks](#7-health-checks)
8. [Monitoring & Alerting](#8-monitoring--alerting)
9. [Deployment Process](#9-deployment-process)
10. [Disaster Recovery](#10-disaster-recovery)

---

## 1. Infrastructure Overview

### Component Topology

```
+-------------------------------------------------------------------+
|                        RAILWAY PLATFORM                            |
|  +-------------------------------+  +---------------------------+  |
|  |      Orchestrator Service     |  |     PostgreSQL Database   |  |
|  |  +-------------------------+  |  |  +---------------------+  |  |
|  |  | Node.js 20 + Fastify    |  |  |  | Railway Postgres    |  |  |
|  |  | 512MB RAM (auto-scale)  |--|->|  | 1GB storage         |  |  |
|  |  | Single instance (MVP)   |  |  |  | Auto-backup daily   |  |  |
|  |  +-------------------------+  |  |  +---------------------+  |  |
|  +-------------------------------+  +---------------------------+  |
+-------------------------------------------------------------------+
            |                                       |
            | HTTPS                                 |
            v                                       |
+-------------------+                               |
| Cloudflare Edge   |                               |
| (Access + Tunnel) |                               |
+-------------------+                               |
            |                                       |
            | Encrypted Tunnel                      |
            v                                       |
+-------------------+                               |
| LOCAL MACHINE     |                               |
| +---------------+ |                               |
| | Ollama        | |                               |
| | llama3.2:8b   | |                               |
| | 8GB+ RAM      | |                               |
| +---------------+ |                               |
| +---------------+ |                               |
| | cloudflared   | |                               |
| | Tunnel Daemon | |                               |
| +---------------+ |                               |
+-------------------+                               |
                                                    |
+-------------------+                               |
| EXTERNAL SERVICES |                               |
| +---------------+ |                               |
| | HubSpot       |----> Webhook ------------------>+
| +---------------+ |
| +---------------+ |
| | Discord       |<---- Notification
| +---------------+ |
| +---------------+ |
| | Groq API      |<---- Fallback LLM
| +---------------+ |
+-------------------+
```

### Resource Requirements

| Component | CPU | Memory | Storage | Network |
|-----------|-----|--------|---------|---------|
| Railway Service | 0.5 vCPU | 512MB-1GB | Ephemeral | 10GB/mo |
| Railway PostgreSQL | Shared | 256MB | 1GB | Internal |
| Local Ollama | 4+ cores | 8-16GB | 10GB (models) | 5GB/mo |
| Cloudflare Tunnel | Minimal | 128MB | None | 5GB/mo |

---

## 2. Railway Configuration

### Project Structure

```
Railway Project: hubspot-triage-automation
├── Service: orchestrator (from GitHub repo)
│   ├── Build: Nixpacks (Node.js detected)
│   ├── Deploy: On push to main
│   └── Domain: [auto-generated].railway.app
└── Database: PostgreSQL
    ├── Version: 15
    ├── Region: US West
    └── Backup: Daily automatic
```

### Service Configuration

**railway.toml** (root of repository):
```toml
[build]
builder = "nixpacks"
buildCommand = "npm ci && npm run build"

[deploy]
startCommand = "npm run start"
healthcheckPath = "/health"
healthcheckTimeout = 10
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3

[service]
internalPort = 3000
```

### Nixpacks Configuration

**nixpacks.toml** (optional, for customization):
```toml
[phases.setup]
nixPkgs = ["nodejs_20"]

[phases.install]
cmds = ["npm ci --production=false"]

[phases.build]
cmds = ["npm run build"]

[start]
cmd = "npm run start"
```

### Build Settings

| Setting | Value | Notes |
|---------|-------|-------|
| Root Directory | `/` | Default |
| Build Command | `npm ci && npm run build` | Install + TypeScript compile |
| Start Command | `npm run start` | Production start |
| Watch Paths | `src/**` | Trigger rebuild |
| Node Version | 20 | LTS |

### Network Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| Internal Port | 3000 | App listens on this |
| Public Domain | Auto-generated | `*.railway.app` |
| Custom Domain | Optional | Configure in dashboard |
| HTTPS | Automatic | Railway provisions cert |

---

## 3. PostgreSQL Database

### Database Provisioning

1. In Railway project dashboard, click "New" > "Database" > "PostgreSQL"
2. Railway provisions PostgreSQL 15 instance
3. Connection string auto-populated in `DATABASE_URL` env var

### Schema Migration

**Initial Migration** (`prisma/migrations/001_init/migration.sql`):
```sql
-- CreateTable
CREATE TABLE "processed_tickets" (
    "ticket_id" VARCHAR(255) NOT NULL,
    "processed_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_tickets_pkey" PRIMARY KEY ("ticket_id")
);

-- CreateIndex
CREATE INDEX "idx_processed_at" ON "processed_tickets"("processed_at");
```

### Prisma Schema

**schema.prisma**:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model ProcessedTicket {
  ticketId    String   @id @map("ticket_id") @db.VarChar(255)
  processedAt DateTime @default(now()) @map("processed_at") @db.Timestamptz
  provider    String   @map("provider") @db.VarChar(50)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([processedAt])
  @@map("processed_tickets")
}
```

### Maintenance Tasks

**Cleanup Job** (run daily via external cron or Railway cron):
```sql
-- Delete records older than 7 days
DELETE FROM processed_tickets
WHERE processed_at < NOW() - INTERVAL '7 days';
```

**Options for Scheduling**:
1. **Railway Cron** (if available in plan): Add separate cron service
2. **External Cron**: Use cron-job.org or similar free service
3. **In-app**: Run cleanup on service startup (simple for MVP)

### Database Sizing

| Metric | Estimate | Notes |
|--------|----------|-------|
| Records/day | 50 | Average ticket volume |
| Retention | 7 days | Cleanup policy |
| Max records | ~350 | 50 * 7 days |
| Row size | ~100 bytes | ticket_id + timestamps + provider |
| Total size | ~35 KB | Well under 1GB limit |

---

## 4. Local Ollama Setup

### System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| OS | macOS 12+, Linux, WSL2 | macOS 14+ (Apple Silicon) |
| RAM | 8 GB | 16 GB |
| CPU | 4 cores | 8+ cores (Apple M1/M2) |
| Storage | 10 GB | 20 GB |
| Network | Stable broadband | 50+ Mbps |

### Installation

**macOS (Homebrew)**:
```bash
# Install Ollama
brew install ollama

# Start Ollama service
ollama serve &

# Pull required model
ollama pull llama3.2:latest
```

**Linux**:
```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Start Ollama service
systemctl start ollama

# Pull required model
ollama pull llama3.2:latest
```

### Ollama Configuration

**Default Settings** (suitable for most cases):
- Host: `127.0.0.1:11434`
- Models stored in: `~/.ollama/models`
- Context window: 8192 tokens (model default)

**Custom Configuration** (optional, `~/.ollama/config`):
```yaml
# Increase context for longer tickets
OLLAMA_NUM_CTX: 8192

# Bind to localhost only (security)
OLLAMA_HOST: 127.0.0.1:11434

# GPU layers (if CUDA available)
OLLAMA_NUM_GPU: 999
```

### Model Selection

**Primary Model**: `llama3.2:latest` (8B parameters)
- Good balance of quality and speed
- ~6-8 second inference for typical prompts
- Runs on 8GB RAM machines

**Alternative Models** (if needed):
- `llama3.2:3b` - Faster, lower quality
- `mistral:latest` - Different reasoning style
- `llama3.1:8b` - Previous generation, similar performance

### Keeping Ollama Running

**macOS (launchd)**:
```xml
<!-- ~/Library/LaunchAgents/com.ollama.serve.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ollama.serve</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/ollama</string>
        <string>serve</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Load with: `launchctl load ~/Library/LaunchAgents/com.ollama.serve.plist`

**Linux (systemd)**:
```ini
# /etc/systemd/system/ollama.service
[Unit]
Description=Ollama Service
After=network.target

[Service]
Type=simple
User=your-user
ExecStart=/usr/local/bin/ollama serve
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable with: `sudo systemctl enable ollama`

---

## 5. Cloudflare Tunnel

### Prerequisites

1. Cloudflare account (free tier sufficient)
2. Domain added to Cloudflare (can use any domain you control)
3. `cloudflared` CLI installed locally

### Installation

**macOS**:
```bash
brew install cloudflare/cloudflare/cloudflared
```

**Linux**:
```bash
# Debian/Ubuntu
curl -L --output cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

### Tunnel Setup

```bash
# 1. Authenticate with Cloudflare
cloudflared tunnel login
# Opens browser for authentication

# 2. Create tunnel
cloudflared tunnel create ollama-tunnel
# Outputs: Created tunnel ollama-tunnel with id <TUNNEL_UUID>

# 3. Create configuration file
mkdir -p ~/.cloudflared
```

### Configuration

**~/.cloudflared/config.yml**:
```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /Users/youruser/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: ollama.yourdomain.com
    service: http://localhost:11434
    originRequest:
      httpHostHeader: localhost
      connectTimeout: 30s
      noTLSVerify: false
  - service: http_status:404
```

### DNS Configuration

```bash
# Create DNS record pointing to tunnel
cloudflared tunnel route dns ollama-tunnel ollama.yourdomain.com
# Creates CNAME: ollama.yourdomain.com -> <TUNNEL_UUID>.cfargotunnel.com
```

### Cloudflare Access Setup

1. Go to Cloudflare Dashboard > Zero Trust > Access > Applications
2. Add Application > Self-hosted
3. Configure:
   - Application name: `Ollama API`
   - Session duration: 24 hours
   - Application domain: `ollama.yourdomain.com`
4. Create Policy:
   - Policy name: `Service Token Access`
   - Action: Allow
   - Include: Service Token
5. Generate Service Token:
   - Go to Access > Service Auth > Service Tokens
   - Create Service Token
   - Save `CF-Access-Client-Id` and `CF-Access-Client-Secret`

### Running the Tunnel

**Manual (for testing)**:
```bash
cloudflared tunnel run ollama-tunnel
```

**As a Service (production)**:

macOS:
```bash
sudo cloudflared service install
sudo launchctl start com.cloudflare.cloudflared
```

Linux:
```bash
sudo cloudflared service install
sudo systemctl start cloudflared
```

### Verification

```bash
# Test tunnel is working (should return 401 without auth)
curl https://ollama.yourdomain.com/api/tags

# Test with auth headers (should return model list)
curl https://ollama.yourdomain.com/api/tags \
  -H "CF-Access-Client-Id: <CLIENT_ID>" \
  -H "CF-Access-Client-Secret: <CLIENT_SECRET>"
```

---

## 6. Environment Variables

### Railway Environment Variables

| Variable | Example | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | `postgresql://...` | Yes | Auto-set by Railway PostgreSQL |
| `HUBSPOT_WEBHOOK_TOKEN` | `abc123...` | Yes | Shared secret for webhook auth |
| `DISCORD_WEBHOOK_URL` | `https://discord.com/api/webhooks/...` | Yes | Discord channel webhook |
| `GROQ_API_KEY` | `gsk_...` | Yes | Groq API key for fallback |
| `LOCAL_LLM_URL` | `https://ollama.yourdomain.com` | Yes | Cloudflare Tunnel URL |
| `CF_ACCESS_CLIENT_ID` | `abc123...` | Yes | Cloudflare Access client ID |
| `CF_ACCESS_CLIENT_SECRET` | `def456...` | Yes | Cloudflare Access client secret |
| `NODE_ENV` | `production` | Yes | Runtime environment |
| `LOG_LEVEL` | `info` | No | Pino log level (default: info) |
| `PORT` | `3000` | No | Server port (default: 3000) |

### Setting Variables in Railway

**Via Dashboard**:
1. Select service in Railway dashboard
2. Go to "Variables" tab
3. Add each variable with its value
4. Variables auto-inject on next deploy

**Via CLI**:
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project
railway link

# Set variable
railway variables set HUBSPOT_WEBHOOK_TOKEN=your-token-here
```

### Local Development

**.env.example** (committed to repo):
```bash
# Database
DATABASE_URL=postgresql://localhost:5432/triage_dev

# Authentication
HUBSPOT_WEBHOOK_TOKEN=dev-token-change-in-production

# External Services
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx/yyy
GROQ_API_KEY=gsk_xxx

# Local LLM
LOCAL_LLM_URL=http://localhost:11434
CF_ACCESS_CLIENT_ID=not-needed-for-local
CF_ACCESS_CLIENT_SECRET=not-needed-for-local

# Runtime
NODE_ENV=development
LOG_LEVEL=debug
PORT=3000
```

**.env** (gitignored, actual values):
```bash
# Copy from .env.example and fill in real values
```

---

## 7. Health Checks

### Health Check Endpoint

**Implementation**:
```typescript
app.get('/health', async (request, reply) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime_seconds: Math.floor(process.uptime()),
    dependencies: {
      database: await checkDatabase(),
      local_llm: { status: 'not_checked' },
      groq_api: { status: 'not_checked' }
    }
  };

  // Check database
  if (health.dependencies.database.status === 'unhealthy') {
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : 200; // Always 200 for Railway
  return reply.code(statusCode).send(health);
});

async function checkDatabase() {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: 'healthy',
      latency_ms: Date.now() - start
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}
```

### Railway Health Check Configuration

Railway automatically uses the health check endpoint specified in `railway.toml`:

```toml
[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 10  # seconds
```

**Behavior**:
- Railway pings `/health` after deployment
- If 200 response within 10s, deployment succeeds
- If non-200 or timeout, deployment rolls back

### Liveness vs Readiness

For Phase 1 MVP, a single health endpoint is sufficient. For Phase 2, consider:

**Liveness** (`/health/live`):
- Is the process running?
- Quick response (no dependency checks)
- Used for restart decisions

**Readiness** (`/health/ready`):
- Can the service handle requests?
- Includes dependency checks
- Used for traffic routing

---

## 8. Monitoring & Alerting

### Railway Built-in Monitoring

Railway provides basic monitoring out of the box:
- CPU usage
- Memory usage
- Request count
- Response times
- Deploy history

Access via: Railway Dashboard > Service > Metrics

### Logging Strategy

**Pino Logger Configuration**:
```typescript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'hubspot-triage',
    version: process.env.npm_package_version
  }
});
```

**Log Levels by Environment**:
| Environment | Level | Includes |
|-------------|-------|----------|
| Development | debug | All logs |
| Production | info | info, warn, error |
| Debugging prod | debug | Enable temporarily |

### Key Metrics to Track (via Logs)

```typescript
// Webhook metrics
logger.info({
  event: 'webhook_received',
  ticket_id: ticket.ticketId,
  latency_ms: responseTime
});

// Inference metrics
logger.info({
  event: 'inference_completed',
  ticket_id: ticket.ticketId,
  provider: 'local' | 'groq',
  latency_ms: inferenceTime,
  confidence: output.confidence
});

// Error metrics
logger.error({
  event: 'inference_failed',
  ticket_id: ticket.ticketId,
  provider: 'local',
  error_type: 'timeout',
  error_message: error.message
});
```

### Alerting (Phase 2)

**Options**:
1. **Better Stack** (formerly Logtail): Log aggregation + alerting
2. **Grafana Cloud**: Metrics + alerting (free tier available)
3. **PagerDuty/Opsgenie**: On-call alerting

**Alert Rules to Implement**:
| Metric | Threshold | Action |
|--------|-----------|--------|
| Success rate | < 95% for 15 min | Page on-call |
| Local LLM rate | < 50% for 1 hour | Email notification |
| P95 latency | > 20s for 15 min | Email notification |
| Error rate | > 10/min | Page on-call |

---

## 9. Deployment Process

### CI/CD Pipeline

**GitHub Actions Workflow** (`.github/workflows/deploy.yml`):
```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run type check
        run: npm run typecheck

      - name: Run tests
        run: npm test

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy to Railway
        run: railway up --service orchestrator
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

### Deployment Checklist

**Pre-Deploy**:
- [ ] All tests passing
- [ ] Type check passing
- [ ] Linter passing
- [ ] Environment variables updated (if needed)
- [ ] Database migrations ready (if needed)

**Deploy**:
- [ ] Push to main branch
- [ ] Monitor GitHub Actions workflow
- [ ] Monitor Railway deployment logs

**Post-Deploy**:
- [ ] Verify health check returns 200
- [ ] Send test webhook (if applicable)
- [ ] Monitor logs for errors
- [ ] Verify Discord notifications working

### Rollback Procedure

**Via Railway Dashboard**:
1. Go to Service > Deployments
2. Find previous successful deployment
3. Click "Redeploy" on that deployment

**Via CLI**:
```bash
# List recent deployments
railway deployments

# Rollback to specific deployment
railway rollback <deployment-id>
```

### Database Migrations

**Before Deploy** (if schema changes):
```bash
# Generate migration
npx prisma migrate dev --name description_of_change

# Commit migration files
git add prisma/migrations
git commit -m "db: add migration for X"
```

**During Deploy**:
Railway runs migrations automatically if configured:

```json
// package.json
{
  "scripts": {
    "build": "prisma generate && prisma migrate deploy && tsc",
    "start": "node dist/index.js"
  }
}
```

---

## 10. Disaster Recovery

### Backup Strategy

**PostgreSQL Backups**:
- Railway: Automatic daily backups (7-day retention on paid plans)
- Manual: Export via `pg_dump` before major changes

```bash
# Manual backup
railway run pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

**Configuration Backups**:
- All environment variables documented in password manager
- Cloudflare tunnel config in version control (sanitized)
- Railway config in `railway.toml`

### Recovery Procedures

**Scenario 1: Service Crash**
- Railway auto-restarts failed services (up to 3 retries)
- If persistent, check logs for root cause
- Rollback to previous deployment if needed

**Scenario 2: Database Corruption**
- Railway support can restore from backup
- Or restore from manual backup:
```bash
railway run psql $DATABASE_URL < backup-YYYYMMDD.sql
```

**Scenario 3: Credential Compromise**
1. Immediately rotate affected credential
2. Update Railway environment variable
3. Redeploy service
4. Review logs for unauthorized access

**Scenario 4: Cloudflare Tunnel Down**
- System automatically falls back to Groq
- To restore: Check cloudflared service on local machine
- Restart: `sudo systemctl restart cloudflared`

**Scenario 5: Complete Infrastructure Loss**
1. Create new Railway project
2. Provision PostgreSQL database
3. Set all environment variables
4. Deploy from GitHub (code is safe in repo)
5. Recreate Cloudflare tunnel
6. Update HubSpot webhook URL

### Recovery Time Objectives

| Scenario | RTO | RPO |
|----------|-----|-----|
| Service restart | 1 minute | 0 (stateless) |
| Rollback deploy | 5 minutes | 0 (stateless) |
| Database restore | 30 minutes | 24 hours |
| Full rebuild | 2 hours | 24 hours (for DB) |

---

## Infrastructure Checklist

### Initial Setup

- [ ] Railway account created
- [ ] GitHub repo connected to Railway
- [ ] PostgreSQL database provisioned
- [ ] All environment variables set
- [ ] Cloudflare account created
- [ ] Tunnel created and configured
- [ ] Cloudflare Access policy created
- [ ] Local Ollama installed and running
- [ ] Model pulled (`llama3.2:latest`)
- [ ] Health check verified
- [ ] Test webhook sent successfully
- [ ] Discord notification received

### Ongoing Operations

- [ ] Weekly: Review Railway metrics
- [ ] Weekly: Check log for errors
- [ ] Monthly: Verify backups
- [ ] Monthly: Review Cloudflare Access logs
- [ ] Quarterly: Rotate service tokens
- [ ] Quarterly: Update dependencies

---

**Approved By**: Architecture Agent
**Review Date**: 2025-12-14
**Next Review**: Post-Phase 1 launch
