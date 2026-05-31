(function () {
  'use strict';

  let analysisData = null;
  let currentDepFilter = 'all';
  let npmVersionsCache = null;

  // ─── Utilities ───────────────────────────────────────────

  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function highlight(text, query) {
    if (!query) return escHtml(text);
    const str = String(text);
    const idx = str.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escHtml(str);
    return escHtml(str.slice(0, idx)) +
      '<mark>' + escHtml(str.slice(idx, idx + query.length)) + '</mark>' +
      escHtml(str.slice(idx + query.length));
  }

  function semverGt(a, b) {
    const clean = v => String(v).replace(/[^0-9.]/g, '');
    const pa = clean(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = clean(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return true;
      if ((pa[i] || 0) < (pb[i] || 0)) return false;
    }
    return false;
  }

  function formatTime(iso) {
    try {
      const diffMin = Math.floor((Date.now() - new Date(iso)) / 60000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return diffMin + 'm ago';
      const h = Math.floor(diffMin / 60);
      return h < 24 ? h + 'h ago' : new Date(iso).toLocaleDateString();
    } catch { return ''; }
  }

  function truncate(str, len) {
    return str && str.length > len ? str.slice(0, len - 1) + '…' : (str || '');
  }

  // ─── Tooltip system ──────────────────────────────────────

  let _ttEl    = null; // single shared tooltip DOM node
  let _ttTimer = null;

  function getTooltipEl() {
    if (!_ttEl) {
      _ttEl = document.createElement('div');
      _ttEl.className = 'sb-tooltip';
      _ttEl.style.display = 'none';
      document.body.appendChild(_ttEl);
    }
    return _ttEl;
  }

  function positionTooltip(tt, anchor) {
    // Measure after making visible-but-transparent so we get real dimensions
    tt.style.visibility = 'hidden';
    tt.style.display    = 'block';

    const ar   = anchor.getBoundingClientRect();
    const tr   = tt.getBoundingClientRect();
    const GAP  = 8;

    let top   = ar.top - tr.height - GAP;
    let below = false;

    if (top < 6) {                         // flip below if too close to top
      top   = ar.bottom + GAP;
      below = true;
    }

    // Center horizontally on the anchor, clamp to viewport
    let left = ar.left + ar.width / 2 - tr.width / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));

    // Arrow should point at anchor center — compute offset from tooltip left
    const arrowX = Math.max(10, Math.min(
      ar.left + ar.width / 2 - left,
      tr.width - 10
    ));

    tt.style.top  = top + 'px';
    tt.style.left = left + 'px';
    tt.style.setProperty('--arrow-x', arrowX + 'px');
    tt.classList.toggle('sb-tooltip-below', below);
    tt.style.visibility = 'visible';
  }

  function initTooltips(root) {
    root = root || document;
    root.querySelectorAll('[data-tooltip]').forEach(el => {
      // Idempotent: remove old listeners before re-attaching
      if (el._ttHandlers) {
        el.removeEventListener('mouseenter', el._ttHandlers.enter);
        el.removeEventListener('mouseleave', el._ttHandlers.leave);
      }

      const enter = function () {
        const text = this.getAttribute('data-tooltip');
        if (!text) return;
        clearTimeout(_ttTimer);
        const self = this;
        _ttTimer = setTimeout(() => {
          const tt = getTooltipEl();
          tt.textContent = text;
          positionTooltip(tt, self);
        }, 400);
      };

      const leave = function () {
        clearTimeout(_ttTimer);
        const tt = getTooltipEl();
        tt.style.display = 'none';
      };

      el.addEventListener('mouseenter', enter);
      el.addEventListener('mouseleave', leave);
      el._ttHandlers = { enter, leave };
    });
  }

  // ─── Navigation ──────────────────────────────────────────

  function setupNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        activateSection(this.dataset.section);
      });
    });
  }

  function activateSection(name) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector('[data-section="' + name + '"]');
    if (navItem) navItem.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('section-' + name);
    if (target) target.classList.add('active');
    if (name === 'codemap' && analysisData && !window._codemapRendered) {
      renderCodeMap(analysisData);
      window._codemapRendered = true;
    }
    if (name === 'settings') {
      loadSettingsPage();
    } else {
      stopOllamaPolling();
    }
  }

  // ─── Keyboard shortcut: / focuses search ─────────────────

  function setupKeyboard() {
    document.addEventListener('keydown', function (e) {
      const tag = document.activeElement.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        activateSection('search');
        const input = document.getElementById('search-input');
        if (input) { input.focus(); input.select(); }
      }
      if (e.key === 'Escape') closeProjectDropdown();
    });
  }

  // ─── Render meta ─────────────────────────────────────────

  function renderMeta(meta) {
    const n = document.getElementById('repo-name');
    const p = document.getElementById('repo-path');
    const t = document.getElementById('scan-time');
    if (n) n.textContent = meta.repoName || '';
    if (p) p.textContent = meta.rootDir || '';
    if (t) t.textContent = 'Scanned ' + formatTime(meta.scannedAt);
    document.title = (meta.repoName || 'stackbrief') + ' — stackbrief';
  }

  // ─── Context health score ─────────────────────────────────

  function calculateScore(data) {
    const { stack, architecture, modules, dependencies, conventions } = data;
    let score = 40;

    // Foundations
    if (dependencies.total > 0)                              score += 8;  // has package.json
    if (data.totalFiles > 20)                                score += 5;

    // Tests
    if (stack.testFramework)                                 score += 7;
    if (conventions.testingPattern !== 'No tests detected')  score += 5;

    // Code quality
    if (stack.linter)                                        score += 5;
    if (stack.language === 'TypeScript')                     score += 8;

    // Architecture
    if (modules.total >= 3)                                  score += 4;
    if (modules.total >= 5)                                  score += 3;
    if (architecture.pattern && architecture.pattern !== 'Unknown') score += 3;

    // Infrastructure
    if (architecture.hasCI)                                  score += 7;
    if (stack.framework)                                     score += 3;

    // Quality signals (from stack detector)
    if (stack.hasReadme)                                     score += 4;
    if (stack.hasContributing)                               score += 3;
    if (stack.hasLicense)                                    score += 2;
    if (stack.hasGitignore)                                  score += 2;
    if (stack.hasDocsFolder)                                 score += 4;
    if (stack.hasClaudeMd || stack.hasCursorRules)           score += 5;
    if (stack.hasMcpServer)                                  score += 5;
    if (stack.hasPackageDescription)                         score += 3;

    return Math.min(100, Math.max(0, score));
  }

  // ─── Render metrics ───────────────────────────────────────

  function renderMetrics(data) {
    const m = document.getElementById('metric-modules');
    const d = document.getElementById('metric-deps');
    const f = document.getElementById('metric-files');
    const s = document.getElementById('metric-score');
    const sd = document.getElementById('metric-score-desc');

    if (m) m.textContent = (data.modules && data.modules.total) || '0';
    if (d) d.textContent = (data.dependencies && data.dependencies.total) || '0';
    if (f) f.textContent = data.totalFiles || '0';

    if (s) {
      const score = calculateScore(data);
      s.textContent = score;
      s.className = 'metric-value ' + (score >= 80 ? 'metric-value-good' : score >= 60 ? 'metric-value-warn' : 'metric-value-poor');
      if (sd) sd.textContent =
        score >= 94 ? 'Exceptional, fully AI ready' :
        score >= 85 ? 'Strong codebase, AI ready' :
        score >= 75 ? 'Good foundation, minor gaps' :
        score >= 65 ? 'Needs some improvement' :
        'Significant gaps detected';
    }
  }

  // ─── Render architecture ──────────────────────────────────

  function renderArchitecture(arch, stack) {
    const grid = document.getElementById('arch-grid');
    if (!grid) return;

    const items = [
      { label: 'pattern',   value: arch.pattern              },
      { label: 'language',  value: stack.language            },
      { label: 'runtime',   value: arch.runtime || stack.runtime },
      { label: 'framework', value: arch.framework            },
      { label: 'database',  value: arch.database             },
      { label: 'orm',       value: arch.orm                  },
      { label: 'auth',      value: arch.auth                 },
      { label: 'cache',     value: arch.cache                },
    ].filter(item => item.value);

    grid.innerHTML = items.map(item => `
      <div class="arch-item">
        <div class="arch-label">${item.label}</div>
        <div class="arch-value">${escHtml(item.value)}</div>
      </div>
    `).join('');
  }

  // ─── Render modules grid (Overview) ───────────────────────

  // Build a grouped structure: topLevel modules each with their children array
  function groupModules(items) {
    const topLevel = items.filter(m => !m.path.includes('/'));
    const childItems = items.filter(m => m.path.includes('/'));
    return topLevel.map(parent => ({
      parent,
      children: childItems.filter(c => c.path.startsWith(parent.path + '/'))
    }));
  }

  // ─── Render modules grid — Overview (card tiles with inline children) ──

  function renderModulesGrid(modules) {
    const grid = document.getElementById('modules-grid-overview');
    const countEl = document.getElementById('modules-count-overview');
    if (!grid) return;

    const list = (modules && modules.modules) || [];
    if (countEl) countEl.textContent = list.length + ' total';

    const groups = groupModules(list.slice(0, 16));

    // Reset to CSS grid (each group is one card tile in the grid)
    grid.style.display = '';

    grid.innerHTML = groups.map(({ parent, children }) => {
      const name = parent.path.split('/').pop() || parent.path;

      const childrenSection = children.length ? `
        <div class="module-tile-children">
          ${children.map(child => {
            const childName = child.path.split('/').pop();
            return `
              <div class="module-tile-child-row">
                <span class="module-tile-child-name">${escHtml(childName)}</span>
                <span class="module-tile-child-count">${child.fileCount} file${child.fileCount !== 1 ? 's' : ''}</span>
              </div>
            `;
          }).join('')}
        </div>
      ` : '';

      const badges = [
        parent.moduleType ? `<span class="tag tag-type">${escHtml(parent.moduleType)}</span>` : '',
        parent.hasTests   ? `<span class="tag tag-muted">tests</span>` : '',
        parent.primaryLanguage && parent.primaryLanguage !== 'Unknown'
          ? `<span class="tag tag-muted">${escHtml(parent.primaryLanguage)}</span>` : '',
      ].filter(Boolean).join('');

      return `
        <div class="module-tile${children.length ? ' module-tile-has-children' : ''}">
          <div class="module-tile-top">
            <div class="module-tile-name">${escHtml(name)}</div>
            <div class="module-tile-desc">${escHtml(parent.description)}</div>
          </div>
          ${childrenSection}
          <div class="module-tile-footer">
            <span class="module-file-count">${parent.fileCount} file${parent.fileCount !== 1 ? 's' : ''}</span>
            ${badges}
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── Render modules list — full section (indented children, richer detail) ──

  // Enhanced module descriptions for common folder names
  const MODULE_DESC_ENHANCED = {
    'test':          'Contains unit and integration tests for the project',
    'tests':         'Contains unit and integration tests for the project',
    '__tests__':     'Contains unit and integration tests for the project',
    'spec':          'Contains test specifications',
    'examples':      'Sample apps demonstrating how to use this library',
    'example':       'Sample app demonstrating how to use this library',
    'lib':           'Core library source code and utilities',
    'src':           'Main application source code',
    'app':           'Main application source code',
    'api':           'API route handlers and middleware',
    'components':    'Reusable UI components',
    'pages':         'Page-level components and routes',
    'routes':        'Route definitions and handlers',
    'router':        'Request routing logic',
    'controllers':   'Request controllers and handlers',
    'models':        'Data models and schema definitions',
    'services':      'Business logic and service layer',
    'middleware':    'Express and HTTP middleware',
    'utils':         'Utility functions and shared helpers',
    'helpers':       'Helper functions and shared utilities',
    'hooks':         'Custom React hooks',
    'store':         'State management',
    'config':        'Configuration and environment settings',
    'scripts':       'Build scripts and automation tools',
    'types':         'TypeScript type definitions',
    'styles':        'CSS stylesheets and design tokens',
    'migrations':    'Database schema migrations',
    'seeds':         'Database seed data',
    'auth':          'Authentication and authorisation logic',
    'db':            'Database access and query layer',
    // stackbrief-specific and common infrastructure folders
    'mcp':           'MCP server for AI tool integration',
    'ai':            'AI provider integrations',
    'scanner':       'Codebase scanning and file traversal',
    'analyzer':      'Code analysis and pattern detection',
    'dashboard':     'Dashboard UI files (HTML, CSS, JS)',
    'server':        'Express server setup and API routes',
    'domain':        'Core domain logic and business rules',
    'repositories':  'Data access repositories',
    'dto':           'Data Transfer Objects',
    'entities':      'Domain entities and data structures',
    'features':      'Feature modules and domain areas',
    'modules':       'Application modules',
  };

  function getEnhancedModuleDesc(m) {
    const name = (m.path.split('/').pop() || '').toLowerCase();
    return MODULE_DESC_ENHANCED[name] || m.description;
  }

  function renderModulesList(modules) {
    const list = document.getElementById('modules-list');
    const countEl = document.getElementById('modules-count');
    if (!list) return;

    const items = (modules && modules.modules) || [];
    if (countEl) countEl.textContent = items.length + ' total';

    const groups = groupModules(items);

    const rows = [];
    groups.forEach(({ parent, children }) => {
      rows.push({ ...parent, isChild: false });
      children.forEach(c => rows.push({ ...c, isChild: true, parentPath: parent.path }));
    });
    items.filter(m => m.path.includes('/') && !rows.find(r => r.path === m.path))
      .forEach(c => rows.push({ ...c, isChild: true }));

    list.innerHTML = rows.map(m => {
      const fileLabel = m.fileCount + ' file' + (m.fileCount !== 1 ? 's' : '');
      const desc = getEnhancedModuleDesc(m);
      const desc2 = m.description;

      // Language badge only for non-JS projects (JS is default, no noise)
      const langBadge = (m.primaryLanguage && m.primaryLanguage !== 'Unknown' && m.primaryLanguage !== 'JavaScript')
        ? `<span class="tag tag-muted">${escHtml(m.primaryLanguage)}</span>` : '';

      const typeBadge = m.moduleType ? `<span class="tag tag-type">${escHtml(m.moduleType)}</span>` : '';

      if (m.isChild) {
        const childName = m.path.split('/').pop();
        const parentPrefix = m.parentPath ? m.parentPath + '/' : '';
        return `
          <div class="module-row module-row-child">
            <div class="module-row-path module-row-path-child">
              <span class="module-parent-prefix">${escHtml(parentPrefix)}</span>${escHtml(childName)}
            </div>
            <div class="module-row-desc">${escHtml(desc)}</div>
            <div class="module-row-right">
              <span class="module-row-count" style="color:var(--text-primary);font-weight:500"
                data-tooltip="Total files detected in this module">${escHtml(fileLabel)}</span>
              ${typeBadge}${langBadge}
            </div>
          </div>
        `;
      }

      return `
        <div class="module-row">
          <div class="module-row-path">${escHtml(m.path)}</div>
          <div class="module-row-desc">${escHtml(desc)}</div>
          <div class="module-row-right">
            <span class="module-row-count" style="color:var(--text-primary);font-weight:500">${escHtml(fileLabel)}</span>
            ${typeBadge}${langBadge}
          </div>
        </div>
      `;
    }).join('');
  }

  // Client-side package descriptions (override server description for common packages)
  const PKG_DESC = {
    'accepts':            'Parses HTTP Accept headers',
    'body-parser':        'Parses HTTP request bodies',
    'content-disposition':'Sets Content-Disposition headers',
    'content-type':       'Parses and formats Content-Type headers',
    'cookie':             'HTTP cookie parsing and serialisation',
    'cookie-signature':   'Signs and verifies cookies',
    'debug':              'Tiny debugging utility for Node.js',
    'depd':               'Deprecation warnings helper',
    'encodeurl':          'Encodes URLs while preserving path separators',
    'escape-html':        'Escapes HTML special characters',
    'etag':               'Generates HTTP ETags for caching',
    'finalhandler':       'Final HTTP request handler for Express',
    'fresh':              'Checks if HTTP response is still fresh',
    'http-errors':        'Creates HTTP error objects',
    'merge-descriptors':  'Merges JavaScript object descriptors',
    'mime-types':         'Maps file extensions to MIME types',
    'on-finished':        'Executes callback when HTTP request finishes',
    'parseurl':           'Parses URL with caching for Express',
    'proxy-addr':         'Determines real client address behind proxy',
    'qs':                 'Parses and stringifies query strings',
    'range-parser':       'Parses HTTP Range headers for partial content',
    'router':             'URL router middleware',
    'send':               'Streams files as HTTP responses',
    'serve-static':       'Serves static files',
    'setprototypeof':     'Sets prototype of an object',
    'statuses':           'HTTP status code list',
    'toidentifier':       'Converts a string to a valid identifier',
    'type-is':            'Infers content-type of request bodies',
    'utils-merge':        'Merges two objects together',
    'vary':               'Sets the HTTP Vary header',
    'express':            'Web framework for Node.js',
    'fastify':            'Fast and efficient web framework',
    'koa':                'Minimalist web framework by Express team',
    'axios':              'HTTP client for browser and Node.js',
    'dotenv':             'Loads environment variables from .env file',
    'cors':               'Cross-origin resource sharing middleware',
    'morgan':             'HTTP request logger middleware',
    'helmet':             'Secures Express apps with HTTP headers',
    'lodash':             'JavaScript utility function library',
    'moment':             'Date and time parsing and formatting',
    'date-fns':           'Modern JavaScript date utility library',
    'dayjs':              'Lightweight date library with Moment.js API',
    'uuid':               'Generates RFC-compliant UUIDs',
    'joi':                'Schema description and data validation',
    'zod':                'TypeScript-first schema validation',
    'yup':                'JavaScript schema validation library',
    'bcrypt':             'Hashes passwords using bcrypt algorithm',
    'bcryptjs':           'Pure JavaScript bcrypt password hashing',
    'jsonwebtoken':       'Signs and verifies JSON Web Tokens',
    'passport':           'Authentication middleware for Node.js',
    'mongoose':           'MongoDB object modelling for Node.js',
    'sequelize':          'Promise-based Node.js ORM',
    'typeorm':            'ORM for TypeScript and JavaScript',
    'prisma':             'Next-generation Node.js and TypeScript ORM',
    '@prisma/client':     'Auto-generated Prisma database client',
    'pg':                 'PostgreSQL client for Node.js',
    'mysql2':             'MySQL client with Promise support',
    'redis':              'Redis client for Node.js',
    'ioredis':            'Robust Redis client for Node.js',
    'socket.io':          'Real-time bidirectional event-based communication',
    'ws':                 'Simple WebSocket client and server',
    'webpack':            'Static module bundler for JavaScript',
    'vite':               'Next-generation frontend build tool',
    'esbuild':            'Extremely fast JavaScript bundler',
    'rollup':             'Module bundler for ES modules',
    'jest':               'JavaScript testing framework by Meta',
    'vitest':             'Vite-native unit testing framework',
    'mocha':              'Feature-rich JavaScript test framework',
    'eslint':             'Pluggable JavaScript linter',
    'prettier':           'Opinionated code formatter',
    'typescript':         'Typed superset of JavaScript',
    'ts-node':            'TypeScript execution engine for Node.js',
    'nodemon':            'Auto-restarts server on file changes',
    'react':              'Library for building user interfaces',
    'react-dom':          'React DOM rendering',
    'next':               'React framework for production',
    'vue':                'Progressive JavaScript UI framework',
    '@angular/core':      'Angular framework core',
    'svelte':             'Compile-time UI framework',
    'open':               'Opens URLs in the default browser',
    'compression':        'Gzip response compression middleware',
    'multer':             'Multipart form-data and file upload handling',
    'socket.io':          'Real-time bidirectional event communication',
    'tailwindcss':        'Utility-first CSS framework',
    'vite':               'Fast frontend build tool and dev server',
    'webpack':            'JavaScript and asset module bundler',
    'chalk':              'Terminal output string styling',
    'commander':          'Command-line argument parsing framework',
    'express-rate-limit': 'Rate limiting middleware for Express',
    'glob':               'File pattern matching utility',
    'semver':             'Semantic versioning parser and comparator',
    'ws':                 'Fast WebSocket client and server library',
    'chokidar':           'Cross-platform file watching library',
  };

  function getPackageDesc(d) {
    return PKG_DESC[d.name] || (d.description && d.description !== d.name ? d.description : '');
  }

  // ─── Render dependencies ──────────────────────────────────

  function renderDependencies(deps, versions) {
    const list = document.getElementById('deps-list');
    if (!list) return;

    const items = (deps && deps.dependencies) || [];

    list.innerHTML = items.map(d => {
      const latest     = versions && versions[d.name];
      const hasUpdate  = latest && semverGt(latest, d.version) && d.type === 'prod';
      const pkgDesc    = getPackageDesc(d);
      const typeLabel  = d.type === 'prod' ? 'Production dependency' : 'Development only';

      // Version column: plain when up to date, amber arrow when update available
      const versionCol = hasUpdate
        ? `<div class="dep-version-col"><span>${escHtml(d.version)}</span><span class="dep-update-arrow"> → </span><span class="dep-latest">${escHtml(latest)}</span></div>`
        : `<div class="dep-version-col">${escHtml(d.version)}</div>`;

      // Right: "Update available" only when needed; no badge for stable
      const updateLabel = hasUpdate
        ? `<span class="dep-update-label" data-tooltip="A newer version is available on npm."
            >Update available</span>` : '';

      return `
        <div class="dep-row" data-type="${d.type}">
          <div class="dep-left">
            <div class="dep-package-name">${escHtml(d.name)}</div>
            ${pkgDesc ? `<div class="dep-package-desc">${escHtml(pkgDesc)}</div>` : ''}
          </div>
          ${versionCol}
          <div class="dep-meta">
            ${updateLabel}
            <span class="dep-type-label">${typeLabel}</span>
          </div>
        </div>
      `;
    }).join('');

    document.querySelectorAll('.dep-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.dep-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentDepFilter = this.dataset.type;
        filterDeps(currentDepFilter);
      });
    });
  }

  function filterDeps(type) {
    document.querySelectorAll('.dep-row').forEach(row => {
      row.style.display = (type === 'all' || row.dataset.type === type) ? '' : 'none';
    });
  }

  // ─── npm version fetch ────────────────────────────────────

  async function fetchNpmVersions() {
    if (npmVersionsCache) return npmVersionsCache;
    try {
      const res = await fetch('/api/versions');
      if (!res.ok) throw new Error();
      npmVersionsCache = await res.json();
      return npmVersionsCache;
    } catch { return {}; }
  }

  // Convention context notes: what each detected value means for AI tools
  function getConventionNote(label, value) {
    const v = (value || '').toLowerCase();
    if (label === 'naming style') {
      if (v.includes('camelcase'))  return 'AI tools will use camelCase when writing new code for this project';
      if (v.includes('snake_case')) return 'AI tools will use snake_case when writing new code for this project';
      if (v.includes('kebab'))      return 'AI tools will use kebab-case when writing new code for this project';
      if (v.includes('pascalcase')) return 'AI tools will use PascalCase when writing new code for this project';
    }
    if (label === 'async pattern') {
      if (v.includes('callback'))   return 'Pre-Promise style. AI tools will write callback-based async code';
      if (v.includes('async'))      return 'Modern async style. AI tools will use async/await in new code';
      if (v.includes('promise'))    return 'Promise-based async. AI tools will use .then().catch() patterns';
    }
    if (label === 'error handling') {
      if (v.includes('result') || v.includes('either')) return 'Functional error handling pattern detected';
      if (v.includes('try'))        return 'Standard try/catch error handling. AI tools will follow this pattern';
      if (v.includes('middleware')) return 'Express error middleware pattern. AI tools will add error handlers';
    }
    if (label === 'module system') {
      if (v.includes('commonjs') || v.includes('require')) return 'Uses require() and module.exports. AI tools will use CommonJS imports';
      if (v.includes('esm') || v.includes('import'))       return 'Uses import/export syntax. AI tools will use ES module imports';
    }
    if (label === 'validation') {
      if (v.includes('manual'))  return 'No validation library detected. AI tools will write manual validation code';
      if (v.includes('zod'))     return 'Zod validation detected. AI tools will use Zod schemas';
      if (v.includes('joi'))     return 'Joi validation detected. AI tools will use Joi schemas';
      if (v.includes('yup'))     return 'Yup validation detected. AI tools will use Yup schemas';
    }
    if (label === 'testing') {
      if (v.includes('unit') && v.includes('integration')) return 'Has both unit and integration tests. AI tools will suggest test files alongside new code';
      if (v.includes('unit'))  return 'Unit test suite detected. AI tools will suggest unit tests for new code';
      if (v.includes('no test')) return 'No tests found. Consider adding tests before asking AI to extend your codebase';
    }
    return '';
  }

  // ─── Render conventions ───────────────────────────────────

  function renderConventions(conventions) {
    const grid = document.getElementById('conventions-grid');
    if (!grid) return;

    const items = [
      { label: 'naming style',   value: conventions.namingStyle      },
      { label: 'async pattern',  value: conventions.asyncPattern     },
      { label: 'error handling', value: conventions.errorHandling    },
      { label: 'module system',  value: conventions.moduleSystem     },
      { label: 'validation',     value: conventions.validation       },
      { label: 'testing',        value: conventions.testingPattern   },
      { label: 'file layout',    value: conventions.fileOrganization },
    ];

    const colCount = items.length <= 4 ? 2 : items.length <= 6 ? 3 : 4;
    grid.style.gridTemplateColumns = `repeat(${colCount}, 1fr)`;

    grid.innerHTML = items.map(item => {
      const note = getConventionNote(item.label, item.value);
      const noteHtml = note
        ? `<div class="convention-context">${escHtml(note)}</div>` : '';
      return `
        <div class="convention-item">
          <div class="convention-label">${item.label}</div>
          <div class="convention-value">${escHtml(item.value || '—')}</div>
          ${noteHtml}
        </div>
      `;
    }).join('');
  }

  // ─── Search ───────────────────────────────────────────────

  function setupSearch(data) {
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    if (!input || !results) return;

    const corpus = { modules: [], dependencies: [], conventions: [] };

    ((data.modules && data.modules.modules) || []).forEach(m => {
      corpus.modules.push({ title: m.path, subtitle: m.description });
    });

    ((data.dependencies && data.dependencies.dependencies) || []).forEach(d => {
      corpus.dependencies.push({ title: d.name, subtitle: d.version + ' — ' + d.description });
    });

    if (data.conventions) {
      Object.entries(data.conventions).forEach(([key, val]) => {
        corpus.conventions.push({
          title: key.replace(/([A-Z])/g, ' $1').toLowerCase().trim(),
          subtitle: String(val)
        });
      });
    }

    function doSearch(q) {
      if (!q) { results.innerHTML = ''; return; }
      const ql = q.toLowerCase();
      const html = [];

      Object.entries(corpus).forEach(([category, items]) => {
        const matches = items.filter(item =>
          item.title.toLowerCase().includes(ql) || item.subtitle.toLowerCase().includes(ql)
        );
        if (!matches.length) return;
        html.push(`<div class="search-group-label">${category}</div>`);
        matches.slice(0, 8).forEach(item => {
          html.push(`
            <div class="search-result-item">
              <div class="search-result-title">${highlight(item.title, q)}</div>
              <div class="search-result-subtitle">${highlight(item.subtitle, q)}</div>
            </div>
          `);
        });
      });

      results.innerHTML = html.length
        ? html.join('')
        : `<div class="search-empty">No results for "<strong>${escHtml(q)}</strong>"<br>Try a module name, package, or convention.</div>`;
    }

    input.addEventListener('input', function () { doSearch(this.value.trim()); });
  }

  // ─── Ask AI live chat ─────────────────────────────────────

  const askHistory = [];   // [{ question, answer, provider, model }]
  let askChipsHidden = false;

  async function setupAskAI() {
    // Restore saved provider preference
    const savedProvider = localStorage.getItem('stackbrief_provider') || 'auto';
    const selectEl = document.getElementById('ai-provider-select');
    if (selectEl) selectEl.value = savedProvider;

    selectEl?.addEventListener('change', function () {
      localStorage.setItem('stackbrief_provider', this.value);
      checkAIStatus(this.value === 'auto' ? undefined : this.value);
    });

    await checkAIStatus(savedProvider === 'auto' ? undefined : savedProvider);

    const input   = document.getElementById('ask-section-input');
    const btn     = document.getElementById('ask-section-btn');

    // Submit on Enter
    input?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitQuestion(); }
    });

    btn?.addEventListener('click', submitQuestion);

    // Chips: populate input AND auto-submit
    document.querySelectorAll('.ask-chip').forEach(chip => {
      chip.addEventListener('click', function () {
        const input = document.getElementById('ask-section-input');
        if (input) {
          input.value = this.dataset.q || this.textContent;
          submitQuestion();
        }
      });
    });
  }

  async function checkAIStatus(forceProvider) {
    const dotEl   = document.getElementById('ai-status-dot');
    const labelEl = document.getElementById('ai-status-label');
    const tooltip = document.getElementById('ai-setup-tooltip');
    const inputRow = document.querySelector('.ask-section-input-row');
    const chipsEl  = document.getElementById('ask-chips');
    let noProviderEl = document.getElementById('ask-no-provider');

    try {
      const url = '/api/ai/status' + (forceProvider ? '?provider=' + forceProvider : '');
      const res = await fetch(url);
      const data = await res.json();

      if (data.available && data.provider) {
        const labels = { claude: 'Claude (sonnet)', openai: 'GPT-4o', ollama: `Ollama (${data.model || 'llama3'})` };
        if (dotEl)   { dotEl.className = 'ai-status-dot available'; }
        if (labelEl) { labelEl.textContent = '● ' + (labels[data.provider] || data.provider); labelEl.className = 'ai-status-label available'; }
        if (tooltip) { tooltip.style.display = 'none'; tooltip.textContent = ''; }
        // Show input row, hide setup prompt
        if (inputRow) inputRow.style.display = '';
        if (chipsEl && !askChipsHidden) chipsEl.style.display = '';
        if (noProviderEl) noProviderEl.style.display = 'none';
        const input = document.getElementById('ask-section-input');
        const btn   = document.getElementById('ask-section-btn');
        if (input) { input.disabled = false; input.placeholder = 'Ask about this codebase…'; }
        if (btn)   { btn.disabled  = false; }
      } else {
        if (dotEl)   { dotEl.className = 'ai-status-dot unavailable'; }
        if (labelEl) { labelEl.textContent = 'No AI configured'; labelEl.className = 'ai-status-label'; }
        if (tooltip && data.setup) { tooltip.textContent = data.setup; }
        // Replace input row with inline setup prompt
        if (inputRow) inputRow.style.display = 'none';
        if (chipsEl)  chipsEl.style.display   = 'none';

        if (!noProviderEl) {
          noProviderEl = document.createElement('div');
          noProviderEl.id = 'ask-no-provider';
          noProviderEl.className = 'ask-no-provider';
          inputRow?.parentNode?.insertBefore(noProviderEl, inputRow);
        }

        noProviderEl.style.display = '';
        noProviderEl.innerHTML = `
          <div class="ask-no-provider-label">No AI provider configured. Connect one to start chatting.</div>
          <div class="ask-no-provider-buttons">
            <button class="ask-setup-btn ask-setup-btn-primary" data-goto="ollama">Try Ollama — Free &amp; Private</button>
            <button class="ask-setup-btn" data-goto="claude">Use Claude</button>
            <button class="ask-setup-btn" data-goto="openai">Use OpenAI</button>
          </div>
        `;

        noProviderEl.querySelectorAll('.ask-setup-btn[data-goto]').forEach(btn => {
          btn.addEventListener('click', function () {
            activateSection('settings');
            setTimeout(() => {
              const card = document.getElementById('provider-card-' + this.dataset.goto);
              if (card) {
                card.classList.add('provider-highlight');
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => card.classList.remove('provider-highlight'), 5000);
              }
            }, 300);
          });
        });
      }
    } catch {
      if (labelEl) labelEl.textContent = 'Status unknown';
    }
  }

  async function submitQuestion() {
    const input   = document.getElementById('ask-section-input');
    const btn     = document.getElementById('ask-section-btn');
    const chips   = document.getElementById('ask-chips');
    const histEl  = document.getElementById('ask-history');

    const question = input?.value?.trim();
    if (!question) return;

    // Clear input, disable controls
    input.value    = '';
    input.disabled = true;
    btn.disabled   = true;
    btn.textContent = '…';

    // Hide chips and description after first question
    if (!askChipsHidden && chips) {
      chips.style.display = 'none';
      askChipsHidden = true;
    }
    const descEl = document.getElementById('ask-description');
    if (descEl) descEl.style.display = 'none';

    // Add loading pair to history
    const loadingPair = { question, answer: null, provider: null, model: null, loading: true };
    askHistory.unshift(loadingPair);
    renderHistory(histEl);

    const selectedProvider = document.getElementById('ai-provider-select')?.value;
    const providerParam    = selectedProvider === 'auto' ? '' : selectedProvider;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, provider: providerParam || undefined })
      });

      const data = await res.json();

      if (!res.ok) {
        loadingPair.loading = false;
        loadingPair.answer  = data.error || 'Something went wrong.';
        loadingPair.error   = true;
        loadingPair.setup   = data.setup;
      } else {
        loadingPair.loading  = false;
        loadingPair.answer   = data.answer;
        loadingPair.provider = data.provider;
        loadingPair.model    = data.model;
      }
    } catch {
      loadingPair.loading = false;
      loadingPair.answer  = 'Could not reach the server.';
      loadingPair.error   = true;
    }

    // Keep only last 3 pairs
    if (askHistory.length > 3) askHistory.length = 3;

    renderHistory(histEl);

    input.disabled  = false;
    btn.disabled    = false;
    btn.textContent = 'Ask';
    input.focus();
  }

  function renderHistory(container) {
    if (!container) return;
    container.innerHTML = askHistory.map((pair, i) => {
      const isNewest = i === 0;
      const pairClass = 'ask-pair' + (isNewest ? '' : ' ask-pair-old');

      if (pair.loading) {
        return `
          <div class="${pairClass} ask-pair-loading">
            <div class="ask-pair-question">${escHtml(pair.question)}</div>
            <div class="ask-pair-answer">
              <div class="ask-pair-answer-text">
                <span class="ask-loading-dots"><span></span><span></span><span></span></span>
              </div>
            </div>
          </div>
        `;
      }

      const viaHtml = pair.provider && !pair.error
        ? `<div class="ask-pair-via">via ${escHtml(pair.provider)}</div>`
        : '';

      const answerStyle = pair.error ? 'color:#BA7517' : '';
      const setupNote   = pair.setup
        ? `<div style="margin-top:8px;font-size:12px;color:#4a6060;white-space:pre-wrap">${escHtml(pair.setup)}</div>`
        : '';

      return `
        <div class="${pairClass}">
          <div class="ask-pair-question">${escHtml(pair.question)}</div>
          <div class="ask-pair-answer">
            ${viaHtml}
            <div class="ask-pair-answer-text" style="${answerStyle}">${escHtml(pair.answer || '')}</div>
            ${setupNote}
          </div>
        </div>
      `;
    }).join('');
  }

  function setupAskChips() { /* merged into setupAskAI */ }

  // ─── Project switcher ─────────────────────────────────────

  function setupProjectSwitcher() {
    const btn = document.getElementById('project-switcher');
    const dropdown = document.getElementById('project-dropdown');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.classList.contains('open') ? closeProjectDropdown() : openProjectDropdown();
    });

    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target) && e.target !== btn) closeProjectDropdown();
    });

    // Browse folder button
    const browseBtn = document.getElementById('browse-folder-btn');
    if (browseBtn) {
      browseBtn.addEventListener('click', function () { browseForFolder(); });
    }

    // Fallback text input for non-macOS
    const scanBtn = document.getElementById('scan-path-btn');
    const pathInput = document.getElementById('project-path-input');
    if (scanBtn && pathInput) {
      scanBtn.addEventListener('click', () => { const p = pathInput.value.trim(); if (p) triggerScan(p); });
      pathInput.addEventListener('keydown', e => { if (e.key === 'Enter') { const p = pathInput.value.trim(); if (p) triggerScan(p); } });
    }

    // Platform check happens lazily inside browseForFolder on first click
  }

  function openProjectDropdown() {
    const btn = document.getElementById('project-switcher');
    const dropdown = document.getElementById('project-dropdown');
    if (btn) { btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    if (dropdown) dropdown.classList.add('open');
    loadRecentPaths();
  }

  function closeProjectDropdown() {
    const btn = document.getElementById('project-switcher');
    const dropdown = document.getElementById('project-dropdown');
    if (btn) { btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    if (dropdown) dropdown.classList.remove('open');
  }

  async function browseForFolder() {
    const browseBtn = document.getElementById('browse-folder-btn');
    if (browseBtn) { browseBtn.textContent = 'Opening…'; browseBtn.disabled = true; }

    try {
      const res = await fetch('/api/browse');
      const data = await res.json();

      if (data.unsupported) {
        // Show the fallback text input
        const row = document.getElementById('path-input-row');
        if (row) row.style.display = 'flex';
        return;
      }

      if (!data.cancelled && data.path) {
        closeProjectDropdown();
        await triggerScan(data.path);
      }
    } catch {
      const hint = document.getElementById('browse-hint');
      if (hint) hint.textContent = 'Could not open picker';
    } finally {
      if (browseBtn) {
        browseBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0"><path d="M1.5 3.5C1.5 2.948 1.948 2.5 2.5 2.5H5.5L7 4H11.5C12.052 4 12.5 4.448 12.5 5V10.5C12.5 11.052 12.052 11.5 11.5 11.5H2.5C1.948 11.5 1.5 11.052 1.5 10.5V3.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>Browse folder`;
        browseBtn.disabled = false;
      }
    }
  }

  async function loadRecentPaths() {
    const container = document.getElementById('recent-paths-container');
    if (!container) return;

    try {
      const res = await fetch('/api/recents');
      if (!res.ok) throw new Error();
      const recents = await res.json();

      if (!recents || !recents.length) {
        container.innerHTML = '<div class="recent-paths-empty">No recent projects</div>';
        return;
      }

      container.innerHTML =
        '<div class="recent-paths-header">recent</div>' +
        recents.map(r => `
          <div class="recent-path-item" data-path="${escHtml(r.path)}">
            <span class="recent-path-name">${escHtml(r.name)}</span>
            <span class="recent-path-dir">${escHtml(r.path)}</span>
          </div>
        `).join('');

      container.querySelectorAll('.recent-path-item').forEach(item => {
        item.addEventListener('click', function () { triggerScan(this.dataset.path); });
      });
    } catch {
      container.innerHTML = '<div class="recent-paths-empty">No recent projects</div>';
    }
  }

  // ─── Re-scan ──────────────────────────────────────────────

  function setupRescan() {
    const btn = document.getElementById('rescan-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (analysisData) triggerScan(analysisData.rootDir);
    });
  }

  async function triggerScan(dirPath) {
    const overlay = document.getElementById('scanning-overlay');
    const label = document.getElementById('scanning-label');
    const pathEl = document.getElementById('scanning-path');
    const rescanBtn = document.getElementById('rescan-btn');

    if (overlay) overlay.classList.add('active');
    if (label) label.textContent = 'Scanning…';
    if (pathEl) pathEl.textContent = dirPath;
    if (rescanBtn) { rescanBtn.textContent = 'Scanning…'; rescanBtn.disabled = true; }

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath })
      });
      if (!res.ok) throw new Error(await res.text());
      analysisData = await res.json();
      npmVersionsCache = null;
      window._codemapRendered = false;

      renderMeta(analysisData);
      renderMetrics(analysisData);
      renderArchitecture(analysisData.architecture, analysisData.stack);
      renderModulesGrid(analysisData.modules);
      renderModulesList(analysisData.modules);
      renderDependencies(analysisData.dependencies, {});
      renderConventions(analysisData.conventions);
      setupSearch(analysisData);
      closeProjectDropdown();
      activateSection('overview');
      initTooltips();

      fetchNpmVersions().then(versions => {
        if (versions && Object.keys(versions).length) {
          renderDependencies(analysisData.dependencies, versions);
          filterDeps(currentDepFilter);
          initTooltips(); // re-init to catch updated badge elements
        }
      });
    } catch (err) {
      if (label) label.textContent = 'Scan failed: ' + err.message;
      await new Promise(r => setTimeout(r, 2500));
    } finally {
      if (overlay) overlay.classList.remove('active');
      if (rescanBtn) { rescanBtn.textContent = 'Re-scan'; rescanBtn.disabled = false; }
    }
  }

  // ─── Code Map ─────────────────────────────────────────────

  function buildTreeData(data) {
    const allModules = (data.modules && data.modules.modules) || [];
    const topLevel = allModules.filter(m => !m.path.includes('/'));
    const subModules = allModules.filter(m => m.path.includes('/'));

    const children = topLevel.map(m => {
      const subs = subModules
        .filter(s => s.path.startsWith(m.path + '/'))
        .map(s => ({ ...s, children: [] }));
      return { ...m, children: subs };
    });

    return {
      name: data.repoName,
      path: '.',
      description: [data.stack.framework, data.stack.language].filter(Boolean).join(' · '),
      fileCount: data.totalFiles,
      isRoot: true,
      children
    };
  }

  function renderCodeMap(data) {
    const container = document.getElementById('codemap-graph');
    if (!container) return;

    if (!window.d3) {
      container.innerHTML = '<div class="codemap-loading">D3 library not loaded — check your internet connection</div>';
      return;
    }

    const loading = document.getElementById('codemap-loading');
    if (loading) loading.remove();
    container.innerHTML = '';

    const treeData = buildTreeData(data);
    if (!treeData.children || treeData.children.length === 0) {
      container.innerHTML = '<div class="codemap-loading">No modules detected</div>';
      return;
    }

    const NODE_W = 168;
    const NODE_H = 74;
    // Fixed 160px level spacing (center-to-center), 220px horizontal spacing
    const LEVEL_H = 160;
    const NODE_SPACING_H = 220;

    const cW = container.clientWidth || 700;

    const hierarchy = d3.hierarchy(treeData);
    const treeDepth = hierarchy.height;

    const tree = d3.tree().nodeSize([NODE_SPACING_H, LEVEL_H]);
    tree(hierarchy);

    // Compute horizontal bounds
    let xMin = Infinity, xMax = -Infinity;
    hierarchy.each(d => {
      if (d.x < xMin) xMin = d.x;
      if (d.x > xMax) xMax = d.x;
    });

    // SVG dimensions: height driven by tree depth per spec
    const treeW  = xMax - xMin + NODE_W + 80;
    const svgH   = Math.max(600, treeDepth * LEVEL_H + 200); // levels×160 + top+bottom pad
    const svgW   = Math.max(cW, treeW);

    // Expand container to show full tree without clipping
    container.style.minHeight = svgH + 'px';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', svgH + 'px')
      .style('width',     svgW + 'px')
      .style('min-width', svgW + 'px')
      .style('height',    svgH + 'px')
      .style('display',   'block');

    // Zoom / pan
    const zoomBehavior = d3.zoom()
      .scaleExtent([0.2, 3])
      .on('zoom', event => mainG.attr('transform', event.transform));

    svg.call(zoomBehavior);

    // Initial position: center horizontally, 60px top padding for root
    const topPad  = 60;
    const offsetX = cW / 2 - (xMin + xMax) / 2;
    const offsetY = topPad + NODE_H / 2;  // root center-top at topPad + half-node

    const mainG = svg.append('g')
      .attr('class', 'codemap-main')
      .attr('transform', `translate(${offsetX},${offsetY})`);

    svg.call(zoomBehavior.transform,
      d3.zoomIdentity.translate(offsetX, offsetY));

    // ── Links: straight diagonal lines, no bezier curves ──────

    // S-curve generator: flows from parent center-bottom to child center-top
    const linkVertical = d3.linkVertical()
      .x(d => d.x)
      .y(d => d.y);

    const linkSel = mainG.append('g').attr('class', 'codemap-links')
      .selectAll('.codemap-link')
      .data(hierarchy.links())
      .join('path')
      .attr('class', 'codemap-link')
      .attr('d', d => linkVertical({
        source: { x: d.source.x, y: d.source.y + NODE_H / 2 },
        target: { x: d.target.x, y: d.target.y - NODE_H / 2 }
      }));

    // ── Nodes ─────────────────────────────────────────────

    const nodeSel = mainG.append('g').attr('class', 'codemap-nodes')
      .selectAll('.codemap-node')
      .data(hierarchy.descendants())
      .join('g')
      .attr('class', d => 'codemap-node' + (d.data.isRoot ? ' codemap-node-root' : ''))
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .style('opacity', 0)
      .style('cursor', 'pointer');

    // Background rect
    // Rect drawn first so text renders on top.
    // Non-root text spans y≈-21 (name top) to y≈+27 (desc bottom).
    // y=-30 puts 9px padding above name, height=68 puts 14px below desc.
    nodeSel.append('rect')
      .attr('x',      d => d.data.isRoot ? -NODE_W / 2 : -80)
      .attr('y',      d => d.data.isRoot ? -NODE_H / 2 : -30)
      .attr('width',  d => d.data.isRoot ? NODE_W : 160)
      .attr('height', d => d.data.isRoot ? NODE_H : 68)
      .attr('rx', 6);

    // Name
    nodeSel.append('text')
      .attr('class', 'node-name-text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('y', d => d.data.isRoot ? 2 : -14)
      .text(d => d.data.name);

    // File count (non-root)
    nodeSel.filter(d => !d.data.isRoot)
      .append('text')
      .attr('class', 'node-count-text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('y', 4)
      .text(d => d.data.fileCount + (d.data.fileCount === 1 ? ' file' : ' files'));

    // Description (non-root)
    nodeSel.filter(d => !d.data.isRoot && d.data.description)
      .append('text')
      .attr('class', 'node-desc-text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('y', 20)
      .text(d => truncate(d.data.description, 24));

    // Animate in — stagger by depth
    nodeSel.transition()
      .duration(280)
      .delay(d => d.depth * 90)
      .style('opacity', 1);

    // ── Interactions ──────────────────────────────────────

    nodeSel
      .on('mouseenter', function (event, d) {
        event.stopPropagation();
        d3.select(this).classed('codemap-node-hover', true);
        linkSel.classed('codemap-link-active', link =>
          link.source === d || link.target === d
        );
        nodeSel.classed('codemap-node-connected', other =>
          other !== d && (other === d.parent || (d.parent && other.parent === d.parent && other !== d) ||
            (d.children && d.children.includes(other)) || (other.parent === d))
        );
      })
      .on('mouseleave', function () {
        d3.select(this).classed('codemap-node-hover', false);
        linkSel.classed('codemap-link-active', false);
        nodeSel.classed('codemap-node-connected', false);
      })
      .on('click', function (event, d) {
        event.stopPropagation();
        const wasSelected = d3.select(this).classed('codemap-node-selected');
        nodeSel.classed('codemap-node-selected', false);
        if (!wasSelected) {
          d3.select(this).classed('codemap-node-selected', true);
          showDetailPanel(d.data);
        } else {
          hideDetailPanel();
        }
      });

    // Click SVG background to deselect
    svg.on('click', function () {
      nodeSel.classed('codemap-node-selected', false);
      hideDetailPanel();
    });
  }

  function showDetailPanel(nodeData) {
    const panel = document.getElementById('codemap-panel');
    if (!panel) return;

    panel.classList.add('open');

    const badges = [
      nodeData.moduleType ? `<span class="tag tag-type">${escHtml(nodeData.moduleType)}</span>` : '',
      nodeData.hasTests   ? `<span class="tag tag-muted">tests</span>` : '',
      nodeData.hasIndex   ? `<span class="tag tag-muted">index</span>` : '',
      nodeData.primaryLanguage && nodeData.primaryLanguage !== 'Unknown'
        ? `<span class="tag tag-muted">${escHtml(nodeData.primaryLanguage)}</span>` : '',
    ].filter(Boolean).join(' ');

    const filesHtml = nodeData.keyFiles && nodeData.keyFiles.length ? `
      <div class="panel-files">
        <div class="panel-files-label">key files</div>
        ${nodeData.keyFiles.map(f => `
          <div class="panel-file-row">
            <span class="panel-file-name">${escHtml(f)}</span>
          </div>
        `).join('')}
      </div>
    ` : '';

    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-name">${escHtml(nodeData.name)}</div>
        <button class="panel-close-btn" id="panel-close">✕</button>
      </div>
      <div class="panel-body">
        <div class="panel-path">${escHtml(nodeData.path)}</div>
        ${badges ? `<div class="panel-badges">${badges}</div>` : ''}
        <div class="panel-stat-row">
          <span class="panel-stat-label">${nodeData.isRoot ? 'total files' : 'files'}</span>
          <span class="panel-stat-value">${nodeData.fileCount || 0}</span>
        </div>
        ${nodeData.description
          ? `<div class="panel-desc">${escHtml(nodeData.description)}</div>`
          : ''}
        ${filesHtml}
      </div>
    `;

    document.getElementById('panel-close')
      ?.addEventListener('click', hideDetailPanel);
  }

  function hideDetailPanel() {
    const panel = document.getElementById('codemap-panel');
    if (panel) panel.classList.remove('open');
  }

  // ─── Settings page ────────────────────────────────────────

  let ollamaPollingTimer      = null; // 3s status check while Settings page is open
  let ollamaAutoConnectTimer  = null; // 5s wait-for-server poll after Outcome B
  let settingsConfig = null;

  async function loadSettingsPage() {
    try {
      const res = await fetch('/api/config');
      settingsConfig = await res.json();
      renderSettingsFromConfig(settingsConfig);
      startOllamaPolling();
    } catch { /* silent */ }
  }

  function stopOllamaPolling() {
    if (ollamaPollingTimer) { clearInterval(ollamaPollingTimer); ollamaPollingTimer = null; }
  }

  function startOllamaPolling() {
    stopOllamaPolling();
    checkOllamaStatus();
    ollamaPollingTimer = setInterval(checkOllamaStatus, 3000);
  }

  async function checkOllamaStatus() {
    const dotEl   = document.getElementById('ollama-status-dot');
    const labelEl = document.getElementById('ollama-status-label');
    const runningEl = document.getElementById('ollama-running-state');
    const setupEl = document.getElementById('ollama-setup-guide');
    const modelSel = document.getElementById('ollama-model-select');
    if (!dotEl) return;

    try {
      const res = await fetch('/api/ollama/models');
      const data = await res.json();

      if (data.running) {
        dotEl.className   = 'provider-status-dot live';
        labelEl.textContent = 'Running';
        if (runningEl) runningEl.style.display = '';
        if (setupEl)   setupEl.style.display   = 'none';

        // Populate model selector
        if (modelSel && data.models && data.models.length) {
          const saved = settingsConfig?.ai?.providers?.ollama?.model;
          modelSel.innerHTML = data.models
            .map(m => `<option value="${escHtml(m)}"${m === saved || m.startsWith(saved) ? ' selected' : ''}>${escHtml(m)}</option>`)
            .join('');
        }
      } else {
        dotEl.className   = 'provider-status-dot offline';
        labelEl.textContent = 'Not detected';
        if (runningEl) runningEl.style.display = 'none';
        if (setupEl)   setupEl.style.display   = '';
      }
    } catch {
      if (dotEl) dotEl.className = 'provider-status-dot offline';
      if (labelEl) labelEl.textContent = 'Not detected';
    }
  }

  function renderSettingsFromConfig(cfg) {
    if (!cfg) return;

    // Active provider tabs
    const activeProvider = cfg.ai?.activeProvider || 'auto';
    document.querySelectorAll('.active-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.p === activeProvider);
    });

    // Highlight active provider card
    document.querySelectorAll('.provider-card').forEach(card => card.classList.remove('provider-active'));
    if (activeProvider !== 'auto') {
      document.getElementById('provider-card-' + activeProvider)?.classList.add('provider-active');
    }

    // Claude
    const claude = cfg.ai?.providers?.claude;
    if (claude) {
      const keyEl = document.getElementById('claude-api-key');
      const modelEl = document.getElementById('claude-model-select');
      const statusDot = document.getElementById('claude-status-dot');
      const statusLabel = document.getElementById('claude-status-label');

      if (keyEl && claude.apiKey) keyEl.placeholder = claude.apiKey; // shows "sk-ant…configured"
      if (modelEl && claude.model) modelEl.value = claude.model;

      const configured = claude.apiKey && claude.apiKey.length > 4;
      if (statusDot) statusDot.className = 'provider-status-dot ' + (configured ? 'live' : 'offline');
      if (statusLabel) statusLabel.textContent = configured ? 'Configured' : 'Not configured';
    }

    // OpenAI
    const openai = cfg.ai?.providers?.openai;
    if (openai) {
      const keyEl = document.getElementById('openai-api-key');
      const modelEl = document.getElementById('openai-model-select');
      const statusDot = document.getElementById('openai-status-dot');
      const statusLabel = document.getElementById('openai-status-label');

      if (keyEl && openai.apiKey) keyEl.placeholder = openai.apiKey;
      if (modelEl && openai.model) modelEl.value = openai.model;

      const configured = openai.apiKey && openai.apiKey.length > 4;
      if (statusDot) statusDot.className = 'provider-status-dot ' + (configured ? 'live' : 'offline');
      if (statusLabel) statusLabel.textContent = configured ? 'Configured' : 'Not configured';
    }
  }

  function setupSettingsPage() {
    // Active provider tabs
    document.querySelectorAll('.active-tab').forEach(btn => {
      btn.addEventListener('click', async function () {
        const p = this.dataset.p;
        await fetch('/api/config/provider/active', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: p })
        });
        document.querySelectorAll('.active-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        // Refresh AI status in ask bar
        checkAIStatus(p === 'auto' ? undefined : p);
        // Update card highlight
        document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('provider-active'));
        if (p !== 'auto') document.getElementById('provider-card-' + p)?.classList.add('provider-active');
      });
    });

    // ── Ollama connect helpers ────────────────────────────────

    function getOllamaFeedbackEl(btn) {
      let el = document.getElementById('ollama-connect-error');
      if (!el) {
        el = document.createElement('div');
        el.id = 'ollama-connect-error';
        btn.after(el);
      }
      return el;
    }

    function clearOllamaFeedback() {
      const el    = document.getElementById('ollama-connect-error');
      const step1 = document.getElementById('ollama-setup-step-1');
      if (el)    { el.textContent = ''; el.className = ''; }
      if (step1) step1.classList.remove('setup-step-active');
    }

    async function applyOllamaConnected(btn, models) {
      btn.textContent = 'Connecting…';
      btn.disabled    = true;

      const model = document.getElementById('ollama-model-select')?.value
        || (models?.[0]?.split(':')[0] ?? 'llama3');

      await fetch('/api/config/provider/ollama', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, model })
      });
      await fetch('/api/config/provider/active', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'ollama' })
      });

      document.querySelectorAll('.active-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.p === 'ollama')
      );

      // Update card UI
      const card     = document.getElementById('provider-card-ollama');
      const modelSel = document.getElementById('ollama-model-select');
      const runningEl = document.getElementById('ollama-running-state');
      const setupEl   = document.getElementById('ollama-setup-guide');
      const dotEl     = document.getElementById('ollama-status-dot');
      const labelEl   = document.getElementById('ollama-status-label');

      btn.textContent = 'Disconnect';
      btn.classList.add('connected');
      btn.disabled    = false;
      card?.classList.add('provider-active');

      if (modelSel && models?.length) {
        modelSel.innerHTML = models.map(m =>
          `<option value="${escHtml(m)}"${m === model || m.startsWith(model) ? ' selected' : ''}>${escHtml(m)}</option>`
        ).join('');
      }
      if (runningEl) runningEl.style.display = '';
      if (setupEl)   setupEl.style.display   = 'none';
      if (dotEl)     dotEl.className         = 'provider-status-dot live';
      if (labelEl)   labelEl.textContent     = 'Running';

      clearOllamaFeedback();
      checkAIStatus('ollama');
    }

    function startOllamaAutoConnect(btn) {
      if (ollamaAutoConnectTimer) clearInterval(ollamaAutoConnectTimer);
      ollamaAutoConnectTimer = setInterval(async () => {
        try {
          const res  = await fetch('/api/ollama/check');
          const data = await res.json();
          if (data.running) {
            clearInterval(ollamaAutoConnectTimer);
            ollamaAutoConnectTimer = null;
            // Show brief success toast then proceed
            const fb = document.getElementById('ollama-connect-error');
            if (fb) { fb.className = 'ollama-connect-success'; fb.textContent = '✓ Ollama is now running'; }
            setTimeout(() => applyOllamaConnected(btn, data.models), 900);
          }
        } catch { /* keep polling */ }
      }, 5000);
    }

    // ── Connect / disconnect handler ──────────────────────────

    document.getElementById('ollama-connect-btn')?.addEventListener('click', async function () {
      const btn = this;

      // Stop any waiting poll
      if (ollamaAutoConnectTimer) { clearInterval(ollamaAutoConnectTimer); ollamaAutoConnectTimer = null; }

      // ── Disconnect ─────────────────────────────────────────
      if (btn.classList.contains('connected')) {
        await fetch('/api/config/provider/ollama', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false })
        });
        btn.textContent = 'Connect';
        btn.classList.remove('connected');
        document.getElementById('provider-card-ollama')?.classList.remove('provider-active');
        clearOllamaFeedback();
        checkAIStatus();
        return;
      }

      // ── Connect: show "Checking…" ─────────────────────────
      btn.textContent = 'Checking…';
      btn.disabled    = true;
      clearOllamaFeedback();

      let checkData = null;
      try {
        const [res] = await Promise.all([
          fetch('/api/ollama/check'),
          new Promise(r => setTimeout(r, 900)) // keep loading state visible
        ]);
        checkData = await res.json();
      } catch { /* checkData stays null — Outcome D */ }

      btn.textContent = 'Connect';
      btn.disabled    = false;

      const fb    = getOllamaFeedbackEl(btn);
      const step1 = document.getElementById('ollama-setup-step-1');

      // ── Outcome D: request itself failed ──────────────────
      if (!checkData) {
        fb.className   = 'ollama-connect-error';
        fb.textContent = 'Could not check Ollama status. Please try again.';
        return;
      }

      // ── Outcome A: not installed ───────────────────────────
      if (!checkData.installed) {
        fb.className   = 'ollama-connect-error';
        fb.textContent = 'Ollama is not installed on this machine.\nFollow Step 1 above to download and install it.';
        if (step1) step1.classList.add('setup-step-active');
        return;
      }

      // ── Outcome B: installed but not running ───────────────
      if (!checkData.running) {
        fb.className = 'ollama-connect-error';
        fb.innerHTML = `Ollama is installed but not running.<br><br>`
          + `Start it by opening the Ollama app from your Applications folder, or run this in your terminal:<br><br>`
          + `<span class="ollama-cmd-block"><code>ollama serve</code>`
          + `<button class="ollama-cmd-copy copy-btn" data-copy="ollama serve">Copy</button></span><br><br>`
          + `Then click Connect again.`;

        fb.querySelector('.ollama-cmd-copy')?.addEventListener('click', function () {
          navigator.clipboard?.writeText(this.dataset.copy || '');
          const orig = this.textContent;
          this.textContent = 'Copied!';
          setTimeout(() => { this.textContent = orig; }, 1500);
        });

        // Auto-connect once server starts
        startOllamaAutoConnect(btn);
        return;
      }

      // ── Outcome C: installed AND running ──────────────────
      applyOllamaConnected(btn, checkData.models);
    });

    // Show/hide API key buttons
    document.querySelectorAll('.show-key-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const input = document.getElementById(this.dataset.target);
        if (!input) return;
        const hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        this.textContent = hidden ? 'hide' : 'show';
      });
    });

    // Claude save
    document.getElementById('claude-save-btn')?.addEventListener('click', async function () {
      const key   = document.getElementById('claude-api-key')?.value?.trim();
      const model = document.getElementById('claude-model-select')?.value;
      const body = {};
      if (key)   body.apiKey = key;
      if (model) body.model  = model;
      this.textContent = 'Saving…'; this.disabled = true;
      await fetch('/api/config/provider/claude', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, enabled: true })
      });
      this.textContent = 'Saved'; setTimeout(() => { this.textContent = 'Save'; this.disabled = false; }, 1500);
      checkAIStatus();
    });

    // OpenAI save
    document.getElementById('openai-save-btn')?.addEventListener('click', async function () {
      const key   = document.getElementById('openai-api-key')?.value?.trim();
      const model = document.getElementById('openai-model-select')?.value;
      const body = {};
      if (key)   body.apiKey = key;
      if (model) body.model  = model;
      this.textContent = 'Saving…'; this.disabled = true;
      await fetch('/api/config/provider/openai', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, enabled: true })
      });
      this.textContent = 'Saved'; setTimeout(() => { this.textContent = 'Save'; this.disabled = false; }, 1500);
      checkAIStatus();
    });

    // Local runner save
    document.getElementById('local-save-btn')?.addEventListener('click', async function () {
      const baseUrl = document.getElementById('local-base-url')?.value?.trim();
      const model   = document.getElementById('local-model')?.value?.trim();
      this.textContent = 'Saving…'; this.disabled = true;
      await fetch('/api/config/provider/local', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: baseUrl, model, enabled: true })
      });
      this.textContent = 'Saved'; setTimeout(() => { this.textContent = 'Save'; this.disabled = false; }, 1500);
      checkAIStatus();
    });

    // Custom provider save
    document.getElementById('custom-save-btn')?.addEventListener('click', async function () {
      const name    = document.getElementById('custom-name')?.value?.trim();
      const baseUrl = document.getElementById('custom-base-url')?.value?.trim();
      const apiKey  = document.getElementById('custom-api-key')?.value?.trim();
      const model   = document.getElementById('custom-model')?.value?.trim();
      this.textContent = 'Saving…'; this.disabled = true;
      await fetch('/api/config/provider/custom', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url: baseUrl, apiKey, model, enabled: true })
      });
      this.textContent = 'Saved'; setTimeout(() => { this.textContent = 'Save'; this.disabled = false; }, 1500);
      checkAIStatus();
    });

    // Test connection buttons
    ['claude', 'openai', 'local', 'custom'].forEach(name => {
      document.getElementById(name + '-test-btn')?.addEventListener('click', async function () {
        const resultEl = document.getElementById(name + '-test-result');
        this.textContent = 'Testing…'; this.disabled = true;
        if (resultEl) { resultEl.textContent = ''; resultEl.className = 'provider-test-result'; }
        try {
          const res = await fetch('/api/config/provider/' + name + '/test', { method: 'POST' });
          const data = await res.json();
          if (resultEl) {
            if (data.success) {
              resultEl.textContent = `✓ Connected (${data.latency}ms)`;
              resultEl.className   = 'provider-test-result success';
            } else {
              resultEl.textContent = `✗ ${data.error || 'Connection failed'}`;
              resultEl.className   = 'provider-test-result error';
            }
          }
        } catch {
          if (resultEl) { resultEl.textContent = '✗ Request failed'; resultEl.className = 'provider-test-result error'; }
        }
        this.textContent = 'Test connection'; this.disabled = false;
      });
    });

    // Copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        navigator.clipboard?.writeText(this.dataset.copy || '');
        const orig = this.textContent;
        this.textContent = 'Copied!';
        setTimeout(() => { this.textContent = orig; }, 1500);
      });
    });
  }

  async function testAllProviders() {
    const tbody = document.getElementById('health-table-body');
    if (!tbody) return;

    const providers = ['ollama', 'claude', 'openai'];
    // Set loading state
    tbody.innerHTML = providers.map(p => `
      <tr><td>${p.charAt(0).toUpperCase()+p.slice(1)}</td>
      <td><span class="provider-status-dot"></span> Testing…</td>
      <td>—</td><td>—</td></tr>
    `).join('');

    await Promise.all(providers.map(async (name, i) => {
      try {
        const res  = await fetch('/api/config/provider/' + name + '/test', { method: 'POST' });
        const data = await res.json();
        const row  = tbody.rows[i];
        if (!row) return;

        if (data.success) {
          const model = name === 'ollama' ? (data.models?.[0] || 'llama3') : '—';
          row.cells[1].innerHTML = '<span class="provider-status-dot live"></span> Live';
          row.cells[2].textContent = model;
          row.cells[3].textContent = data.latency + 'ms';
        } else {
          row.cells[1].innerHTML = '<span class="provider-status-dot offline"></span> ' + (data.error || 'Not configured');
          row.cells[2].textContent = '—';
          row.cells[3].textContent = '—';
        }
      } catch { /* silent */ }
    }));
  }

  // ─── Welcome screen (first run) ──────────────────────────

  async function checkFirstRun() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      if (!cfg.firstRunComplete) showWelcomeScreen();
    } catch { /* silent */ }
  }

  async function showWelcomeScreen() {
    const overlay = document.getElementById('welcome-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';

    // Load current working directory
    try {
      const res  = await fetch('/api/cwd');
      const data = await res.json();
      const cwdEl = document.getElementById('welcome-cwd');
      if (cwdEl) cwdEl.textContent = data.cwd || '';
    } catch { /* silent */ }

    // Load recent projects
    try {
      const res     = await fetch('/api/recents');
      const recents = await res.json();
      const container = document.getElementById('welcome-recents');
      if (container && recents && recents.length) {
        container.innerHTML =
          '<div class="welcome-recents-heading">Or continue with a recent project</div>' +
          recents.slice(0, 3).map(r => `
            <div class="welcome-recent-item" data-path="${escHtml(r.path)}">
              <div class="welcome-recent-name">${escHtml(r.name)}</div>
              <div class="welcome-recent-path">${escHtml(r.path)}</div>
            </div>
          `).join('');

        container.querySelectorAll('.welcome-recent-item').forEach(item => {
          item.addEventListener('click', function () {
            welcomeScan(this.dataset.path);
          });
        });
      }
    } catch { /* silent */ }

    // Browse button — use /api/browse (osascript on macOS)
    document.getElementById('welcome-browse-btn')?.addEventListener('click', async function () {
      this.disabled = true;
      this.querySelector('.welcome-btn-primary-text').textContent = 'Opening…';
      try {
        const res  = await fetch('/api/browse');
        const data = await res.json();
        if (!data.cancelled && data.path) {
          welcomeScan(data.path);
          return;
        }
        // Fallback: show path input if browse fails or cancelled
      } catch { /* silent */ }
      // Reset button on failure
      this.disabled = false;
      this.querySelector('.welcome-btn-primary-text').textContent = 'Browse and select a folder';
    });

    // Scan current dir button
    document.getElementById('welcome-current-btn')?.addEventListener('click', async function () {
      const cwd = document.getElementById('welcome-cwd')?.textContent?.trim();
      if (cwd) welcomeScan(cwd);
    });
  }

  async function welcomeScan(dirPath) {
    const overlay    = document.getElementById('welcome-overlay');
    const browseBtn  = document.getElementById('welcome-browse-btn');
    const currentBtn = document.getElementById('welcome-current-btn');
    const scanningEl = document.getElementById('welcome-scanning');
    const scanText   = document.getElementById('welcome-scanning-text');

    // Disable buttons, show scanning indicator
    if (browseBtn)  browseBtn.disabled  = true;
    if (currentBtn) currentBtn.disabled = true;
    if (scanningEl) scanningEl.style.display = 'block';
    if (scanText)   scanText.textContent = `Scanning ${dirPath.split('/').pop() || dirPath}…`;

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath })
      });

      if (!res.ok) throw new Error('Scan failed');
      analysisData = await res.json();
      npmVersionsCache = null;
      window._codemapRendered = false;

      // Mark first run complete
      await fetch('/api/config/firstrun', { method: 'PUT' }).catch(() => {});

      // Re-render dashboard with new data
      renderMeta(analysisData);
      renderMetrics(analysisData);
      renderArchitecture(analysisData.architecture, analysisData.stack);
      renderModulesGrid(analysisData.modules);
      renderModulesList(analysisData.modules);
      renderDependencies(analysisData.dependencies, {});
      renderConventions(analysisData.conventions);
      setupSearch(analysisData);
      initTooltips();

      // Kick off version fetch in background
      fetchNpmVersions().then(versions => {
        if (versions && Object.keys(versions).length) {
          renderDependencies(analysisData.dependencies, versions);
          filterDeps(currentDepFilter);
          initTooltips();
        }
      });

      // Fade out welcome screen → reveal dashboard
      if (overlay) {
        overlay.classList.add('welcome-fading');
        setTimeout(() => { overlay.style.display = 'none'; }, 310);
      }

      activateSection('overview');
      setupAskAI();

    } catch (err) {
      if (scanText)   scanText.textContent = 'Scan failed — ' + err.message;
      if (browseBtn)  browseBtn.disabled  = false;
      if (currentBtn) currentBtn.disabled = false;
    }
  }

  async function markFirstRunDone() {
    await fetch('/api/config/firstrun', { method: 'PUT' }).catch(() => {});
  }

  // ─── Main init ────────────────────────────────────────────

  async function init() {
    setupNav();
    setupKeyboard();
    setupProjectSwitcher();
    setupSettingsPage();
    setupAskAI();
    setupRescan();

    try {
      const res = await fetch('/api/analysis');
      if (!res.ok) throw new Error('Status ' + res.status);
      analysisData = await res.json();

      renderMeta(analysisData);
      renderMetrics(analysisData);
      renderArchitecture(analysisData.architecture, analysisData.stack);
      renderModulesGrid(analysisData.modules);
      renderModulesList(analysisData.modules);
      renderDependencies(analysisData.dependencies, {});
      renderConventions(analysisData.conventions);
      setupSearch(analysisData);
      initTooltips();

      // First-run wizard check
      checkFirstRun();

      // Fetch npm versions in background
      fetchNpmVersions().then(versions => {
        if (versions && Object.keys(versions).length) {
          renderDependencies(analysisData.dependencies, versions);
          filterDeps(currentDepFilter);
          initTooltips();
        }
      });

    } catch (err) {
      const main = document.querySelector('.main');
      const el = document.createElement('div');
      el.className = 'error-state';
      el.textContent = 'Could not load analysis. Make sure the stackbrief server is running.';
      if (main) main.prepend(el);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
