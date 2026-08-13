'use strict';

// Browser-level verification for flippy-bird via safaridriver (W3C WebDriver).
// Chromium cannot run on this machine under the headless llmagent account
// (macOS 14+ WindowManagement XPC crash + no gui/504 launchd domain); Safari
// WebDriver is the supported browser-automation path (see global AGENTS.md).
//
// Usage:
//   safaridriver --port 4444          # in another shell, as a user with a GUI
//   python3 -m http.server 8000       # or any static server for index.html
//   node scripts/verify-safari.mjs [baseUrl]

import { writeFileSync } from 'node:fs';

const BASE = process.env.SAFARI_WD_BASE ?? 'http://127.0.0.1:4444';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:8000/index.html';
const OUT_DIR = 'verify';
const results = [];

function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  ' + JSON.stringify(extra)));
}

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, body: data };
}
async function get(path) {
  const r = await fetch(BASE + path);
  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, body: data };
}

const created = await post('/session', {
  capabilities: { alwaysMatch: { browserName: 'safari' } },
});
const sessionId = created.body?.value?.sessionId;
if (!sessionId) {
  console.error('NO SESSION — safaridriver not usable. Is `safaridriver --port 4444` running?');
  process.exit(1);
}

const deleteSession = () =>
  fetch(`${BASE}/session/${sessionId}`, { method: 'DELETE' }).catch((e) => console.warn('session delete failed:', e.message));

const exec = (script) => post(`/session/${sessionId}/execute/sync`, { script, args: [] });

try {
  const nav = await post(`/session/${sessionId}/url`, { url: APP_URL });
  check('navigate to app', nav.status === 200, { status: nav.status });

  const title = await get(`/session/${sessionId}/title`);
  check('title matches', title.body?.value === 'flippy-bird', { got: title.body?.value });

  const boot = await exec('return window.__flippy ? { ok: true, state: window.__flippy.state } : { ok: false }');
  const bootVal = boot.body?.value;
  check('__flippy test hooks present', bootVal?.ok === true);
  check('initial state is title', bootVal?.state === 'title', { state: bootVal?.state });

  const start = await exec(
    "window.__flippy.reset(); document.querySelector('#game').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); return { state: window.__flippy.state }"
  );
  check('pointerdown starts the game', start.body?.value?.state === 'playing', { state: start.body?.value?.state });

  const flap = await exec(
    "var y0 = window.__flippy.birdY; window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'})); window.__flippy.step(1/60); return { y0: y0, y1: window.__flippy.birdY, state: window.__flippy.state }"
  );
  const flapVal = flap.body?.value;
  check('space bar flaps the bird', flapVal?.state === 'playing' && flapVal?.y1 < flapVal?.y0, flapVal);

  const score = await exec(
    "var p = window.__flippy; p.clearPipes(); p.spawnPipe(46, 300); p.step(0.001); p.step(0.2); return { score: p.score, pipes: p.pipes.length }"
  );
  check('score increments as a pipe passes', score.body?.value?.score >= 1, { score: score.body?.value?.score });

  const errs = await exec(
    "window.__errs = window.__errs || []; if (!window.__errHook) { window.__errHook = true; var _e = console.error; console.error = function(){ window.__errs.push(Array.prototype.slice.call(arguments).join(' ')); _e.apply(null, arguments); }; } return { count: window.__errs.length }"
  );
  check('zero console errors so far', errs.body?.value?.count === 0, { count: errs.body?.value?.count });

  const shot = await get(`/session/${sessionId}/screenshot`);
  const b64 = shot.body?.value;
  if (typeof b64 === 'string' && b64.length > 0) {
    const fs = await import('node:fs');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}/verify-safari.png`, Buffer.from(b64, 'base64'));
    console.log(`INFO  screenshot -> ${OUT_DIR}/verify-safari.png`);
  } else {
    check('screenshot captured', false, { status: shot.status });
  }
} finally {
  await deleteSession();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} browser checks passed (${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
