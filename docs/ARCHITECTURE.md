# stackbrief — Architecture

## Overview

stackbrief is a Node.js CLI tool that scans a codebase, starts a local Express server, and opens a dashboard in the browser. It also runs an MCP server so AI coding tools can pull codebase context automatically.

```
npx stackbrief scan [path]
     │
     ├─ Scanner      reads every source file
     ├─ Analyzers    detect architecture, modules, deps, conventions
     ├─ CLI          writes CLAUDE.md, starts servers, opens browser
     ├─ Express      serves dashboard + REST API on :3000
     └─ MCP server   serves tool calls on :3001
```

## Source structure

```
src/
  cli.ts                  Entry point. Orchestrates scan → analyse → serve → open.
  types.ts                Shared TypeScript interfaces (AnalysisResult, etc.)

  scanner/
    index.ts              Walks the directory tree. Returns list of ScannedFile.
    detector.ts           Inspects package.json and file patterns to detect stack.

  analyzer/
    architecture.ts       Infers architecture pattern (MVC, Layered, Feature-based…)
    modules.ts            Groups files into logical modules with descriptions.
    dependencies.ts       Parses package.json deps, adds descriptions and status.
    conventions.ts        Detects naming style, async pattern, error handling, etc.

  ai/
    chat.ts               Builds system prompt and routes to the active provider.
    detector.ts           Auto-detects available provider (Ollama → Claude → OpenAI).
    providers/
      ollama.ts           HTTP calls to localhost:11434 (Ollama API).
      claude.ts           HTTPS calls to api.anthropic.com.
      openai.ts           HTTPS calls to api.openai.com.
      custom.ts           HTTPS/HTTP calls to any OpenAI-compatible endpoint.

  config/
    manager.ts            Reads and writes ~/.stackbrief/config.json.

  server/
    index.ts              Creates Express app, mounts static dashboard files.
    routes.ts             All REST API routes (/api/analysis, /api/chat, etc.)

  mcp/
    server.ts             Minimal MCP server (JSON-RPC over HTTP on :3001).

  dashboard/
    index.html            Single-page app. No framework. Plain HTML.
    styles.css            All styles. No preprocessor.
    app.js                All client-side JavaScript. One IIFE, no bundler.
```

## Data flow

1. `scanDirectory()` walks the file tree, returns `ScannedFile[]`
2. `detectStack()` reads package.json and file patterns → `DetectedStack`
3. Each analyzer takes `ScanResult + DetectedStack` → its result type
4. Results are merged into `AnalysisResult` and held in memory by the server
5. Dashboard fetches `/api/analysis` on load and renders all sections
6. `/api/chat` builds the system prompt from `AnalysisResult` and calls the AI provider
7. `/api/scan` re-runs the full pipeline on a new path without restarting the server

## Config file

`~/.stackbrief/config.json` stores AI provider settings and recent projects.
API keys are stored locally in plain text — this is a local developer tool.
The config is never sent anywhere.

## MCP server

The MCP server at `:3001` exposes four tools:
- `get_codebase_context` — full context string
- `get_architecture` — architecture object
- `get_conventions` — conventions object
- `get_modules` — modules list

Claude Code and Cursor connect to this server and call these tools before
each session to get project context without any manual explanation.
