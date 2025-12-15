import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Environment variable schema with validation
const envSchema = z.object({
  // Runtime configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database configuration
  DATABASE_URL: z.string().url(),

  // Authentication
  HUBSPOT_WEBHOOK_TOKEN: z.string().min(1, 'HUBSPOT_WEBHOOK_TOKEN is required'),

  // External services
  DISCORD_WEBHOOK_URL: z.string().url(),
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),

  // Local LLM configuration
  LOCAL_LLM_URL: z.string().url().default('http://localhost:11434'),
  LOCAL_LLM_TOKEN: z.string().optional(),
  CF_ACCESS_CLIENT_ID: z.string().optional(),
  CF_ACCESS_CLIENT_SECRET: z.string().optional(),
});

// Validate environment variables
function loadConfig() {
  try {
    const config = envSchema.parse(process.env);
    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Environment validation failed:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

// Export validated configuration
export const config = loadConfig();

// Export TypeScript type for config
export type Config = z.infer<typeof envSchema>;
