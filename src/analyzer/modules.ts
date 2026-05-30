import path from 'path';
import { ScanResult, ScannedFile } from '../scanner/index';

export interface Module {
  name: string;
  path: string;
  fileCount: number;
  description: string;
  primaryLanguage: string;
  moduleType: string | null;
  hasTests: boolean;
  hasTypes: boolean;
  hasIndex: boolean;
  keyFiles: string[]; // up to 6 representative file names
}

export interface ModulesResult {
  total: number;
  modules: Module[];
}

// Always expand into subdirectories for these top-level dirs
const ALWAYS_EXPAND = new Set([
  'src', 'lib', 'app', 'core', 'packages', 'services', 'api',
]);

// Directories we always skip
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.next', '.nuxt', '.cache',
  'coverage', 'out', 'public', 'assets', 'static', '.turbo',
]);

const DIR_DESCRIPTIONS: Record<string, string> = {
  src:             'Main source code',
  app:             'Application core',
  lib:             'Library source code',
  core:            'Core modules',
  components:      'Reusable UI components',
  pages:           'Page-level components and routes',
  views:           'View templates and layouts',
  routes:          'Route definitions and handlers',
  router:          'Router module',
  controllers:     'Request controllers',
  controller:      'Request controller',
  models:          'Data models and schemas',
  model:           'Data model',
  services:        'Business logic services',
  service:         'Service layer',
  middleware:      'HTTP middleware',
  utils:           'Utility functions',
  helpers:         'Helper functions',
  hooks:           'React hooks',
  store:           'State management',
  context:         'Context providers',
  api:             'API definitions and clients',
  config:          'Configuration',
  types:           'TypeScript type definitions',
  scripts:         'Build and utility scripts',
  test:            'Test suite',
  tests:           'Test suite',
  '__tests__':     'Jest test files',
  e2e:             'End-to-end tests',
  spec:            'Test specifications',
  db:              'Database access layer',
  database:        'Database access layer',
  migrations:      'Database migrations',
  seeds:           'Database seed data',
  prisma:          'Prisma ORM schema and migrations',
  graphql:         'GraphQL schema and resolvers',
  resolvers:       'GraphQL resolvers',
  schemas:         'Validation schemas',
  validators:      'Input validators',
  jobs:            'Background jobs',
  workers:         'Background workers',
  events:          'Event handlers',
  subscribers:     'Event subscribers',
  domain:          'Domain logic and entities',
  infrastructure:  'Infrastructure adapters',
  infra:           'Infrastructure adapters',
  repositories:    'Data repositories',
  entities:        'Domain entities',
  features:        'Feature modules',
  modules:         'Application modules',
  layouts:         'Layout components',
  auth:            'Authentication',
  analytics:       'Analytics',
  notifications:   'Notifications',
  email:           'Email handling',
  payments:        'Payment processing',
  uploads:         'File uploads',
  search:          'Search functionality',
  cache:           'Caching layer',
  queue:           'Message queue',
  socket:          'WebSocket handlers',
  bin:             'CLI entry points',
  cli:             'Command-line interface',
  plugins:         'Plugin system',
  adapters:        'External service adapters',
  providers:       'Service providers',
  decorators:      'TypeScript decorators',
  guards:          'Route guards',
  filters:         'Exception filters',
  pipes:           'Data transformation pipes',
  interceptors:    'Request/response interceptors',
  dto:             'Data Transfer Objects',
  constants:       'Application constants',
  examples:        'Example applications',
  demo:            'Demo code',
  docs:            'Documentation',
  packages:        'Monorepo packages',
};

const MODULE_TYPES: Record<string, string> = {
  controllers:    'controller',
  controller:     'controller',
  services:       'service',
  service:        'service',
  models:         'model',
  model:          'model',
  repositories:   'repository',
  middleware:     'middleware',
  routes:         'routes',
  router:         'router',
  utils:          'utility',
  helpers:        'utility',
  hooks:          'hook',
  components:     'component',
  pages:          'page',
  views:          'view',
  guards:         'guard',
  filters:        'filter',
  pipes:          'pipe',
  interceptors:   'interceptor',
  decorators:     'decorator',
  dto:            'dto',
  entities:       'entity',
  schemas:        'schema',
  validators:     'validator',
  resolvers:      'resolver',
  adapters:       'adapter',
  providers:      'provider',
  jobs:           'job',
  workers:        'worker',
  config:         'config',
  types:          'types',
};

function describeDir(name: string, files: ScannedFile[]): string {
  const lower = name.toLowerCase();
  if (DIR_DESCRIPTIONS[lower]) return DIR_DESCRIPTIONS[lower];

  // Infer from file content
  const hasComponents = files.some(f => f.ext === '.tsx' || f.ext === '.vue' || f.ext === '.svelte');
  const hasSchema = files.some(f => f.content?.includes('Schema') || f.content?.includes('Entity'));
  if (hasComponents) return 'UI components';
  if (hasSchema) return 'Data models';
  return name + ' module';
}

