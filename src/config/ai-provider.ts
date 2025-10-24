import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { addLog } from '../logger.ts';

type ChatModelFactory = ReturnType<typeof createOpenRouter>['chat'];

export type AiChatProvider = {
  chat: ChatModelFactory;
};

type CachedProvider = {
  provider: AiChatProvider;
  modelName: string;
  reasoningEnabled: boolean;
};

let cachedProvider: CachedProvider | null = null;

export function ensureAiProvider(): CachedProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  try {
    const primaryKey =
      process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
    const baseURL =
      process.env.OPENROUTER_BASE_URL ??
      process.env.OPENAI_API_BASE_URL ??
      'https://openrouter.ai/api/v1';
    const modelName =
      process.env.OPENROUTER_MODEL_NAME ?? process.env.OPENAI_MODEL_NAME;

    if (!primaryKey) {
      throw new Error('Neither OPENROUTER_API_KEY nor OPENAI_API_KEY is set');
    }

    if (!modelName) {
      throw new Error(
        'OPENROUTER_MODEL_NAME or OPENAI_MODEL_NAME must be set',
      );
    }

    addLog(`Using OpenRouter provider with baseURL ${baseURL}`);
    const client = createOpenRouter({
      apiKey: primaryKey,
      baseURL,
    });

    const reasoningEnabled = process.env.AI_REASONING_ENABLED
      ? process.env.AI_REASONING_ENABLED === 'true'
      : true;

    cachedProvider = {
      provider: {
        chat: model => client.chat(model),
      },
      modelName,
      reasoningEnabled,
    };

    return cachedProvider;
  } catch (error) {
    addLog(`Failed to initialize AI provider: ${error}`);
    throw error;
  }
}
