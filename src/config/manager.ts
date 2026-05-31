import fs from 'fs';
import path from 'path';
import os from 'os';

export const CONFIG_DIR  = path.join(os.homedir(), '.stackbrief');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface ProviderConfig {
  enabled: boolean;
  model: string;
  apiKey?: string;
  url?: string;
}

export interface AIConfig {
  activeProvider: 'auto' | 'ollama' | 'claude' | 'openai' | 'local' | 'custom';
  providers: {
    ollama:  ProviderConfig;
    claude:  ProviderConfig;
    openai:  ProviderConfig;
    local:   ProviderConfig & { url?: string };
    custom:  ProviderConfig & { name?: string; url?: string };
  };
}

export interface StackbriefConfig {
  ai: AIConfig;
  firstRunComplete: boolean;
  projects: Record<string, { ai?: Partial<AIConfig> }>;
}

const DEFAULT_CONFIG: StackbriefConfig = {
  ai: {
    activeProvider: 'auto',
    providers: {
      ollama:  { enabled: false, model: 'llama3',                   url: 'http://localhost:11434' },
      claude:  { enabled: false, model: 'claude-sonnet-4-20250514', apiKey: '' },
      openai:  { enabled: false, model: 'gpt-4o',                   apiKey: '' },
      local:   { enabled: false, model: '',      url: 'http://localhost:1234/v1' },
      custom:  { enabled: false, model: '',      url: '', apiKey: '', name: '' },
    }
  },
  firstRunComplete: false,
  projects: {}
};

function deepMerge(defaults: unknown, override: unknown): unknown {
  if (typeof defaults !== 'object' || defaults === null) return override ?? defaults;
  if (typeof override !== 'object' || override === null) return defaults;
  const result: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const key of Object.keys(override as Record<string, unknown>)) {
    const ov = (override as Record<string, unknown>)[key];
    const dv = result[key];
    if (typeof ov === 'object' && ov !== null && !Array.isArray(ov) &&
        typeof dv === 'object' && dv !== null && !Array.isArray(dv)) {
      result[key] = deepMerge(dv, ov);
    } else {
      result[key] = ov;
    }
  }
  return result;
}

export function getConfig(): StackbriefConfig {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return deepMerge(DEFAULT_CONFIG, JSON.parse(raw)) as StackbriefConfig;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

export function saveConfig(config: StackbriefConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function updateProvider(
  name: 'ollama' | 'claude' | 'openai',
  settings: Partial<ProviderConfig>
): void {
  const config = getConfig();
  config.ai.providers[name] = { ...config.ai.providers[name], ...settings };
  saveConfig(config);
}

export function setActiveProvider(provider: string): void {
  const config = getConfig();
  config.ai.activeProvider = provider as AIConfig['activeProvider'];
  saveConfig(config);
}

export function markFirstRunComplete(): void {
  const config = getConfig();
  config.firstRunComplete = true;
  saveConfig(config);
}

/** Returns config with API keys masked — safe to send over HTTP */
export function getMaskedConfig(config: StackbriefConfig): StackbriefConfig {
  const masked: StackbriefConfig = JSON.parse(JSON.stringify(config));
  for (const p of Object.values(masked.ai.providers)) {
    if (p.apiKey && p.apiKey.length > 4) {
      p.apiKey = p.apiKey.slice(0, 6) + '…configured';
    }
  }
  return masked;
}

/** Returns actual API key for a provider — for internal use only, never log */
export function getProviderKey(name: 'claude' | 'openai'): string {
  const config = getConfig();
  const fromConfig = config.ai.providers[name]?.apiKey || '';
  const fromEnv = name === 'claude'
    ? (process.env.ANTHROPIC_API_KEY || '')
    : (process.env.OPENAI_API_KEY || '');
  return fromConfig || fromEnv;
}
