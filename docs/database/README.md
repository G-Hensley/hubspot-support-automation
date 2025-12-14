# Database Setup and Migration Guide

This document describes the database setup, migration process, and operational procedures for the HubSpot Support Triage Automation system.

## Overview

The system uses **PostgreSQL** as the database with **Prisma** as the ORM. The database is hosted on **Railway** in production and can run locally for development.

### Database Purpose

The primary purpose of the database is to serve as an **idempotency store**:
- Tracks which HubSpot ticket IDs have been processed
- Prevents duplicate notifications when HubSpot retries webhooks
- Records which LLM provider was used (local/groq)
- Tracks success/failure for monitoring

## Schema Overview

### ProcessedTicket Model

```prisma
model ProcessedTicket {
  id          String   @id @default(uuid()) @db.Uuid
  ticketId    String   @unique @map("ticket_id") @db.VarChar(255)
  processedAt DateTime @default(now()) @map("processed_at") @db.Timestamptz(3)
  provider    String   @map("provider") @db.VarChar(50)
  success     Boolean  @default(true) @map("success")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
}
```

**Indexes**:
- `idx_ticket_id`: Fast lookups for idempotency checks
- `idx_processed_at`: Efficient cleanup of old records
- `idx_provider`: Analytics queries by provider

**Performance Targets**:
- INSERT: < 50ms
- SELECT by ticket_id: < 10ms
- Cleanup old records: < 200ms for ~1000 records

## Setup Instructions

### Local Development

1. **Install PostgreSQL** (if not already installed):
   ```bash
   # macOS
   brew install postgresql@15
   brew services start postgresql@15

   # Linux (Ubuntu/Debian)
   sudo apt update
   sudo apt install postgresql-15
   sudo systemctl start postgresql
   ```

2. **Create local database**:
   ```bash
   # Connect to PostgreSQL
   psql postgres

   # Create database
   CREATE DATABASE triage_dev;

   # Exit psql
   \q
   ```

3. **Set up environment variables**:
   ```bash
   # Copy example file
   cp .env.example .env

   # Edit .env and set DATABASE_URL
   # DATABASE_URL=postgresql://localhost:5432/triage_dev
   ```

4. **Run migrations**:
   ```bash
   npm run db:migrate:dev
   ```

5. **Verify setup**:
   ```bash
   npm run db:verify
   ```

### Railway Production Setup

1. **Create PostgreSQL database**:
   - In Railway dashboard: New > Database > PostgreSQL
   - Railway auto-generates `DATABASE_URL` environment variable

2. **Deploy application**:
   - Push to `main` branch triggers automatic deployment
   - Railway runs `prisma migrate deploy` during build (see package.json)

3. **Verify migration**:
   ```bash
   # Check Railway logs for migration success
   railway logs
   ```

## Database Operations

### Running Migrations

**Development** (creates new migrations):
```bash
npm run db:migrate:dev
```

**Production** (applies existing migrations):
```bash
npm run db:migrate:deploy
```

**Dry run** (preview without applying):
```bash
npm run db:migrate:dry-run
```

### Schema Changes

When modifying the schema:

1. **Edit** `prisma/schema.prisma`
2. **Generate migration**:
   ```bash
   npx prisma migrate dev --name descriptive_name
   ```
3. **Review** the generated SQL in `prisma/migrations/`
4. **Test** locally before deploying
5. **Commit** migration files to git
6. **Deploy** to Railway (automatic on push to main)

### Database Utilities

**Open Prisma Studio** (GUI for browsing data):
```bash
npm run db:studio
```

**Validate schema**:
```bash
npm run db:verify
```

**Generate Prisma client** (after schema changes):
```bash
npm run db:generate
```

## Maintenance Tasks

### Cleanup Old Records

The database has a 7-day retention policy for processed tickets. Run cleanup periodically:

**Manual cleanup**:
```typescript
import { cleanupOldRecords } from './src/db';

// Delete records older than 7 days
const deletedCount = await cleanupOldRecords(7);
console.log(`Deleted ${deletedCount} old records`);
```

