'use strict';

// Browser-level verification of the flippy-bird service worker freshness fix
// (issue #7): after the served build changes, a NORMAL refresh must serve the
// new build (network-first), while offline-from-cache still works.
//
// Drives headless Chrome over CDP. Chrome must be able to run (PATH2 GUI login;
// see docs/suspicions/lightpanda-no-render.md and global AGENTS.md).
//
// Usage:
//   node scripts/verify-sw.mjs
//   CHROME_BIN=... HTTP_PORT=8901 CDP_PORT=9223 node scripts/verify-sw.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8901);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9223);
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = `http://127.0.0.1:${HTTP_PORT}/index.html`;
const MARKER = '__SW_FRESH_BUILD__';

const APP_FILES = ['index.html', 'styles.css', 'game.js', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  ' + JSON.stringify(extra)));
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function waitFor(fn, label, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for ' + label);
    await sleep(250);
  }
}

const stageDir = mkdtempSync(join(tmpdir(), 'fp-sw-'));
const profileDir = join(stageDir, 'chrome-profile');
mkdirSync(profileDir, { recursive: true });
for (const f of APP_FILES) copyFileSync(join(ROOT, f), join(stageDir, f));

const CACHE = readFileSync(join(stageDir, 'sw.js'), 'utf8').match(/const CACHE = '([^']+)'/)?.[1] ?? 'flippy-bird-v2';

const httpServer = spawn('python3', ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1'], {
  cwd: stageDir,
  stdio: 'ignore',
});
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

function cleanup() {
  try { rmSync(stageDir, { recursive: true, force: true }); } catch {}
  try { chrome.kill('SIGKILL'); } catch {}
  try { httpServer.kill('SIGKILL'); } catch {}
}
process.on('exit', cleanup);

const json = (r) => r.json();

try {
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${HTTP_PORT}/index.html`)).status === 200;
    } catch { return false; }
  }, 'http server');

  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok; } catch { return false; }
  }, 'chrome cdp');

  const target = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' }).then(json);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let msgId = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  };
  await new Promise((res) => (ws.onopen = res));
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const exec = async (script) => {
    const r = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  const navigate = (url) => send('Page.navigate', { url });
  const reload = () => send('Page.reload', { ignoreCache: false });
  const boot = () => exec('window.__flippy ? window.__flippy.state : null');
  const controller = () => exec('navigator.serviceWorker.controller ? true : false');
  const swState = () => exec('navigator.serviceWorker.getRegistration().then(r => (r && r.active && r.active.state) || null)');
  const gameText = () => exec('fetch("game.js").then(r => r.text())');

  await send('Runtime.enable');
  await send('Page.enable');

  // --- stage A: first build. Load, let the SW register and claim. ---
  await navigate(APP_URL);
  await waitFor(() => boot().then((s) => s === 'title'), 'first boot');
  const ready = await waitFor(() => swState().then((s) => (s === 'activated' ? s : null)), 'sw activated');
  check('service worker installs and activates', ready === 'activated', ready);

  await reload();
  await waitFor(() => boot().then((s) => s === 'title'), 'reload boot');
  await waitFor(() => controller().then((c) => c === true), 'page controlled by sw');
  check('normal reload is served through the service worker', true);

  const cacheHasShell = await exec(
    `caches.open('${CACHE}').then(c => c.match('game.js')).then(r => r ? r.text() : null)`
  );
  check('sw precaches the app shell into the cache', typeof cacheHasShell === 'string' && cacheHasShell.length > 0);

  const stageA = await gameText();
  check('stage A game.js does not carry the marker yet', typeof stageA === 'string' && !stageA.includes(MARKER));

  // --- stage B: "new build" — swap the served game.js, normal refresh. ---
  const newGame = readFileSync(join(stageDir, 'game.js'), 'utf8') + `\n// ${MARKER}\n`;
  writeFileSync(join(stageDir, 'game.js'), newGame);

  await reload();
  await waitFor(() => boot().then((s) => s === 'title'), 'stage B boot');
  await waitFor(() => controller().then((c) => c === true), 'stage B controlled');

  const stageB = await gameText();
  check('normal refresh serves the NEW build (no hard refresh)', typeof stageB === 'string' && stageB.includes(MARKER), {
    servedFresh: typeof stageB === 'string' ? stageB.includes(MARKER) : false,
  });

  // --- offline: server down, app still boots from cache. ---
  httpServer.kill('SIGKILL');
  await sleep(300);
  await navigate(APP_URL);
  const offlineBoot = await waitFor(() => boot().then((s) => (s === 'title' ? s : null)), 'offline boot from cache');
  check('app still boots from cache when offline', offlineBoot === 'title', offlineBoot);
} catch (err) {
  check('verification completed without harness errors', false, { error: String(err) });
} finally {
  await sleep(50);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} service-worker checks passed (${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
