import { Router, Request, Response } from 'express';
import https from 'https';
import { exec } from 'child_process';
import { AnalysisResult } from '../types';
import { detectProvider } from '../ai/detector';
import { chat } from '../ai/chat';
import { getConfig, getMaskedConfig, updateProvider, setActiveProvider, markFirstRunComplete, getProviderKey } from '../config/manager';
import { isOllamaRunning, getOllamaModels, askOllama } from '../ai/providers/ollama';
import { askClaude } from '../ai/providers/claude';
import { askOpenAI } from '../ai/providers/openai';
import { scanDirectory } from '../scanner/index';
import { detectStack } from '../scanner/detector';
import { analyzeArchitecture } from '../analyzer/architecture';
import { analyzeDependencies } from '../analyzer/dependencies';
import { analyzeModules } from '../analyzer/modules';
import { analyzeConventions } from '../analyzer/conventions';
import path from 'path';
import fs from 'fs';

// In-memory version cache: packageName → latestVersion string
const versionCache = new Map<string, string>();
let versionsFetched = false;
let versionsFetching = false;

function fetchLatestVersion(packageName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
    const req = https.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.version || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function fetchAllVersions(analysis: AnalysisResult): Promise<void> {
  if (versionsFetching || versionsFetched) return;
  versionsFetching = true;

  const prodDeps = analysis.dependencies.dependencies
    .filter(d => d.type === 'prod')
    .map(d => d.name);

  // Fetch in batches of 8 to avoid hammering npm
  const BATCH = 8;
  for (let i = 0; i < prodDeps.length; i += BATCH) {
    const batch = prodDeps.slice(i, i + BATCH);
    await Promise.all(batch.map(async (name) => {
      if (versionCache.has(name)) return;
      const latest = await fetchLatestVersion(name);
      if (latest) versionCache.set(name, latest);
    }));
  }

  versionsFetched = true;
  versionsFetching = false;
}

// Recents storage
const RECENTS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.stackbrief',
  'recents.json'
);

