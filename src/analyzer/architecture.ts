import path from 'path';
import { ScanResult } from '../scanner/index';
import { DetectedStack } from '../scanner/detector';

export type ArchitecturePattern =
  | 'MVC'
  | 'Layered'
  | 'Feature-based'
  | 'Domain-Driven'
  | 'Monolithic'
  | 'Microservices'
  | 'Serverless'
  | 'Component-based'
  | 'Clean Architecture'
  | 'Unknown';

export interface ArchitectureResult {
  pattern: ArchitecturePattern;
  runtime: string;
  framework: string | null;
  database: string | null;
  orm: string | null;
  auth: string | null;
  cache: string | null;
  deployment: string | null;
  hasDocker: boolean;
  hasCI: boolean;
  isMonorepo: boolean;
  topLevelDirs: string[];
  entryPoints: string[];
}

function detectPattern(topDirs: string[], scan: ScanResult, stack: DetectedStack): ArchitecturePattern {
  const dirSet = new Set(topDirs.map(d => d.toLowerCase()));

  // Serverless hints
  if (scan.files.some(f => f.relativePath === 'serverless.yml' || f.relativePath === 'serverless.yaml')) {
    return 'Serverless';
  }
  if (dirSet.has('functions') || dirSet.has('lambdas') || dirSet.has('handlers')) {
    return 'Serverless';
  }

  // Microservices hints
  if (dirSet.has('services') && (dirSet.has('gateway') || dirSet.has('api-gateway'))) {
    return 'Microservices';
  }

  // Clean architecture
  if (dirSet.has('domain') && dirSet.has('application') && (dirSet.has('infrastructure') || dirSet.has('infra'))) {
    return 'Clean Architecture';
  }

  // DDD
  if (dirSet.has('domain') && (dirSet.has('repositories') || dirSet.has('entities') || dirSet.has('aggregates'))) {
    return 'Domain-Driven';
  }

  // MVC
  if (dirSet.has('controllers') || dirSet.has('controller')) {
    if (dirSet.has('models') || dirSet.has('model')) {
      return 'MVC';
    }
    return 'Layered';
  }

  // Layered
  if (
    (dirSet.has('routes') || dirSet.has('handlers')) &&
    (dirSet.has('services') || dirSet.has('service')) &&
    (dirSet.has('models') || dirSet.has('repositories') || dirSet.has('db'))
  ) {
    return 'Layered';
  }

  // Feature-based
  const featureDirs = topDirs.filter(d => {
    const lower = d.toLowerCase();
    return !['src', 'lib', 'app', 'dist', 'public', 'static', 'assets', 'test', 'tests', '__tests__', 'docs', 'scripts', 'config', 'types', 'utils', 'helpers', 'constants', 'middleware'].includes(lower);
  });
  if (featureDirs.length >= 3 && (dirSet.has('src') || dirSet.has('app'))) {
    return 'Feature-based';
  }

  // React/Vue/Angular = Component-based
  if (stack.framework && ['React', 'Vue.js', 'Angular', 'Svelte', 'SvelteKit', 'Astro'].includes(stack.framework)) {
    if (dirSet.has('components') || dirSet.has('pages') || dirSet.has('views')) {
      return 'Component-based';
    }
  }

  if (stack.framework === 'Express.js' || stack.framework === 'Fastify' || stack.framework === 'Koa') {
    return 'Layered';
  }

  return 'Monolithic';
}

function findEntryPoints(scan: ScanResult, stack: DetectedStack): string[] {
  const candidates = [
    'index.js', 'index.ts', 'main.js', 'main.ts',
    'app.js', 'app.ts', 'server.js', 'server.ts',
    'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js',
    'src/app.ts', 'src/app.js', 'src/server.ts', 'src/server.js'
  ];

  const pkg = scan.packageJson;
  if (pkg?.main && typeof pkg.main === 'string') {
    candidates.unshift(pkg.main);
  }

  return candidates.filter(c =>
    scan.files.some(f => f.relativePath === c || f.relativePath.replace(/\\/g, '/') === c)
  ).slice(0, 3);
}

/**
 * Infers the architectural pattern of the codebase by examining directory
 * structure and file patterns. Detects MVC, Layered, Feature-based,
 * Domain-Driven, Clean Architecture, Serverless, and Monolithic patterns.
 *
 * @param scan - Raw scan result with file list and package.json
 * @param stack - Already-detected stack information
 * @returns ArchitectureResult with pattern, framework, database, auth, etc.
 */
export function analyzeArchitecture(scan: ScanResult, stack: DetectedStack): ArchitectureResult {
  // Get immediate subdirectories of root and src/
  const dirSet = new Set<string>();

  for (const file of scan.files) {
    const parts = file.relativePath.split(path.sep).filter(Boolean);
    if (parts.length >= 2) {
      dirSet.add(parts[0]);
      if ((parts[0] === 'src' || parts[0] === 'app' || parts[0] === 'lib') && parts.length >= 3) {
        dirSet.add(parts[1]);
      }
    }
  }

  const topLevelDirs = Array.from(dirSet).filter(d =>
    !['node_modules', 'dist', 'build', '.git', '.next', '.nuxt'].includes(d)
  );

  const pattern = detectPattern(topLevelDirs, scan, stack);

  const dbLabel = stack.database
    ? (
        stack.database === 'pg' ? 'PostgreSQL' :
        stack.database === 'mysql' || stack.database === 'mysql2' ? 'MySQL' :
        stack.database === 'sqlite3' || stack.database === 'better-sqlite3' ? 'SQLite' :
        stack.database === 'mongodb' || stack.database === 'mongoose' ? 'MongoDB' :
        stack.database === 'redis' || stack.database === 'ioredis' ? 'Redis' :
        stack.database === '@prisma/client' ? 'Prisma (DB)' :
        stack.database
      )
    : null;

  const authLabel = stack.auth
    ? (
        stack.auth === 'passport' ? 'Passport.js' :
        stack.auth === 'jsonwebtoken' ? 'JWT' :
        stack.auth === 'next-auth' || stack.auth === '@auth/core' ? 'NextAuth' :
        stack.auth === '@clerk/nextjs' || stack.auth === 'clerk' ? 'Clerk' :
        stack.auth === '@supabase/supabase-js' || stack.auth === 'supabase' ? 'Supabase Auth' :
        stack.auth === '@auth0/nextjs-auth0' || stack.auth === 'auth0' ? 'Auth0' :
        stack.auth === 'lucia' ? 'Lucia' :
        stack.auth
      )
    : null;

  const cacheLabel = stack.cache
    ? (
        stack.cache === 'redis' || stack.cache === 'ioredis' ? 'Redis' :
        stack.cache === 'memcached' ? 'Memcached' :
        stack.cache
      )
    : null;

  return {
    pattern,
    runtime: stack.runtime,
    framework: stack.framework,
    database: dbLabel,
    orm: stack.orm,
    auth: authLabel,
    cache: cacheLabel,
    deployment: stack.deployment,
    hasDocker: stack.hasDocker,
    hasCI: stack.hasCI,
    isMonorepo: stack.monorepo,
    topLevelDirs,
    entryPoints: findEntryPoints(scan, stack)
  };
}
