import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export const getOpenRouterClient = () => {
  const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set. OpenRouter client cannot be initialized.');
  }

  return createOpenRouter({
      apiKey: OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
  });
};

export const getModelName = () => {
  const name = process.env.OPENROUTER_MODEL_NAME;
  if (!name) {
    throw new Error('OPENROUTER_MODEL_NAME is not set.');
  }
  return name;
};

export type OpenRouterClient = ReturnType<typeof createOpenRouter>;