function loadRecents(): Array<{ name: string; path: string }> {
  try {
    if (!fs.existsSync(RECENTS_PATH)) return [];
    return JSON.parse(fs.readFileSync(RECENTS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveRecent(dirPath: string): void {
  try {
    const dir = path.dirname(RECENTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let recents = loadRecents();
    const entry = { name: path.basename(dirPath), path: dirPath };
    recents = recents.filter(r => r.path !== dirPath);
    recents.unshift(entry);
    recents = recents.slice(0, 5);
    fs.writeFileSync(RECENTS_PATH, JSON.stringify(recents, null, 2));
  } catch {
    // Non-fatal
  }
}

export function createRoutes(analysisRef: { current: AnalysisResult }): Router {
  const router = Router();

  router.get('/analysis', (_req, res) => {
    res.json(analysisRef.current);
    // Kick off version fetching in background
    fetchAllVersions(analysisRef.current);
  });

  router.get('/architecture', (_req, res) => res.json(analysisRef.current.architecture));
  router.get('/dependencies', (_req, res) => res.json(analysisRef.current.dependencies));
  router.get('/modules',      (_req, res) => res.json(analysisRef.current.modules));
  router.get('/conventions',  (_req, res) => res.json(analysisRef.current.conventions));

  router.get('/meta', (_req, res) => {
    const a = analysisRef.current;
    res.json({
      repoName: a.repoName, rootDir: a.rootDir,
      scannedAt: a.scannedAt, totalFiles: a.totalFiles, stack: a.stack
    });
  });

  // npm latest versions
  router.get('/versions', async (_req, res) => {
    if (!versionsFetched) {
      // Start fetch if not started, return whatever we have so far
      fetchAllVersions(analysisRef.current);
    }
    const result: Record<string, string> = {};
    for (const [k, v] of versionCache.entries()) result[k] = v;
    res.json(result);
  });

  // Native macOS folder picker
  router.get('/browse', (req, res) => {
    if (process.platform !== 'darwin') {
      res.json({ path: null, cancelled: false, unsupported: true });
      return;
    }
    // Give user up to 5 minutes to choose
    req.socket.setTimeout(300000);
    const script = `osascript -e 'POSIX path of (choose folder with prompt "Select project to scan" without invisibles)'`;
    exec(script, { timeout: 300000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        res.json({ path: null, cancelled: true });
        return;
      }
      res.json({ path: stdout.trim() });
    });
  });

  // Recents
  router.get('/recents', (_req, res) => {
    res.json(loadRecents());
  });

  // Re-scan a directory
  router.post('/scan', async (req: Request, res: Response) => {
    const dirPath = req.body?.path;
    if (!dirPath || typeof dirPath !== 'string') {
      res.status(400).json({ error: 'path is required' });
      return;
    }

    const absolutePath = path.resolve(dirPath);
    if (!fs.existsSync(absolutePath)) {
      res.status(404).json({ error: 'Directory not found: ' + absolutePath });
      return;
    }

    try {
      const scan = scanDirectory(absolutePath);
      const stack = detectStack(scan);
      const architecture = analyzeArchitecture(scan, stack);
      const dependencies = analyzeDependencies(scan, stack.packageManager);
      const modules = analyzeModules(scan);
      const conventions = analyzeConventions(scan);

      const newAnalysis: AnalysisResult = {
        repoName: path.basename(absolutePath),
        rootDir: absolutePath,
        scannedAt: new Date().toISOString(),
        totalFiles: scan.totalFiles,
        stack,
        architecture,
        dependencies,
        modules,
        conventions,
      };

      // Update shared reference in-place
      analysisRef.current = newAnalysis;

      // Reset version cache for new project
      versionCache.clear();
      versionsFetched = false;
      versionsFetching = false;

      saveRecent(absolutePath);

      res.json(newAnalysis);

      // Kick off version fetch for new project
      fetchAllVersions(newAnalysis);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: msg });
    }
  });

  // ── AI chat ───────────────────────────────────────────────

  router.get('/ai/status', async (req, res) => {
    const forceProvider = (req.query.provider as string) || undefined;
    const info = await detectProvider(forceProvider);
    res.json({ available: info.available, provider: info.provider, model: info.model, setup: info.setup ?? null });
  });

  router.post('/chat', async (req: Request, res: Response) => {
    const { question, provider: forceProvider } = req.body as { question?: string; provider?: string };
    if (!question?.trim()) { res.status(400).json({ error: 'question is required' }); return; }
    try {
      const result = await chat(question.trim(), analysisRef.current, forceProvider);
      res.json(result);
    } catch (err: unknown) {
      const e = err as Error & { setup?: string };
      res.status(503).json({ error: e.message, setup: e.setup });
    }
  });

  // ── Config management ─────────────────────────────────────

  router.get('/config', (_req, res) => {
    const config = getConfig();
    res.json(getMaskedConfig(config));
  });

  router.put('/config/provider/:name', (req: Request, res: Response) => {
    const name = req.params.name as 'ollama' | 'claude' | 'openai';
    if (!['ollama', 'claude', 'openai'].includes(name)) {
      res.status(400).json({ error: 'Invalid provider' }); return;
    }
    try {
      updateProvider(name, req.body);
      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.get('/config/provider/active', async (_req, res) => {
    const info = await detectProvider();
    res.json(info);
  });

  router.put('/config/provider/active', (req: Request, res: Response) => {
    const { provider } = req.body as { provider?: string };
    if (!provider) { res.status(400).json({ error: 'provider required' }); return; }
    setActiveProvider(provider);
    res.json({ ok: true });
  });

  router.post('/config/provider/:name/test', async (req: Request, res: Response) => {
    const name = req.params.name as 'ollama' | 'claude' | 'openai';
    const start = Date.now();

    try {
      if (name === 'ollama') {
        const running = await isOllamaRunning();
        if (!running) { res.json({ success: false, error: 'Ollama is not running' }); return; }
        const models = await getOllamaModels();
        res.json({ success: true, latency: Date.now() - start, models });
        return;
      }

      const cfg = getConfig();
      const TEST_PROMPT = 'You are a test. Reply with only: OK';

      if (name === 'claude') {
        const key = getProviderKey('claude');
        if (!key) { res.json({ success: false, error: 'No API key configured' }); return; }
        await askClaude('test', TEST_PROMPT, key, 'claude-haiku-4-5');
        res.json({ success: true, latency: Date.now() - start });
        return;
      }

      if (name === 'openai') {
        const key = getProviderKey('openai');
        if (!key) { res.json({ success: false, error: 'No API key configured' }); return; }
        await askOpenAI('test', TEST_PROMPT, key, 'gpt-4o-mini');
        res.json({ success: true, latency: Date.now() - start });
        return;
      }

      res.status(400).json({ error: 'Unknown provider' });
    } catch (err: unknown) {
      res.json({ success: false, error: (err as Error).message, latency: Date.now() - start });
    }
  });

  router.put('/config/firstrun', (_req, res) => {
    markFirstRunComplete();
    res.json({ ok: true });
  });

  // ── Ollama helpers ────────────────────────────────────────

  router.get('/ollama/models', async (_req, res) => {
    const running = await isOllamaRunning();
    if (!running) { res.json({ running: false, models: [] }); return; }
    const models = await getOllamaModels();
    res.json({ running: true, models });
  });

  // Deep check: is Ollama installed AND is the server running?
  router.get('/ollama/check', async (_req, res) => {
    // Check 1 — is the Ollama binary on PATH?
    const cmd = process.platform === 'win32' ? 'where ollama' : 'which ollama';
    let installed = false;
    let ollamaPath = '';

    await new Promise<void>((resolve) => {
      exec(cmd, { timeout: 5000 }, (err, stdout) => {
        if (!err && stdout.trim()) {
          installed = true;
          ollamaPath = stdout.trim().split('\n')[0].trim();
        }
        resolve();
      });
    });

    // Check 2 — is the HTTP server answering?
    const running = await isOllamaRunning();
    const models  = running ? await getOllamaModels() : [];

    res.json({ installed, running, models, ollamaPath });
  });

  return router;
}
