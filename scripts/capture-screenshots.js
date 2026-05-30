#!/usr/bin/env node
/**
 * Capture README screenshots from the running stackbrief dashboard.
 * Prerequisites: stackbrief must be running (npx stackbrief scan)
 * Requires: npm install -D puppeteer
 * Usage: node scripts/capture-screenshots.js
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const OUT_DIR  = path.join(__dirname, '..', 'screenshots');

const VIEWS = [
  { name: 'overview',      section: 'overview',      file: 'overview.png'      },
  { name: 'codemap',       section: 'codemap',        file: 'codemap.png'       },
  { name: 'dependencies',  section: 'dependencies',   file: 'dependencies.png'  },
  { name: 'settings',      section: 'settings',       file: 'settings.png'      },
];

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new' });
  const page    = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  console.log('Loading dashboard...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

  for (const view of VIEWS) {
    console.log(`Capturing ${view.name}...`);

    await page.evaluate((section) => {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      const sec = document.getElementById('section-' + section);
      const nav = document.querySelector('[data-section="' + section + '"]');
      if (sec) sec.classList.add('active');
      if (nav) nav.classList.add('active');
    }, view.section);

    if (view.section === 'codemap') {
      // Give the D3 tree time to render
      await page.waitForTimeout(1500);
    } else {
      await page.waitForTimeout(400);
    }

    const outPath = path.join(OUT_DIR, view.file);
    await page.screenshot({ path: outPath });
    console.log(`  saved → screenshots/${view.file}`);
  }

  await browser.close();
  console.log('\nDone. Screenshots saved to screenshots/');
})().catch(err => {
  console.error('Error:', err.message);
  console.error('Make sure stackbrief is running: npx stackbrief scan');
  process.exit(1);
});
