-- Migration: Initial Schema Setup
-- Date: 2025-12-14
-- Author: Database Engineer
-- Purpose: Create idempotency store for tracking processed HubSpot tickets
-- Affected Tables: processed_tickets
-- Estimated Duration: < 100ms (empty database)
-- Rollback Plan: See DOWN migration below

-- UP Migration
-- CreateTable: processed_tickets
-- This table stores HubSpot ticket IDs that have been processed to prevent duplicates
CREATE TABLE "processed_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" VARCHAR(255) NOT NULL,
    "processed_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" VARCHAR(50) NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint on ticket_id for idempotency
-- This ensures we can't accidentally process the same ticket twice
CREATE UNIQUE INDEX "processed_tickets_ticket_id_key" ON "processed_tickets"("ticket_id");

-- CreateIndex: Index on processed_at for cleanup queries
-- Used by cleanupOldRecords() function to delete records older than retention period
CREATE INDEX "idx_processed_at" ON "processed_tickets"("processed_at");

-- CreateIndex: Index on provider for analytics queries
-- Allows quick grouping by provider (local vs groq)
CREATE INDEX "idx_provider" ON "processed_tickets"("provider");

-- Performance Expectations:
-- - INSERT: < 50ms (single row)
-- - SELECT by ticket_id: < 10ms (indexed unique lookup via unique constraint)
-- - DELETE old records: < 200ms (for ~1000 records)

-- Note: ticketId has an implicit index via the UNIQUE constraint above
-- No separate index needed for ticket_id lookups

-- DOWN Migration (Rollback)
-- Uncomment below and run manually to rollback this migration
/*
DROP INDEX IF EXISTS "idx_provider";
DROP INDEX IF EXISTS "idx_processed_at";
DROP INDEX IF EXISTS "processed_tickets_ticket_id_key";
DROP TABLE IF EXISTS "processed_tickets";
*/
