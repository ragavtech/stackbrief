import https from 'https';
import { AIResponse } from './ollama';

export async function askOpenAI(
  question: string,
  systemPrompt: string,
  apiKey?: string,
  model = 'gpt-4o'
): Promise<AIResponse> {
  const resolvedKey = apiKey || process.env.OPENAI_API_KEY;
  if (!resolvedKey) throw new Error('No OpenAI API key configured. Add one in Settings → OpenAI.');
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: question }
    ]
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${resolvedKey}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message || 'OpenAI API error');
          const answer = json.choices?.[0]?.message?.content || 'No response from OpenAI';
          resolve({ answer, provider: 'openai', model: 'gpt-4o' });
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('OpenAI request timed out')); });
    req.write(body);
    req.end();
  });
}