**Automated cleanup options**:
1. **Railway Cron** (if available): Create separate cron service
2. **External Cron**: Use cron-job.org to call cleanup endpoint
3. **In-app**: Run on service startup (simple for MVP)

### Get Statistics

Monitor processing statistics:

```typescript
import { getProcessingStats } from './src/db';

const stats = await getProcessingStats();
console.log(stats);
// {
//   total: 150,
//   byProvider: [
//     { provider: 'local', count: 120 },
//     { provider: 'groq', count: 30 }
//   ],
//   successRate: 0.96
// }
```

### Health Checks

Check database health:

```typescript
import { checkIdempotencyHealth } from './src/db';

const isHealthy = await checkIdempotencyHealth();
console.log(`Database health: ${isHealthy ? 'OK' : 'DEGRADED'}`);
```

## Backup and Recovery

### Railway Backups

- **Automatic**: Daily backups with 7-day retention (paid plans)
- **Manual**: Export via Railway dashboard or CLI

### Manual Backup

```bash
# Create backup
railway run pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Restore from backup
railway run psql $DATABASE_URL < backup-YYYYMMDD.sql
```

### Disaster Recovery

If database is corrupted or lost:

1. **Railway**: Contact support to restore from backup
2. **Manual**: Restore from manual backup file
3. **Fresh start**: Re-run migrations (loses processed ticket history)

## Troubleshooting

### Connection Issues

**Error**: `Can't reach database server`

**Solutions**:
- Verify `DATABASE_URL` is correct
- Check PostgreSQL is running: `brew services list` or `systemctl status postgresql`
- Test connection: `psql $DATABASE_URL`

### Migration Failures

**Error**: `Migration failed to apply`

**Solutions**:
- Check Railway logs for detailed error
- Verify schema is valid: `npm run db:verify`
- Check for conflicting migrations
- Rollback if needed (see Rollback section)

### Performance Issues

**Symptom**: Slow idempotency checks (> 100ms)

**Solutions**:
- Verify indexes exist: `\d+ processed_tickets` in psql
- Run `ANALYZE processed_tickets;` to update statistics
- Check connection pool settings in Prisma
- Consider adding Redis cache layer (Phase 2)

## Connection Pooling

For production, consider these settings:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // Optional: Configure connection pool
  // relationMode = "prisma"
}
```

Railway provides connection pooling via PgBouncer if needed.

## Security Considerations

- **Never commit** `.env` file with real credentials
- **Rotate** `DATABASE_URL` credentials periodically
- **Use** Railway's built-in secrets management
- **Enable** SSL for production connections (Railway default)
- **Restrict** database access to Railway internal network

## Migration History

| Migration | Date | Description | Tables Affected |
|-----------|------|-------------|-----------------|
| 20251214000000_init | 2025-12-14 | Initial schema setup | processed_tickets |

## Useful Queries

**Check recent processed tickets**:
```sql
SELECT ticket_id, provider, processed_at, success
FROM processed_tickets
ORDER BY processed_at DESC
LIMIT 10;
```

**Count by provider**:
```sql
SELECT provider, COUNT(*) as count
FROM processed_tickets
GROUP BY provider;
```

**Find failed triage attempts**:
```sql
SELECT ticket_id, provider, processed_at
FROM processed_tickets
WHERE success = false
ORDER BY processed_at DESC;
```

**Cleanup simulation** (preview what would be deleted):
```sql
SELECT COUNT(*) as records_to_delete
FROM processed_tickets
WHERE processed_at < NOW() - INTERVAL '7 days';
```

## Performance Monitoring

Monitor these metrics:

- **Query execution time**: Should be < 50ms average
- **Connection pool utilization**: Should stay < 80%
- **Table size**: Should stay < 1MB (with 7-day retention)
- **Index usage**: All indexes should show `idx_scan > 0`

Check index usage:
```sql
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public' AND tablename = 'processed_tickets'
ORDER BY idx_scan ASC;
```

## References

- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Railway PostgreSQL Guide](https://docs.railway.app/databases/postgresql)
- [Architecture Overview](/docs/architecture/architecture-overview.md)
- [Infrastructure Design](/docs/architecture/infrastructure-design.md)
