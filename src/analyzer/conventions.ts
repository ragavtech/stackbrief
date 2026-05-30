import { ScanResult, ScannedFile } from '../scanner/index';

export interface ConventionsResult {
  namingStyle: string;
  asyncPattern: string;
  errorHandling: string;
  moduleSystem: string;
  validation: string;
  testingPattern: string;
  fileOrganization: string;
}

function detectNamingStyle(files: ScannedFile[]): string {
  const sourceFiles = files.filter(f =>
    ['.ts', '.tsx', '.js', '.jsx'].includes(f.ext) && !f.relativePath.includes('node_modules')
  );

  let camelCase = 0;
  let kebabCase = 0;
  let pascalCase = 0;
  let snakeCase = 0;

  for (const f of sourceFiles) {
    const base = f.relativePath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    if (/^[A-Z][a-zA-Z0-9]*$/.test(base)) pascalCase++;
    else if (/^[a-z][a-zA-Z0-9]*$/.test(base)) camelCase++;
    else if (/^[a-z][a-z0-9-]+$/.test(base)) kebabCase++;
    else if (/^[a-z][a-z0-9_]+$/.test(base)) snakeCase++;
  }

  const max = Math.max(camelCase, kebabCase, pascalCase, snakeCase);
  if (max === camelCase) return 'camelCase files';
  if (max === kebabCase) return 'kebab-case files';
  if (max === pascalCase) return 'PascalCase files';
  if (max === snakeCase) return 'snake_case files';
  return 'Mixed';
}

function detectAsyncPattern(files: ScannedFile[]): string {
  let asyncAwait = 0;
  let promises = 0;
  let callbacks = 0;

  for (const f of files.slice(0, 50)) {
    const c = f.content || '';
    const aaMatches = (c.match(/async\s+(function|\(|[a-zA-Z])/g) || []).length;
    const awaitMatches = (c.match(/\bawait\b/g) || []).length;
    const promiseMatches = (c.match(/new\s+Promise|\.then\(|\.catch\(/g) || []).length;
    const cbMatches = (c.match(/function\s*\([^)]*callback|,\s*(?:cb|callback|next|done)\s*\)/g) || []).length;

    asyncAwait += aaMatches + awaitMatches;
    promises += promiseMatches;
    callbacks += cbMatches;
  }

  const max = Math.max(asyncAwait, promises, callbacks);
  if (max === 0) return 'async/await';
  if (max === asyncAwait) return 'async/await';
  if (max === promises) return 'Promise chains';
  return 'Callbacks';
}

function detectErrorHandling(files: ScannedFile[]): string {
  let tryCatch = 0;
  let errorMiddleware = 0;
  let resultPattern = 0;

  for (const f of files.slice(0, 60)) {
    const c = f.content || '';
    tryCatch += (c.match(/try\s*\{/g) || []).length;
    errorMiddleware += (c.match(/\(err,\s*req,\s*res,\s*next\)|error\s+middleware|app\.use.*error/gi) || []).length;
    resultPattern += (c.match(/Result<|Either<|\{\s*error:|\.error\b/g) || []).length;
  }

  if (resultPattern > tryCatch * 0.5) return 'Result/Either pattern';
  if (errorMiddleware > 2) return 'Error middleware';
  if (tryCatch > 5) return 'try/catch blocks';
  return 'try/catch blocks';
}

function detectModuleSystem(files: ScannedFile[]): string {
  let esm = 0;
  let cjs = 0;

  for (const f of files.slice(0, 30)) {
    const c = f.content || '';
    esm += (c.match(/^import\s+|^export\s+/gm) || []).length;
    cjs += (c.match(/require\(|module\.exports|exports\./g) || []).length;
  }

  if (esm > cjs) return 'ES Modules (import/export)';
  if (cjs > esm) return 'CommonJS (require)';
  return 'ES Modules (import/export)';
}

function detectValidation(files: ScannedFile[], scan: ScanResult): string {
  const pkg = scan.packageJson;
  const deps = {
    ...(pkg?.dependencies as Record<string, string> || {}),
    ...(pkg?.devDependencies as Record<string, string> || {})
  };

  if ('zod' in deps) return 'Zod schemas';
  if ('joi' in deps) return 'Joi schemas';
  if ('yup' in deps) return 'Yup schemas';
  if ('class-validator' in deps) return 'class-validator decorators';
  if ('ajv' in deps) return 'JSON Schema (AJV)';

  for (const f of files.slice(0, 30)) {
    const c = f.content || '';
    if (c.includes('z.object') || c.includes('z.string')) return 'Zod schemas';
    if (c.includes('Joi.object') || c.includes('Joi.string')) return 'Joi schemas';
    if (c.includes('yup.object')) return 'Yup schemas';
  }

  return 'Manual validation';
}

function detectTestingPattern(files: ScannedFile[]): string {
  const testFiles = files.filter(f =>
    f.relativePath.includes('.test.') || f.relativePath.includes('.spec.') ||
    f.relativePath.includes('__tests__') ||
    f.relativePath.startsWith('test/') || f.relativePath.startsWith('tests/') ||
    f.relativePath.includes('/test/') || f.relativePath.includes('/tests/')
  );

  if (testFiles.length === 0) return 'No tests detected';

  let unitTests = 0;
  let integrationTests = 0;
  let e2eTests = 0;

  for (const f of testFiles) {
    const c = f.content || '';
    if (c.includes('supertest') || c.includes('request(app)')) integrationTests++;
    else if (c.includes('page.goto') || c.includes('cy.visit') || c.includes('browser.')) e2eTests++;
    else unitTests++;
  }

  const patterns = [];
  if (unitTests > 0) patterns.push('unit');
  if (integrationTests > 0) patterns.push('integration');
  if (e2eTests > 0) patterns.push('e2e');

  return patterns.length > 0 ? patterns.join(' + ') + ' tests' : 'Unit tests';
}

function detectFileOrganization(files: ScannedFile[]): string {
  const hasSrcDir = files.some(f => f.relativePath.startsWith('src/'));
  const hasAppDir = files.some(f => f.relativePath.startsWith('app/'));
  const hasLibDir = files.some(f => f.relativePath.startsWith('lib/'));
  const hasPages = files.some(f => f.relativePath.startsWith('pages/') || f.relativePath.startsWith('src/pages/'));
  const hasComponents = files.some(f => f.relativePath.includes('/components/'));
  const hasFeatures = files.some(f => f.relativePath.includes('/features/') || f.relativePath.includes('/modules/'));

  if (hasFeatures) return 'Feature modules';
  if (hasPages && hasComponents) return 'Pages + components';
  if (hasAppDir) return 'App directory';
  if (hasSrcDir) return 'src/ layout';
  if (hasLibDir) return 'lib/ layout';
  return 'Flat layout';
}

export function analyzeConventions(scan: ScanResult): ConventionsResult {
  return {
    namingStyle: detectNamingStyle(scan.files),
    asyncPattern: detectAsyncPattern(scan.files),
    errorHandling: detectErrorHandling(scan.files),
    moduleSystem: detectModuleSystem(scan.files),
    validation: detectValidation(scan.files, scan),
    testingPattern: detectTestingPattern(scan.files),
    fileOrganization: detectFileOrganization(scan.files)
  };
}
