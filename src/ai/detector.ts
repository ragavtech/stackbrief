import { isOllamaRunning, getOllamaModels } from './providers/ollama';
import { getConfig, getProviderKey } from '../config/manager';

export interface ProviderInfo {
  available: boolean;
  provider: 'claude' | 'openai' | 'ollama' | null;
  model: string | null;
  setup?: string;
}

export const SETUP_INSTRUCTIONS = `To enable AI chat, configure a provider in Settings.`;

export async function detectProvider(forceProvider?: string): Promise<ProviderInfo> {
  const config = getConfig();
  const requested = forceProvider || config.ai.activeProvider;

  // ── Explicit provider requested ──────────────────────────────

  if (requested === 'claude') {
    const key = getProviderKey('claude');
    const model = config.ai.providers.claude.model || 'claude-sonnet-4-20250514';
    if (key) return { available: true, provider: 'claude', model: 'claude-sonnet' };
    return { available: false, provider: null, model: null,
      setup: 'Add your Claude API key in Settings → Claude.' };
  }

  if (requested === 'openai') {
    const key = getProviderKey('openai');
    const model = config.ai.providers.openai.model || 'gpt-4o';
    if (key) return { available: true, provider: 'openai', model };
    return { available: false, provider: null, model: null,
      setup: 'Add your OpenAI API key in Settings → OpenAI.' };
  }

  if (requested === 'ollama') {
    const running = await isOllamaRunning();
    if (running) {
      const models  = await getOllamaModels();
      const cfgModel = config.ai.providers.ollama.model;
      const model   = cfgModel || (models[0]?.split(':')[0] ?? 'llama3');
      return { available: true, provider: 'ollama', model };
    }
    return { available: false, provider: null, model: null,
      setup: 'Ollama is not running. Open Settings to set it up.' };
  }

  // ── Auto-detect: Ollama → Claude → OpenAI ──────────────────

  try {
    const ollamaRunning = await isOllamaRunning();
    if (ollamaRunning) {
      const models  = await getOllamaModels();
      const cfgModel = config.ai.providers.ollama.model;
      const model   = cfgModel || (models.length > 0 ? models[0].split(':')[0] : 'llama3');
      return { available: true, provider: 'ollama', model };
    }
  } catch { /* Ollama not reachable */ }

  const claudeKey = getProviderKey('claude');
  if (claudeKey) {
    return { available: true, provider: 'claude',
      model: config.ai.providers.claude.model || 'claude-sonnet-4-20250514' };
  }

  const openaiKey = getProviderKey('openai');
  if (openaiKey) {
    return { available: true, provider: 'openai',
      model: config.ai.providers.openai.model || 'gpt-4o' };
  }

  return { available: false, provider: null, model: null, setup: SETUP_INSTRUCTIONS };
}
