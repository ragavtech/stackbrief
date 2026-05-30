import fs from 'fs';
import path from 'path';

export interface ScannedFile {
  path: string;
  relativePath: string;
  ext: string;
  size: number;
  content?: string;
}

export interface ScanResult {
  rootDir: string;
  files: ScannedFile[];
  totalFiles: number;
  packageJson?: Record<string, unknown>;
  packageLockJson?: Record<string, unknown>;
  hasYarnLock: boolean;
  hasPnpmLock: boolean;
  gitIgnorePatterns: string[];
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
  '.cache', 'coverage', '.nyc_output', 'out', '.turbo',
  '__pycache__', '.venv', 'venv', 'vendor', '.gradle',
  '.idea', '.vscode', 'tmp', 'temp', '.DS_Store'
]);

const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.cs', '.php', '.vue', '.svelte', '.astro',
  '.json', '.yaml', '.yml', '.toml', '.env',
  '.md', '.mdx', '.txt'
]);

const READ_CONTENT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.vue', '.svelte', '.astro', '.json', '.yaml', '.yml'
]);

const MAX_FILE_SIZE = 256 * 1024; // 256KB

function parseGitIgnore(rootDir: string): string[] {
  const gitIgnorePath = path.join(rootDir, '.gitignore');
  if (!fs.existsSync(gitIgnorePath)) return [];
  try {
    return fs.readFileSync(gitIgnorePath, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

function shouldSkipDir(name: string): boolean {
  if (SKIP_DIRS.has(name)) return true;
  // Allow .github so GitHub Actions CI detection works
  if (name === '.github') return false;
  return name.startsWith('.');
}

function walkDir(dir: string, rootDir: string, files: ScannedFile[], depth = 0): void {
  if (depth > 12) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        walkDir(path.join(dir, entry.name), rootDir, files, depth + 1);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!SCAN_EXTENSIONS.has(ext)) continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);

      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.size > MAX_FILE_SIZE) continue;

      const file: ScannedFile = {
        path: fullPath,
        relativePath,
        ext,
        size: stat.size
      };

      if (READ_CONTENT_EXTENSIONS.has(ext) && stat.size < 64 * 1024) {
        try {
          file.content = fs.readFileSync(fullPath, 'utf-8');
        } catch {
          // skip unreadable files
        }
      }

      files.push(file);
    }
  }
}

function tryReadJson(filePath: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

export function scanDirectory(rootDir: string): ScanResult {
  const absoluteRoot = path.resolve(rootDir);
  const files: ScannedFile[] = [];

  walkDir(absoluteRoot, absoluteRoot, files);

  const packageJson = tryReadJson(path.join(absoluteRoot, 'package.json'));
  const packageLockJson = tryReadJson(path.join(absoluteRoot, 'package-lock.json'));

  return {
    rootDir: absoluteRoot,
    files,
    totalFiles: files.length,
    packageJson,
    packageLockJson,
    hasYarnLock: fs.existsSync(path.join(absoluteRoot, 'yarn.lock')),
    hasPnpmLock: fs.existsSync(path.join(absoluteRoot, 'pnpm-lock.yaml')),
    gitIgnorePatterns: parseGitIgnore(absoluteRoot)
  };
}
