# stackbrief Architecture

## Overview

stackbrief is a CLI tool that scans any codebase and opens a local web dashboard showing full codebase intelligence. It gives AI tools like Claude Code and Cursor persistent context about a project so they never lose it between sessions.

## Structure

```
src/
  scanner/      File system traversal and stack detection
  analyzer/     Architecture, dependency, module, and convention analysis
  server/       Express server and REST API routes
  dashboard/    HTML, CSS, and JS for the local web dashboard
  mcp/          MCP server for Claude Code and Cursor integration
  ai/           Multi-provider AI chat: Ollama, Claude, OpenAI, and custom
  config/       Local configuration management (~/.stackbrief/config.json)
  cli.ts        Entry point and pipeline orchestration
  types.ts      Shared TypeScript interfaces
```

## Data flow

```
CLI starts
  → scanDirectory()     reads every source file recursively
  → detectStack()       inspects package.json and file patterns
  → analyzeArchitecture() infers MVC/Layered/Feature-based/etc.
  → analyzeModules()    groups files into logical modules
  → analyzeDependencies() parses deps, fetches latest versions from npm
  → analyzeConventions() detects naming, async, error handling patterns
  → startServer()       Express server on :3000 with REST API
  → startMCPServer()    MCP server on :3001 for AI tool integration
  → writeClaudeMd()     generates CLAUDE.md in the scanned project
  → open()              opens the dashboard in the browser
```

## Key design decisions

**Local first** — everything runs on the user's machine. No telemetry, no cloud, no accounts. Config and API keys stored in `~/.stackbrief/config.json`.

**Multi-provider AI** — works with Ollama (local, free), Claude, OpenAI, and any OpenAI-compatible provider (Groq, Mistral, LM Studio, etc.). Configured entirely through the dashboard UI — no environment variables required.

**Zero config** — sensible defaults for everything. The scan runs in the current directory by default. AI provider auto-detection picks the best available option.

**No bundler** — the dashboard is plain HTML, CSS, and JavaScript with no build step. D3.js is loaded from CDN. This keeps the package small and the dashboard fast to load.

## API routes

The Express server exposes:

```
GET  /api/analysis          Full AnalysisResult for the current project
GET  /api/modules           Module list
GET  /api/dependencies      Dependency list with versions
GET  /api/conventions       Detected conventions
GET  /api/architecture      Architecture result
GET  /api/versions          Latest npm versions for dependencies
POST /api/scan              Re-scan a different directory
GET  /api/config            Current config (API keys masked)
PUT  /api/config/provider/:name  Update a provider's settings
POST /api/config/provider/:name/test  Test provider connectivity
GET  /api/ai/status         Which AI provider is active
POST /api/chat              Ask a question about the codebase
GET  /api/ollama/check      Check if Ollama is installed and running
GET  /api/cwd               Current working directory
GET  /api/recents           Recently scanned projects
GET  /api/browse            Native folder picker (macOS, via osascript)
```

## MCP tools

The MCP server at `:3001` exposes four tools that AI coding tools can call:

- `get_codebase_context` — full structured context string
- `get_architecture`     — architecture pattern, framework, database, auth
- `get_conventions`      — naming, async, error handling, module system
- `get_modules`          — module list with descriptions

These are called automatically by Claude Code before each session when configured.
