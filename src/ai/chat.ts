import { AnalysisResult } from '../types';
import { detectProvider } from './detector';
import { askClaude } from './providers/claude';
import { askOpenAI } from './providers/openai';
import { askOllama, AIResponse } from './providers/ollama';
import { getProviderKey, getConfig } from '../config/manager';

export function buildSystemPrompt(analysis: AnalysisResult): string {
  const { architecture, dependencies, conventions, modules, stack, repoName } = analysis;

  const moduleList = modules.modules
    .slice(0, 12)
    .map(m => `  - ${m.path}: ${m.description} (${m.fileCount} files)`)
    .join('\n');

  const depList = dependencies.dependencies
    .filter(d => d.type === 'prod')
    .slice(0, 15)
    .map(d => `  - ${d.name}@${d.version}: ${d.description}`)
    .join('\n');

  return `You are a codebase assistant for ${repoName}.

CODEBASE CONTEXT:
Architecture: ${architecture.pattern}, Language: ${stack.language}, Runtime: ${stack.runtime}${architecture.database ? `, Database: ${architecture.database}` : ''}${architecture.auth ? `, Auth: ${architecture.auth}` : ''}

Modules:
${moduleList}

Key Dependencies:
${depList}

Coding Conventions:
- Naming: ${conventions.namingStyle}
- Async: ${conventions.asyncPattern}
- Error handling: ${conventions.errorHandling}
- Module system: ${conventions.moduleSystem}
- Validation: ${conventions.validation}

Answer questions about this codebase accurately and concisely based on the context above.
Keep answers focused and practical. Use plain text, no markdown.
If asked about something not in the context, say so honestly rather than guessing.`;
}

export interface ChatResult extends AIResponse {}

export async function chat(
  question: string,
  analysis: AnalysisResult,
  forceProvider?: string
): Promise<ChatResult> {
  const providerInfo = await detectProvider(forceProvider);

  if (!providerInfo.available || !providerInfo.provider) {
    const err = Object.assign(
      new Error('No AI provider available'),
      { setup: providerInfo.setup }
    );
    throw err;
  }

  const systemPrompt = buildSystemPrompt(analysis);

  const cfg = getConfig();
  switch (providerInfo.provider) {
    case 'claude':
      return askClaude(question, systemPrompt,
        getProviderKey('claude'),
        cfg.ai.providers.claude.model);
    case 'openai':
      return askOpenAI(question, systemPrompt,
        getProviderKey('openai'),
        cfg.ai.providers.openai.model);
    case 'ollama':
      return askOllama(question, systemPrompt, providerInfo.model ?? 'llama3');
    default:
      throw new Error(`Unknown provider: ${providerInfo.provider}`);
  }
}
