import http from 'http';

export interface AIResponse {
  answer: string;
  provider: string;
  model: string;
}

function httpGet(url: string, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    await httpGet('http://localhost:11434/api/tags', 2000);
    return true;
  } catch {
    return false;
  }
}

export async function getOllamaModels(): Promise<string[]> {
  try {
    const raw = await httpGet('http://localhost:11434/api/tags', 2000);
    const json = JSON.parse(raw);
    return (json.models || []).map((m: { name: string }) => m.name as string);
  } catch {
    return [];
  }
}

export async function askOllama(
  question: string,
  systemPrompt: string,
  model = process.env.OLLAMA_MODEL || 'llama3'
): Promise<AIResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: question }
      ],
      stream: false
    });

    const req = http.request({
      hostname: 'localhost',
      port: 11434,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const answer = json.message?.content || json.response || 'No response from Ollama';
          resolve({ answer, provider: 'ollama', model });
        } catch {
          reject(new Error('Failed to parse Ollama response'));
        }
      });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new Error('Ollama is not running. Start it with: ollama serve'));
      } else {
        reject(err);
      }
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Ollama request timed out after 60s'));
    });

    req.write(body);
    req.end();
  });
}
