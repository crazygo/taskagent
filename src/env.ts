import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// --- Environment Variable Workaround ---
if (process.env.OPENROUTER_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.OPENROUTER_API_KEY;
}

export const loadEnv = () => {
    const requiredEnvVars = [
        'OPENROUTER_API_KEY',
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_MODEL',
    ];
    const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

    if (missingEnvVars.length > 0) {
        console.error(`Error: Missing required environment variables: ${missingEnvVars.join(', ')}`);
        console.error('Please ensure these are set in your .env file or environment.');
        process.exit(1);
    }
};