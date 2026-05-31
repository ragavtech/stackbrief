import { ScanResult, ScannedFile } from './index';

export interface DetectedStack {
  language: string;
  runtime: string;
  framework: string | null;
  packageManager: string;
  testFramework: string | null;
  linter: string | null;
  bundler: string | null;
  database: string | null;
  orm: string | null;
  cache: string | null;
  auth: string | null;
  deployment: string | null;
  monorepo: boolean;
  hasDocker: boolean;
  hasCI: boolean;
  // Quality signals
  hasReadme: boolean;
  hasContributing: boolean;
  hasLicense: boolean;
  hasGitignore: boolean;
  hasDocsFolder: boolean;
  hasClaudeMd: boolean;
  hasCursorRules: boolean;
}

function dep(pkg: Record<string, unknown> | undefined, name: string): boolean {
  if (!pkg) return false;
  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
  return name in deps;
}

function anyDep(pkg: Record<string, unknown> | undefined, names: string[]): string | null {
  if (!pkg) return null;
  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
  return names.find(n => n in deps) || null;
}

function hasFile(files: ScannedFile[], pattern: string): boolean {
  return files.some(f => f.relativePath === pattern || f.relativePath.endsWith('/' + pattern));
}

function hasFilePattern(files: ScannedFile[], test: (p: string) => boolean): boolean {
  return files.some(f => test(f.relativePath));
}

