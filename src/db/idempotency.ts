/**
 * Idempotency Manager
 *
 * This module provides functions to track processed tickets and prevent duplicate
 * processing when HubSpot retries webhooks.
 *
 * Key features:
 * - Atomic operations to handle race conditions
 * - Fail-open strategy on database errors (prefer duplicates over lost tickets)
 * - Efficient lookups with indexed queries
 */

import { prisma } from './client';

/**
 * Result of an idempotency check
 */
export interface IdempotencyCheckResult {
  isProcessed: boolean;
  provider?: string;
  processedAt?: Date;
}

/**
 * Check if a ticket has already been processed
 *
 * @param ticketId - HubSpot ticket ID
 * @returns Promise resolving to check result
 *
 * Performance: Expected < 50ms with proper indexing
 * Fail-open: Returns false on database errors to prevent lost tickets
 */
export async function isTicketProcessed(
  ticketId: string
): Promise<IdempotencyCheckResult> {
  try {
    const record = await prisma.processedTicket.findUnique({
      where: { ticketId },
      select: {
        provider: true,
        processedAt: true,
      },
    });

    if (!record) {
      return { isProcessed: false };
    }

    return {
      isProcessed: true,
      provider: record.provider,
      processedAt: record.processedAt,
    };
  } catch (error: unknown) {
    // Fail-open: Log error and allow processing to prevent lost tickets
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Idempotency check failed:', message);
    return { isProcessed: false };
  }
}

/**
 * Mark a ticket as processed
 *
 * @param ticketId - HubSpot ticket ID
 * @param provider - LLM provider used ("local" or "groq")
 * @param success - Whether triage succeeded
 * @returns Promise resolving when stored
 *
 * Performance: Expected < 100ms for INSERT operation
 * Handles race conditions via ON CONFLICT (unique constraint on ticketId)
 */
export async function markTicketProcessed(
  ticketId: string,
  provider: string,
  success: boolean = true
): Promise<void> {
  try {
    // Intentionally update processedAt on conflict to track the most recent processing attempt.
    // This helps distinguish between the original processing time and retry attempts,
    // which is useful for debugging webhook retry behavior and duplicate detection.
    await prisma.processedTicket.upsert({
      where: { ticketId },
      create: {
        ticketId,
        provider,
        success,
      },
      update: {
        // If duplicate (race condition), update the provider and success
        provider,
        success,
        processedAt: new Date(),
      },
    });
  } catch (error: unknown) {
    // Log but don't throw - failing to store idempotency record
    // is not fatal, just risks duplicate processing
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to mark ticket as processed:', message);
  }
}

/**
 * Clean up old processed ticket records
 *
 * Deletes records older than the specified retention period.
 * Should be called periodically (e.g., daily) to prevent unbounded growth.
 *
 * @param retentionDays - Number of days to retain records (default: 7)
 * @returns Promise resolving to number of deleted records
 *
 * Performance: Expected < 500ms for typical volume
 */
export async function cleanupOldRecords(
  retentionDays: number = 7
): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await prisma.processedTicket.deleteMany({
      where: {
        processedAt: {
          lt: cutoffDate,
        },
      },
    });

    return result.count;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to cleanup old records:', message);
    return 0;
  }
}

/**
 * Get statistics about processed tickets
 *
 * Useful for monitoring and debugging
 *
 * @returns Promise resolving to statistics object
 */
export async function getProcessingStats(): Promise<{
  total: number;
  byProvider: { provider: string; count: number }[];
  successRate: number;
}> {
  try {
    const [total, byProvider, successCount] = await Promise.all([
      prisma.processedTicket.count(),
      prisma.processedTicket.groupBy({
        by: ['provider'],
        _count: { provider: true },
      }),
      prisma.processedTicket.count({
        where: { success: true },
      }),
    ]);

    return {
      total,
      byProvider: byProvider.map((item) => ({
        provider: item.provider,
        count: item._count.provider,
      })),
      successRate: total > 0 ? successCount / total : 0,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to get processing stats:', message);
    return {
      total: 0,
      byProvider: [],
      successRate: 0,
    };
  }
}

/**
 * Check if idempotency store is healthy
 *
 * Performs a simple query to verify database connectivity
 * Useful for health check endpoints
 *
 * @returns Promise resolving to true if healthy
 */
export async function checkIdempotencyHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Idempotency health check failed:', message);
    return false;
  }
}
