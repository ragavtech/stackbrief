import https from 'https';
import { AIResponse } from './ollama';

export async function askClaude(
  question: string,
  systemPrompt: string,
  apiKey?: string,
  model = 'claude-sonnet-4-20250514'
): Promise<AIResponse> {
  const resolvedKey = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!resolvedKey) throw new Error('No Claude API key configured. Add one in Settings → Claude.');
  const body = JSON.stringify({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: question }]
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key':          resolvedKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
        'content-length':     Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message || 'Claude API error');
          const answer = json.content?.[0]?.text || 'No response from Claude';
          resolve({ answer, provider: 'claude', model: 'claude-sonnet' });
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Claude request timed out')); });
    req.write(body);
    req.end();
  });
}