export function detectStack(scan: ScanResult): DetectedStack {
  const { packageJson, files } = scan;

  // Language detection
  const tsFiles = files.filter(f => f.ext === '.ts' || f.ext === '.tsx').length;
  const jsFiles = files.filter(f => f.ext === '.js' || f.ext === '.jsx' || f.ext === '.mjs').length;
  const pyFiles = files.filter(f => f.ext === '.py').length;
  const goFiles = files.filter(f => f.ext === '.go').length;
  const rbFiles = files.filter(f => f.ext === '.rb').length;
  const rsFiles = files.filter(f => f.ext === '.rs').length;
  const javaFiles = files.filter(f => f.ext === '.java').length;

  let language = 'JavaScript';
  let runtime = 'Node.js';

  if (tsFiles > jsFiles) language = 'TypeScript';
  if (pyFiles > tsFiles + jsFiles) { language = 'Python'; runtime = 'Python'; }
  if (goFiles > tsFiles + jsFiles) { language = 'Go'; runtime = 'Go'; }
  if (rbFiles > tsFiles + jsFiles) { language = 'Ruby'; runtime = 'Ruby'; }
  if (rsFiles > tsFiles + jsFiles) { language = 'Rust'; runtime = 'Rust'; }
  if (javaFiles > tsFiles + jsFiles) { language = 'Java'; runtime = 'JVM'; }

  // Framework detection
  let framework: string | null = null;
  if (packageJson) {
    if (dep(packageJson, 'next')) framework = 'Next.js';
    else if (dep(packageJson, 'nuxt') || dep(packageJson, 'nuxt3')) framework = 'Nuxt.js';
    else if (dep(packageJson, '@remix-run/node') || dep(packageJson, '@remix-run/react')) framework = 'Remix';
    else if (dep(packageJson, 'gatsby')) framework = 'Gatsby';
    else if (dep(packageJson, 'astro')) framework = 'Astro';
    else if (dep(packageJson, '@sveltejs/kit')) framework = 'SvelteKit';
    else if (dep(packageJson, 'svelte')) framework = 'Svelte';
    else if (dep(packageJson, '@angular/core')) framework = 'Angular';
    else if (dep(packageJson, 'react') && dep(packageJson, 'react-dom')) framework = 'React';
    else if (dep(packageJson, 'vue')) framework = 'Vue.js';
    else if (dep(packageJson, 'express')) framework = 'Express.js';
    else if (dep(packageJson, 'fastify')) framework = 'Fastify';
    else if (dep(packageJson, 'koa')) framework = 'Koa';
    else if (dep(packageJson, 'hapi') || dep(packageJson, '@hapi/hapi')) framework = 'Hapi';
    else if (dep(packageJson, 'nestjs') || dep(packageJson, '@nestjs/core')) framework = 'NestJS';
  }
  if (!framework) {
    if (hasFile(files, 'requirements.txt') || hasFile(files, 'setup.py')) {
      const reqContent = files.find(f => f.relativePath === 'requirements.txt')?.content || '';
      if (reqContent.includes('django')) framework = 'Django';
      else if (reqContent.includes('flask')) framework = 'Flask';
      else if (reqContent.includes('fastapi')) framework = 'FastAPI';
    }
    if (hasFile(files, 'Gemfile')) framework = 'Ruby on Rails';
    if (hasFilePattern(files, p => p === 'go.mod')) {
      const gomod = files.find(f => f.relativePath === 'go.mod')?.content || '';
      if (gomod.includes('gin-gonic')) framework = 'Gin';
      else if (gomod.includes('echo')) framework = 'Echo';
      else if (gomod.includes('fiber')) framework = 'Fiber';
    }
  }

  // Package manager
  let packageManager = 'npm';
  if (scan.hasYarnLock) packageManager = 'yarn';
  if (scan.hasPnpmLock) packageManager = 'pnpm';

  // Test framework
  const testFramework = anyDep(packageJson, ['jest', 'vitest', 'mocha', 'jasmine', 'ava', 'tap', 'playwright', 'cypress']);

  // Linter
  const linter = anyDep(packageJson, ['eslint', 'tslint', 'biome', 'oxlint', 'rome']);

  // Bundler
  const bundler = anyDep(packageJson, ['webpack', 'vite', 'esbuild', 'rollup', 'parcel', 'turbopack', 'rspack']);

  // Database
  const database = anyDep(packageJson, [
    'pg', 'mysql', 'mysql2', 'sqlite3', 'better-sqlite3',
    'mongodb', '@prisma/client', 'mongoose', 'sequelize',
    'redis', 'ioredis', 'knex', 'typeorm', 'drizzle-orm'
  ]);

  const orm = anyDep(packageJson, ['prisma', '@prisma/client', 'mongoose', 'sequelize', 'typeorm', 'drizzle-orm', 'knex']);

  const cache = anyDep(packageJson, ['redis', 'ioredis', 'memcached', 'keyv', 'cache-manager']);

  const auth = anyDep(packageJson, [
    'passport', 'jsonwebtoken', 'next-auth', '@auth/core',
    'clerk', '@clerk/nextjs', 'supabase', '@supabase/supabase-js',
    'firebase', 'auth0', '@auth0/nextjs-auth0', 'lucia'
  ]);

  const deployment = hasFile(files, 'vercel.json') ? 'Vercel'
    : hasFile(files, 'netlify.toml') ? 'Netlify'
    : hasFile(files, 'fly.toml') ? 'Fly.io'
    : hasFile(files, 'render.yaml') ? 'Render'
    : hasFile(files, 'railway.json') ? 'Railway'
    : hasFile(files, 'Procfile') ? 'Heroku'
    : null;

  const monorepo = hasFile(files, 'pnpm-workspace.yaml')
    || hasFile(files, 'lerna.json')
    || !!(packageJson?.workspaces)
    || hasFile(files, 'nx.json')
    || hasFile(files, 'turbo.json');

  const hasDocker = hasFile(files, 'Dockerfile') || hasFile(files, 'docker-compose.yml') || hasFile(files, 'docker-compose.yaml');

  const hasCI = hasFilePattern(files, p =>
    p.includes('.github/workflows') ||
    p.includes('.gitlab-ci') ||
    p === '.circleci/config.yml' ||
    p === '.travis.yml' ||
    p === 'Jenkinsfile'
  );

  // Quality signals — check root-level project health files
  const hasReadme = hasFilePattern(files, p =>
    p === 'README.md' || p === 'readme.md' || p === 'README' || p === 'Readme.md'
  );
  const hasContributing = hasFilePattern(files, p =>
    p === 'CONTRIBUTING.md' || p === 'contributing.md' || p === 'CONTRIBUTING'
  );
  const hasLicense = hasFilePattern(files, p =>
    p === 'LICENSE' || p === 'LICENSE.md' || p === 'license' || p === 'MIT-LICENSE'
  ) || (packageJson?.license as string | undefined)?.toLowerCase().includes('mit') || false;
  const hasGitignore = hasFilePattern(files, p => p === '.gitignore');
  const hasDocsFolder = hasFilePattern(files, p => p.startsWith('docs/'));
  const hasClaudeMd   = hasFilePattern(files, p => p === 'CLAUDE.md');
  const hasCursorRules = hasFilePattern(files, p => p === '.cursorrules' || p === '.cursorignore');

  return {
    language,
    runtime,
    framework,
    packageManager,
    testFramework,
    linter,
    bundler,
    database,
    orm,
    cache,
    auth,
    deployment,
    monorepo,
    hasDocker,
    hasCI,
    hasReadme,
    hasContributing,
    hasLicense,
    hasGitignore,
    hasDocsFolder,
    hasClaudeMd,
    hasCursorRules,
  };
}
