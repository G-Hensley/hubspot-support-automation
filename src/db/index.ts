/**
 * Database Module Exports
 *
 * This module exports all database-related utilities for easy importing
 * throughout the application.
 */

// Prisma client singleton
export { prisma, disconnectDatabase, testDatabaseConnection } from './client';

// Idempotency functions
export {
  isTicketProcessed,
  markTicketProcessed,
  cleanupOldRecords,
  getProcessingStats,
  checkIdempotencyHealth,
} from './idempotency';

// Type exports
export type { IdempotencyCheckResult } from './idempotency';
