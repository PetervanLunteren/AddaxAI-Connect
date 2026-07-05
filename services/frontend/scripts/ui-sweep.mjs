// UI sweep: screenshot every page at phone, tablet, and desktop widths.
//
// Logs in with a test account, visits every route, and writes screenshots
// plus a report with console errors and horizontal-overflow flags. Used to
// verify responsive behaviour after UI changes. See "Frontend UI development
// loop" in DEVELOPERS.md.
//
// Usage:
//   npm run sweep
//
// Needs in services/frontend/.env.local (or as env vars):
//   SWEEP_EMAIL       login email of the test account
//   SWEEP_PASSWORD    its password
//   SWEEP_PROJECT_ID  optional, defaults to the first project of the account
//   SWEEP_BASE_URL    optional, defaults to http://localhost:5173
//
// Output: ui-sweep-output/<viewport>/<route>.png and ui-sweep-output/report.txt

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIR = path.join(FRONTEND_DIR, 'ui-sweep-output');

// Fixed settle delay after 'load'. 'networkidle' would hang forever on pages
// with websockets (live feed) or map tile streams.
const SETTLE_MS = 1500;

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

// All user-reachable routes from src/App.tsx. Redirect-only routes are left
// out. Token-gated routes (/register, /verify-email, /reset-password) are
// left out because they need one-time tokens.
const PUBLIC_ROUTES = ['/login', '/forgot-password'];
const GLOBAL_ROUTES = [
  '/projects',
  '/about',
  '/admin/users',
  '/server/server-admin-management',
  '/server/user-assignment',
  '/server/file-management',
  '/server/settings',
  '/server/telegram-config',
  '/server/health',
];
const PROJECT_ROUTES = [
  'dashboard',
  'cameras',
  'sites',
  'images',
  'live-feed',
  'insights/naive-occupancy',
  'insights/activity-overlap',
  'insights/deployment-timeline',
  'insights/map',
  'insights/confusion-matrix',
  'insights/per-class-performance',
  'notifications',
  'exports',
  'documents',
  'settings',
  'users',
  'manage-images',
  'bulk-upload',
];

function readEnvLocal() {
  const file = path.join(FRONTEND_DIR, '.env.local');
  if (!fs.existsSync(file)) return {};
  const vars = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !line.trim().startsWith('#')) vars[match[1]] = match[2];
  }
  return vars;
}

const env = { ...readEnvLocal(), ...process.env };
const BASE = env.SWEEP_BASE_URL || 'http://localhost:5173';

if (!env.SWEEP_EMAIL || !env.SWEEP_PASSWORD) {
  throw new Error('SWEEP_EMAIL and SWEEP_PASSWORD must be set, see .env.local notes in DEVELOPERS.md');
}

async function login() {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    body: new URLSearchParams({ username: env.SWEEP_EMAIL, password: env.SWEEP_PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`Login failed with status ${response.status}. Is vite running and are the credentials correct?`);
  }
  const data = await response.json();
  if (!data.access_token) throw new Error('Login response had no access_token');
  return data.access_token;
}

async function getProjectId(token) {
  if (env.SWEEP_PROJECT_ID) return env.SWEEP_PROJECT_ID;
  const response = await fetch(`${BASE}/api/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Could not list projects, status ${response.status}`);
  const projects = await response.json();
  if (!projects.length) throw new Error('Test account has no projects');
  return projects[0].id;
}

function slug(route) {
  return route.replace(/^\//, '').replace(/\//g, '_') || 'root';
}

async function main() {
  const token = await login();
  const projectId = await getProjectId(token);
  const routes = [
    ...PUBLIC_ROUTES,
    ...GLOBAL_ROUTES,
    ...PROJECT_ROUTES.map((r) => `/projects/${projectId}/${r}`),
  ];

  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const reportLines = [];
  const browser = await chromium.launch();

  for (const viewport of VIEWPORTS) {
    const dir = path.join(OUTPUT_DIR, viewport.name);
    fs.mkdirSync(dir);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      // Phone and tablet get touch so the app behaves as on a real device
      hasTouch: viewport.name !== 'desktop',
    });
    await context.addInitScript((t) => {
      window.localStorage.setItem('access_token', t);
    }, token);

    const page = await context.newPage();
    let consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));

    for (const route of routes) {
      consoleErrors = [];
      const name = `${viewport.name}/${slug(route)}`;
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(SETTLE_MS);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        );
        await page.screenshot({ path: path.join(dir, `${slug(route)}.png`), fullPage: true });
        const flags = [];
        if (overflow) flags.push('HORIZONTAL-OVERFLOW');
        if (consoleErrors.length) flags.push(`CONSOLE-ERRORS=${consoleErrors.length}`);
        reportLines.push(`${flags.length ? 'WARN' : 'ok  '} ${name}${flags.length ? '  ' + flags.join(' ') : ''}`);
        for (const error of consoleErrors) reportLines.push(`       ${error.slice(0, 300)}`);
      } catch (error) {
        reportLines.push(`FAIL ${name}  ${String(error).slice(0, 300)}`);
      }
    }
    await context.close();
  }

  await browser.close();
  const report = reportLines.join('\n') + '\n';
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.txt'), report);
  console.log(report);
  console.log(`Screenshots in ${OUTPUT_DIR}`);
  const problems = reportLines.filter((l) => !l.startsWith('ok')).length;
  console.log(problems ? `${problems} route/viewport combinations need a look` : 'all clean');
}

await main();
