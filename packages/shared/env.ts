import { join } from 'node:path';
import dotenv from 'dotenv';
import { addLog } from './logger.js';

const loadEnvFile = (filePath: string, options?: { override?: boolean }) => {
  dotenv.config({
    path: filePath,
    override: options?.override ?? false,
    debug: false,
  });
};

export const loadEnv = (workspacePath?: string) => {
  if (workspacePath && workspacePath.trim().length > 0) {
    const workspaceEnvPath = join(workspacePath, '.askman', '.env.local');
    loadEnvFile(workspaceEnvPath);
  }

  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (homeDir) {
      const fallbackPath = join(homeDir, '.askman', '.env.local');
      loadEnvFile(fallbackPath);
    }
  } catch (error) {
    addLog(`Failed to load home directory env file: ${error instanceof Error ? error.message : String(error)}`);
  }

  loadEnvFile('.env.local');

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
