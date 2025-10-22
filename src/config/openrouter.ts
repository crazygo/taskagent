import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export const getOpenRouterClient = () => {
  const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_API_KEY) {
    // This should ideally be caught by loadEnv, but as a safeguard
    console.error('OPENROUTER_API_KEY is not set. OpenRouter client cannot be initialized.');
    process.exit(1);
  }

  return createOpenRouter({
      apiKey: OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
  });
};

export const modelName = process.env.OPENROUTER_MODEL_NAME || 'google/gemini-flash';