# Contributing to stackbrief

## Getting started

```bash
git clone https://github.com/ragavtech/stackbrief
cd stackbrief
npm install
npm run build
```

## Running locally

```bash
node dist/cli.js scan /path/to/any/project
```

The dashboard opens at `localhost:3000`. Edit `src/dashboard/` files and refresh — no rebuild needed for UI changes. TypeScript changes need `npm run build`.

## Making changes

- Fork the repo
- Create a feature branch
- Make your changes
- Test with `npx stackbrief scan` on a real project
- Open a pull request

## Structure

```
src/
  scanner/      file walking and stack detection
  analyzer/     architecture, modules, deps, conventions
  ai/           provider integrations (Ollama, Claude, OpenAI)
  config/       local config management
  server/       Express server and API routes
  mcp/          MCP server
  dashboard/    HTML, CSS, JS — no framework, no build step
  cli.ts        entry point
```

## Reporting bugs

Open an issue with steps to reproduce.

## Questions

Open an issue with your question.