function getModuleType(name: string): string | null {
  return MODULE_TYPES[name.toLowerCase()] || null;
}

function getPrimaryLanguage(files: ScannedFile[]): string {
  let ts = 0, js = 0, py = 0, go = 0;
  for (const f of files) {
    if (f.ext === '.ts' || f.ext === '.tsx') ts++;
    else if (f.ext === '.js' || f.ext === '.jsx') js++;
    else if (f.ext === '.py') py++;
    else if (f.ext === '.go') go++;
  }
  const max = Math.max(ts, js, py, go);
  if (max === ts) return 'TypeScript';
  if (max === js) return 'JavaScript';
  if (max === py) return 'Python';
  if (max === go) return 'Go';
  return 'Unknown';
}

function hasIndexFile(files: ScannedFile[], dirPath: string): boolean {
  return files.some(f => {
    const base = path.basename(f.relativePath);
    const dir = path.dirname(f.relativePath);
    return dir === dirPath && (base === 'index.js' || base === 'index.ts' || base === 'index.mjs');
  });
}

const KEY_FILE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rb', '.rs', '.java', '.kt']);

function getKeyFiles(files: ScannedFile[], dirPath: string, max = 6): string[] {
  // Only direct children of this dir (not nested deeper)
  const depth = dirPath.split('/').length;
  const direct = files.filter(f => {
    const parts = f.relativePath.replace(/\\/g, '/').split('/');
    return parts.length === depth + 1 && KEY_FILE_EXTS.has(f.ext);
  });

  // Sort: index/main/app/server first, then alphabetically
  direct.sort((a, b) => {
    const aBase = path.basename(a.relativePath).toLowerCase();
    const bBase = path.basename(b.relativePath).toLowerCase();
    const aKey = /^(index|main|app|server)\.(ts|tsx|js|jsx|py|go)$/.test(aBase) ? 0 : 1;
    const bKey = /^(index|main|app|server)\.(ts|tsx|js|jsx|py|go)$/.test(bBase) ? 0 : 1;
    if (aKey !== bKey) return aKey - bKey;
    return aBase.localeCompare(bBase);
  });

  return direct.slice(0, max).map(f => path.basename(f.relativePath));
}

export function analyzeModules(scan: ScanResult): ModulesResult {
  // Collect files per directory, at up to 2 levels
  const dirFiles = new Map<string, ScannedFile[]>();

  for (const file of scan.files) {
    // normalise separator
    const rel = file.relativePath.replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    if (parts.length < 2) continue;

    const top = parts[0];
    if (SKIP_DIRS.has(top) || top.startsWith('.')) continue;

    // Always add top-level dir
    if (!dirFiles.has(top)) dirFiles.set(top, []);
    dirFiles.get(top)!.push(file);

    // Expand to depth-2 for ALWAYS_EXPAND dirs, OR any dir whose subdir name
    // is a known code directory
    if (parts.length >= 3) {
      const sub = parts[1];
      if (sub.startsWith('.')) continue;
      const subPath = top + '/' + sub;

      const shouldExpand =
        ALWAYS_EXPAND.has(top) ||
        MODULE_TYPES[sub.toLowerCase()] !== undefined ||
        DIR_DESCRIPTIONS[sub.toLowerCase()] !== undefined;

      if (shouldExpand) {
        if (!dirFiles.has(subPath)) dirFiles.set(subPath, []);
        dirFiles.get(subPath)!.push(file);
      }
    }
  }

  const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rb', '.rs']);

  const modules: Module[] = [];

  for (const [dirPath, files] of dirFiles) {
    const name = dirPath.split('/').pop() || dirPath;
    if (SKIP_DIRS.has(name)) continue;
    if (files.length === 0) continue;

    // Require at least 1 source file (or at least 3 files of any kind)
    const sourceCount = files.filter(f => SOURCE_EXTS.has(f.ext)).length;
    if (sourceCount === 0 && files.length < 3) continue;

    const isSubDir = dirPath.includes('/');

    modules.push({
      name: dirPath.split('/').pop() || dirPath,
      path: dirPath,
      fileCount: files.length,
      description: describeDir(name, files),
      primaryLanguage: getPrimaryLanguage(files),
      moduleType: getModuleType(name),
      hasTests: files.some(f =>
        f.relativePath.includes('.test.') ||
        f.relativePath.includes('.spec.') ||
        f.relativePath.includes('__tests__')
      ),
      hasTypes: files.some(f => f.ext === '.d.ts' || f.relativePath.includes('/types')),
      hasIndex: hasIndexFile(files, dirPath),
      keyFiles: getKeyFiles(files, dirPath),
    });
  }

  // Sort: subdirs of expanded dirs first within their parent, then by file count
  modules.sort((a, b) => {
    const aDepth = a.path.split('/').length;
    const bDepth = b.path.split('/').length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return b.fileCount - a.fileCount;
  });

  return {
    total: modules.length,
    modules: modules.slice(0, 24),
  };
}
