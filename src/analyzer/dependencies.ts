import { ScanResult } from '../scanner/index';
import semver from 'semver';

export interface Dependency {
  name: string;
  version: string;
  type: 'prod' | 'dev';
  status: 'stable' | 'needs-update' | 'unknown';
  description: string;
}

export interface DependenciesResult {
  total: number;
  prod: number;
  dev: number;
  dependencies: Dependency[];
  packageManager: string;
}

const KNOWN_DESCRIPTIONS: Record<string, string> = {
  'express': 'Fast, minimalist web framework',
  'react': 'UI component library',
  'react-dom': 'React DOM renderer',
  'next': 'Full-stack React framework',
  'vue': 'Progressive JS framework',
  'nuxt': 'Vue meta-framework',
  '@angular/core': 'TypeScript-based web framework',
  'svelte': 'Compile-time UI framework',
  '@sveltejs/kit': 'Svelte application framework',
  'typescript': 'Typed superset of JavaScript',
  'vite': 'Next-generation build tool',
  'webpack': 'Module bundler',
  'esbuild': 'Extremely fast JS bundler',
  'rollup': 'Module bundler for ES modules',
  'jest': 'JavaScript testing framework',
  'vitest': 'Vite-native test framework',
  'mocha': 'Test framework',
  'eslint': 'JavaScript linter',
  'prettier': 'Code formatter',
  'prisma': 'Next-gen ORM',
  '@prisma/client': 'Prisma query client',
  'mongoose': 'MongoDB object modeling',
  'sequelize': 'Multi-dialect ORM',
  'typeorm': 'ORM for TypeScript',
  'drizzle-orm': 'TypeScript ORM',
  'pg': 'PostgreSQL client',
  'mysql2': 'MySQL client',
  'sqlite3': 'SQLite3 bindings',
  'redis': 'Redis client',
  'ioredis': 'Redis client for Node.js',
  'axios': 'Promise-based HTTP client',
  'node-fetch': 'Lightweight fetch for Node.js',
  'lodash': 'Utility library',
  'date-fns': 'Date utility library',
  'dayjs': 'Lightweight date library',
  'zod': 'TypeScript-first schema validation',
  'joi': 'Object schema validation',
  'yup': 'Schema validation library',
  'dotenv': 'Environment variable loader',
  'cors': 'CORS middleware',
  'helmet': 'Security headers middleware',
  'morgan': 'HTTP request logger',
  'winston': 'Logging library',
  'pino': 'Fast JSON logger',
  'jsonwebtoken': 'JSON Web Token implementation',
  'bcrypt': 'Password hashing',
  'bcryptjs': 'Password hashing (pure JS)',
  'passport': 'Authentication middleware',
  'socket.io': 'Real-time bidirectional events',
  'ws': 'WebSocket library',
  'tailwindcss': 'Utility-first CSS framework',
  '@mui/material': 'Material Design components',
  'antd': 'Ant Design UI library',
  'chakra-ui': 'Component library',
  'zustand': 'Small state manager',
  'redux': 'Predictable state container',
  '@reduxjs/toolkit': 'Redux toolkit',
  'react-query': 'Data-fetching library',
  '@tanstack/react-query': 'Async state management',
  'trpc': 'End-to-end typesafe APIs',
  '@trpc/server': 'tRPC server',
  'graphql': 'GraphQL runtime',
  'apollo-server': 'GraphQL server',
  '@apollo/client': 'GraphQL client',
};

function describePackage(name: string): string {
  if (KNOWN_DESCRIPTIONS[name]) return KNOWN_DESCRIPTIONS[name];
  if (name.startsWith('@types/')) return `Type definitions for ${name.slice(7)}`;
  if (name.startsWith('@')) {
    const parts = name.slice(1).split('/');
    return `${parts[0]} / ${parts[1] || ''}`.trim();
  }
  return name.replace(/[-_]/g, ' ');
}

function versionStatus(version: string): 'stable' | 'needs-update' | 'unknown' {
  const cleaned = semver.coerce(version);
  if (!cleaned) return 'unknown';
  if (cleaned.major === 0) return 'needs-update';
  return 'stable';
}

export function analyzeDependencies(scan: ScanResult, packageManager: string): DependenciesResult {
  const pkg = scan.packageJson;
  if (!pkg) {
    return { total: 0, prod: 0, dev: 0, dependencies: [], packageManager };
  }

  const prodDeps = (pkg.dependencies as Record<string, string>) || {};
  const devDeps = (pkg.devDependencies as Record<string, string>) || {};

  const dependencies: Dependency[] = [];

  for (const [name, version] of Object.entries(prodDeps)) {
    dependencies.push({
      name,
      version: version.replace(/^\^|~/, ''),
      type: 'prod',
      status: versionStatus(version),
      description: describePackage(name)
    });
  }

  for (const [name, version] of Object.entries(devDeps)) {
    dependencies.push({
      name,
      version: version.replace(/^\^|~/, ''),
      type: 'dev',
      status: versionStatus(version),
      description: describePackage(name)
    });
  }

  dependencies.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'prod' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    total: dependencies.length,
    prod: Object.keys(prodDeps).length,
    dev: Object.keys(devDeps).length,
    dependencies,
    packageManager
  };
}
