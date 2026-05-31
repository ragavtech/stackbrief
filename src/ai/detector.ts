import { isOllamaRunning, getOllamaModels } from './providers/ollama';
import { getConfig, getProviderKey } from '../config/manager';

export interface ProviderInfo {
  available: boolean;
  provider: 'claude' | 'openai' | 'ollama' | 'local' | 'custom' | null;
  model: string | null;
  setup?: string;
  /** For local/custom providers: the base URL to route requests to */
  baseUrl?: string;
  apiKey?: string;
  displayName?: string;
}

export const SETUP_INSTRUCTIONS = `To enable AI chat, configure a provider in Settings.`;

export async function detectProvider(forceProvider?: string): Promise<ProviderInfo> {
  const config = getConfig();
  const requested = forceProvider || config.ai.activeProvider;

  // ── Explicit: Claude ──────────────────────────────────────────
  if (requested === 'claude') {
    const key = getProviderKey('claude');
    if (key) return { available: true, provider: 'claude', model: 'claude-sonnet', displayName: 'Claude' };
    return { available: false, provider: null, model: null, setup: 'Add your Claude API key in Settings → Claude.' };
  }

  // ── Explicit: OpenAI ─────────────────────────────────────────
  if (requested === 'openai') {
    const key = getProviderKey('openai');
    const model = config.ai.providers.openai.model || 'gpt-4o';
    if (key) return { available: true, provider: 'openai', model, displayName: 'OpenAI' };
    return { available: false, provider: null, model: null, setup: 'Add your OpenAI API key in Settings → OpenAI.' };
  }

  // ── Explicit: Ollama ─────────────────────────────────────────
  if (requested === 'ollama') {
    const running = await isOllamaRunning();
    if (running) {
      const models   = await getOllamaModels();
      const cfgModel = config.ai.providers.ollama.model;
      const model    = cfgModel || (models[0]?.split(':')[0] ?? 'llama3');
      return { available: true, provider: 'ollama', model, displayName: 'Ollama' };
    }
    return { available: false, provider: null, model: null, setup: 'Ollama is not running. Open Settings to set it up.' };
  }

  // ── Explicit: Local runner (LM Studio, AnythingLLM, etc.) ────
  if (requested === 'local') {
    const local = config.ai.providers.local;
    const baseUrl = local.url || 'http://localhost:1234/v1';
    const model   = local.model;
    if (model) return { available: true, provider: 'local', model, baseUrl, displayName: 'Local runner' };
    return { available: false, provider: null, model: null, setup: 'Configure a local runner in Settings.' };
  }

  // ── Explicit: Custom (OpenAI-compatible) ─────────────────────
  if (requested === 'custom') {
    const custom = config.ai.providers.custom;
    const baseUrl = custom.url;
    const model   = custom.model;
    const apiKey  = custom.apiKey || '';
    const name    = custom.name || 'Custom';
    if (baseUrl && model) return { available: true, provider: 'custom', model, baseUrl, apiKey, displayName: name };
    return { available: false, provider: null, model: null, setup: 'Configure a custom provider in Settings.' };
  }

  // ── Auto-detect: Ollama → local → Claude → OpenAI ────────────
  try {
    const ollamaRunning = await isOllamaRunning();
    if (ollamaRunning) {
      const models   = await getOllamaModels();
      const cfgModel = config.ai.providers.ollama.model;
      const model    = cfgModel || (models.length > 0 ? models[0].split(':')[0] : 'llama3');
      return { available: true, provider: 'ollama', model, displayName: 'Ollama' };
    }
  } catch { /* Ollama not reachable */ }

  // Local runner configured?
  const local = config.ai.providers.local;
  if (local.model && local.url) {
    return { available: true, provider: 'local', model: local.model, baseUrl: local.url, displayName: 'Local runner' };
  }

  const claudeKey = getProviderKey('claude');
  if (claudeKey) {
    return { available: true, provider: 'claude', model: config.ai.providers.claude.model || 'claude-sonnet-4-20250514', displayName: 'Claude' };
  }

  const openaiKey = getProviderKey('openai');
  if (openaiKey) {
    return { available: true, provider: 'openai', model: config.ai.providers.openai.model || 'gpt-4o', displayName: 'OpenAI' };
  }

  // Custom configured?
  const custom = config.ai.providers.custom;
  if (custom.url && custom.model) {
    return { available: true, provider: 'custom', model: custom.model, baseUrl: custom.url, apiKey: custom.apiKey, displayName: custom.name || 'Custom' };
  }

  return { available: false, provider: null, model: null, setup: SETUP_INSTRUCTIONS };
}
