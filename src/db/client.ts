/**
 * Prisma Client Singleton
 *
 * This module provides a singleton instance of the Prisma client to prevent
 * connection pool exhaustion and ensure efficient database connection management.
 *
 * In development, it uses globalThis to preserve the instance across hot reloads.
 * In production, a single instance is created and exported.
 */

import { PrismaClient } from '@prisma/client';

// Type for global Prisma instance (development only)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Prisma client options
const prismaOptions = {
  log: process.env.NODE_ENV === 'development'
    ? ['query' as const, 'error' as const, 'warn' as const]
    : ['error' as const],
};

/**
 * Singleton Prisma Client instance
 *
 * In development: Uses globalThis to survive hot reloads
 * In production: Creates a single instance
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient(prismaOptions);

// Store in global for development hot reload preservation
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Gracefully disconnect from database on application shutdown
 * Call this during server shutdown to properly close connections
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Test database connection
 * Useful for health checks and startup verification
 */
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}
