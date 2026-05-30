import http from 'http';
import { AnalysisResult } from '../types';

// Minimal MCP server implementing the Model Context Protocol
// Exposes codebase context as MCP tools for Claude Code and Cursor

interface MCPRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

function buildContextString(analysis: AnalysisResult): string {
  const { architecture, dependencies, conventions, modules, stack } = analysis;

  const lines: string[] = [
    `# ${analysis.repoName} — Codebase Context`,
    ``,
    `## Stack`,
    `- Language: ${stack.language}`,
    `- Runtime: ${stack.runtime}`,
    `- Framework: ${stack.framework || 'None detected'}`,
    `- Package Manager: ${stack.packageManager}`,
    ``,
    `## Architecture`,
    `- Pattern: ${architecture.pattern}`,
    architecture.database ? `- Database: ${architecture.database}` : '',
    architecture.orm ? `- ORM: ${architecture.orm}` : '',
    architecture.auth ? `- Auth: ${architecture.auth}` : '',
    architecture.cache ? `- Cache: ${architecture.cache}` : '',
    architecture.deployment ? `- Deployment: ${architecture.deployment}` : '',
    ``,
    `## Conventions`,
    `- Naming: ${conventions.namingStyle}`,
    `- Async: ${conventions.asyncPattern}`,
    `- Error handling: ${conventions.errorHandling}`,
    `- Module system: ${conventions.moduleSystem}`,
    `- Validation: ${conventions.validation}`,
    ``,
    `## Key Modules`,
    ...modules.modules.slice(0, 8).map(m => `- ${m.path}: ${m.description}`),
    ``,
    `## Dependencies (${dependencies.prod} prod, ${dependencies.dev} dev)`,
    ...dependencies.dependencies.filter(d => d.type === 'prod').slice(0, 10).map(d => `- ${d.name}@${d.version}: ${d.description}`),
  ].filter(l => l !== '');

  return lines.join('\n');
}

export function startMCPServer(analysis: AnalysisResult, port = 3001): Promise<void> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end('Method Not Allowed');
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let request: MCPRequest;
        try {
          request = JSON.parse(body);
        } catch {
          res.writeHead(400).end('Bad Request');
          return;
        }

        const response = handleMCPRequest(request, analysis);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      });
    });

    server.listen(port, () => {
      resolve();
    });

    server.on('error', () => {
      // MCP server failure is non-fatal
      resolve();
    });
  });
}

function handleMCPRequest(request: MCPRequest, analysis: AnalysisResult): MCPResponse {
  const base: Pick<MCPResponse, 'jsonrpc' | 'id'> = {
    jsonrpc: '2.0',
    id: request.id
  };

  switch (request.method) {
    case 'initialize':
      return {
        ...base,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'stackbrief', version: '1.0.0' }
        }
      };

    case 'tools/list':
      return {
        ...base,
        result: {
          tools: [
            {
              name: 'get_codebase_context',
              description: 'Get full codebase intelligence: architecture, stack, modules, conventions, and dependencies.',
              inputSchema: { type: 'object', properties: {}, required: [] }
            },
            {
              name: 'get_architecture',
              description: 'Get the architectural pattern, framework, database, auth, and infrastructure details.',
              inputSchema: { type: 'object', properties: {}, required: [] }
            },
            {
              name: 'get_conventions',
              description: 'Get coding conventions: naming style, async patterns, error handling, and module system.',
              inputSchema: { type: 'object', properties: {}, required: [] }
            },
            {
              name: 'get_modules',
              description: 'Get the list of modules and their descriptions.',
              inputSchema: { type: 'object', properties: {}, required: [] }
            }
          ]
        }
      };

    case 'tools/call': {
      const toolName = (request.params?.name as string) || '';

      if (toolName === 'get_codebase_context') {
        return { ...base, result: { content: [{ type: 'text', text: buildContextString(analysis) }] } };
      }

      if (toolName === 'get_architecture') {
        return { ...base, result: { content: [{ type: 'text', text: JSON.stringify(analysis.architecture, null, 2) }] } };
      }

      if (toolName === 'get_conventions') {
        return { ...base, result: { content: [{ type: 'text', text: JSON.stringify(analysis.conventions, null, 2) }] } };
      }

      if (toolName === 'get_modules') {
        return { ...base, result: { content: [{ type: 'text', text: JSON.stringify(analysis.modules, null, 2) }] } };
      }

      return { ...base, error: { code: -32601, message: `Unknown tool: ${toolName}` } };
    }

    default:
      return { ...base, error: { code: -32601, message: `Method not found: ${request.method}` } };
  }
}
