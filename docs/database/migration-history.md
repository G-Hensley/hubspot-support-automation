# Database Migration History

This document tracks all database schema changes and migrations for the HubSpot Support Triage Automation system.

## Migration Log

### 20251214000000_init - Initial Schema Setup

**Date**: 2025-12-14
**Author**: Database Engineer
**Status**: Ready for deployment
**PR**: #TBD

**Purpose**: Create the initial database schema for the idempotency store.

**Tables Created**:
- `processed_tickets`: Stores HubSpot ticket IDs that have been processed

**Indexes Created**:
- `processed_tickets_ticket_id_key`: Unique constraint on ticket_id (creates implicit index for fast lookups)
- `idx_processed_at`: B-tree index on processed_at for cleanup queries
- `idx_provider`: B-tree index on provider for analytics

**Schema Details**:
```sql
CREATE TABLE "processed_tickets" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "ticket_id" VARCHAR(255) UNIQUE NOT NULL,
    "processed_at" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "success" BOOLEAN DEFAULT true NOT NULL,
    "created_at" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**Performance Impact**:
- Expected query time for idempotency check: < 10ms
- Expected insert time: < 50ms
- Index overhead: ~30% storage increase (acceptable)

**Rollback Plan**:
```sql
DROP INDEX IF EXISTS "idx_provider";
DROP INDEX IF EXISTS "idx_processed_at";
DROP TABLE IF EXISTS "processed_tickets";
-- Note: processed_tickets_ticket_id_key is dropped automatically when table is dropped
```

**Testing Checklist**:
- [x] Schema validates with `prisma validate`
- [ ] Migration tested on local PostgreSQL
- [ ] Rollback tested successfully
- [ ] Performance benchmarks meet targets
- [ ] Zero-downtime verified (N/A for initial migration)

**Deployment Notes**:
- This is the initial migration - no data to preserve
- Expected execution time: < 100ms on empty database
- No application downtime expected

---

## Migration Guidelines

When adding new migrations, include the following information:

### Required Information
1. **Migration ID**: Timestamp-based identifier (YYYYMMDDHHMMSS_description)
2. **Date**: Date of creation
3. **Author**: Agent or developer who created it
4. **Purpose**: Clear description of what and why
5. **Tables Affected**: List of tables created, modified, or deleted
6. **Performance Impact**: Expected query time changes
7. **Rollback Plan**: SQL to reverse the migration
8. **Testing Checklist**: Verification steps completed

### Migration Naming Convention
```
YYYYMMDDHHMMSS_descriptive_name.sql
```

Examples:
- `20251214000000_init.sql` - Initial setup
- `20251215120000_add_ticket_metadata.sql` - Add metadata columns
- `20251220093000_add_confidence_index.sql` - Add index for confidence queries

### Performance Benchmarks

All migrations must meet these performance targets:

| Operation | Target | Notes |
|-----------|--------|-------|
| Simple SELECT | < 10ms | Single row lookup by indexed column |
| INSERT | < 50ms | Single row insert |
| UPDATE | < 100ms | Single row update |
| DELETE (single) | < 50ms | Single row delete |
| DELETE (bulk) | < 500ms | Bulk delete (e.g., cleanup) for ~1000 rows |
| Migration execution | < 5s | Total time for migration to complete |

### Zero-Downtime Strategies

For production migrations that modify existing tables:

1. **Add-only changes first**:
   - Add new columns as nullable
   - Add new indexes concurrently (`CREATE INDEX CONCURRENTLY`)
   - Add new tables

2. **Backward-compatible intermediate state**:
   - Application code must work with both old and new schema
   - Deploy code changes before schema changes

3. **Gradual cutover**:
   - Backfill data in background
   - Switch application to use new columns/tables
   - Remove old columns/tables in subsequent migration

4. **Index creation**:
   ```sql
   -- Use CONCURRENTLY to avoid locking table
   CREATE INDEX CONCURRENTLY idx_name ON table_name(column_name);
   ```

### Rollback Procedures

**When to rollback**:
- Migration fails during execution
- Unexpected performance degradation
- Data integrity issues discovered
- Breaking changes affecting production

**How to rollback**:

1. **Automatic rollback** (if migration fails):
   - Prisma wraps migrations in transactions
   - Failed migrations automatically rollback

2. **Manual rollback**:
   ```bash
   # View migration history
   npx prisma migrate status

   # Create rollback migration
   # Copy DOWN migration SQL from failed migration
   # Create new migration with rollback SQL

   # Apply rollback
   npx prisma migrate deploy
   ```

3. **Emergency rollback** (production):
   ```bash
   # Connect to Railway database
   railway run psql $DATABASE_URL

   # Run rollback SQL from migration file
   # (See migration's rollback plan)
   ```

## Migration Review Checklist

Before merging a migration PR:

- [ ] Migration file follows naming convention
- [ ] UP migration SQL is present and correct
- [ ] DOWN migration (rollback) SQL is documented
- [ ] All indexes are properly named
- [ ] Foreign keys have ON DELETE/ON UPDATE clauses
- [ ] Performance benchmarks documented and met
- [ ] Migration tested on local PostgreSQL
- [ ] Rollback tested successfully
- [ ] Zero-downtime strategy documented (if applicable)
- [ ] Migration history updated in this file
- [ ] Schema changes reflected in `schema.prisma`
- [ ] Database utility functions updated (if needed)

## Statistics

**Total Migrations**: 1
**Total Tables**: 1
**Total Indexes**: 4 (including unique constraint)
**Database Size**: ~10 KB (schema only, no data yet)

---

**Last Updated**: 2025-12-14
**Next Review**: After Phase 1 launch
