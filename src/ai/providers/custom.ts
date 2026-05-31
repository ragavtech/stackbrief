/**
 * Custom / OpenAI-compatible provider.
 * Works with any service that implements the OpenAI chat completions API:
 * LM Studio, AnythingLLM, Ollama (OpenAI mode), Groq, Mistral, Together AI, etc.
 */
import https from 'https';
import http from 'http';
import { AIResponse } from './ollama';

export interface CustomProviderConfig {
  baseUrl: string;   // e.g. "http://localhost:1234/v1" or "https://api.groq.com/openai/v1"
  apiKey?: string;   // optional — local runners usually don't need one
  model: string;
  name?: string;     // display name (e.g. "Groq", "LM Studio")
}

export async function askCustomProvider(
  question: string,
  systemPrompt: string,
  config: CustomProviderConfig
): Promise<AIResponse> {
  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: question }
    ],
    max_tokens: 1024,
  });

  const url = new URL('/chat/completions', config.baseUrl.endsWith('/')
    ? config.baseUrl : config.baseUrl + '/');

  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const port = url.port ? parseInt(url.port) : (isHttps ? 443 : 80);

  const headers: Record<string, string> = {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body).toString(),
  };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  return new Promise((resolve, reject) => {
    const req = (lib as typeof https).request({
      hostname: url.hostname,
      port,
      path: url.pathname,
      method: 'POST',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message || 'Provider error');
          const answer = json.choices?.[0]?.message?.content || 'No response from provider';
          resolve({
            answer,
            provider: config.name?.toLowerCase().replace(/\s+/g, '-') || 'custom',
            model: config.model,
          });
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}
