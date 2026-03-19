/**
 * llmConfig.js
 * Purpose: Central LLM configuration — reads from .env, exports active provider
 * Author: TraceLens
 */

const providers = {
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 4096,
    temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.3,
    streaming: true
  },
  ollama: {
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 4096,
    temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.3,
    streaming: true
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 4096,
    temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.3,
    streaming: true
  },
  lmstudio: {
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: 'lmstudio',
    model: process.env.LMSTUDIO_MODEL || 'local-model',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 4096,
    temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.3,
    streaming: true
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 4096,
    temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.3,
    streaming: true
  }
};

const providerKey = (process.env.LLM_PROVIDER || 'groq').toLowerCase();
const activeProvider = providers[providerKey];

if (!activeProvider) {
  console.error(`[LLM Config] Unknown provider: "${providerKey}". Valid options: ${Object.keys(providers).join(', ')}`);
  process.exit(1);
}

module.exports = { providers, activeProvider, providerKey };
