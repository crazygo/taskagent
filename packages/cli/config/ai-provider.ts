import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { addLog } from '@taskagent/shared/logger';

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
    // Provider selection: AI_PROVIDER = 'openrouter' | 'openai' | 'auto'
    const providerPref = (process.env.AI_PROVIDER || 'auto').toLowerCase();

    const selectOpenRouter = () => ({
      providerName: 'openrouter' as const,
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL:
        process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      modelName: process.env.OPENROUTER_MODEL_NAME,
    });

    const selectOpenAI = () => ({
      providerName: 'openai' as const,
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_API_BASE_URL,
      modelName: process.env.OPENAI_MODEL_NAME,
    });

    const chosen =
      providerPref === 'openrouter'
        ? selectOpenRouter()
        : providerPref === 'openai'
        ? selectOpenAI()
        : (() => {
            // auto: prefer OpenRouter when configured, otherwise OpenAI
            const orCfg = selectOpenRouter();
            const oaCfg = selectOpenAI();
            return orCfg.apiKey ? orCfg : oaCfg;
          })();
    const primaryKey = chosen?.apiKey;
    const baseURL = chosen?.baseURL || 'https://openrouter.ai/api/v1';
    const modelName = chosen?.modelName;

    if (!primaryKey) {
      throw new Error('Neither OPENROUTER_API_KEY nor OPENAI_API_KEY is set');
    }

    if (!modelName) {
      throw new Error(
        'OPENROUTER_MODEL_NAME or OPENAI_MODEL_NAME must be set',
      );
    }

    addLog(`Using ${chosen?.providerName ?? 'openrouter'} provider with baseURL ${baseURL}`);
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
