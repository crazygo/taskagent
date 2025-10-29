import dotenv from 'dotenv';

// Load local .env.local if present
dotenv.config({ path: '.env.local' });

// Fallback: load from ~/.askman/.env.local without overriding any variables already set
try {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    const fallbackPath = `${homeDir}/.askman/.env.local`;
    dotenv.config({ path: fallbackPath, override: false });
  }
} catch {}

export const loadEnv = () => {
  const missingEnvVars: string[] = [];

  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (!hasOpenRouter && !hasOpenAI) {
    missingEnvVars.push('OPENROUTER_API_KEY or OPENAI_API_KEY');
  }

  if (hasOpenRouter && !process.env.OPENROUTER_MODEL_NAME) {
    missingEnvVars.push('OPENROUTER_MODEL_NAME');
  }

  if (hasOpenAI && !process.env.OPENAI_MODEL_NAME) {
    missingEnvVars.push('OPENAI_MODEL_NAME');
  }

  ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL'].forEach(envVar => {
    if (!process.env[envVar]) {
      missingEnvVars.push(envVar);
    }
  });

  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  }
};
