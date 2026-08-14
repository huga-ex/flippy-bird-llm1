'use strict';

// Browser-level verification for flippy-bird via headless Chrome (CDP).
// Chrome works from this shell (Chromium headless renders fine); this is the
// Chrome equivalent of verify-safari.mjs.
//
// Usage:
//   python3 -m http.server 8000                     # serve index.html
//   <chrome> --headless --remote-debugging-port=9222 --user-data-dir=/tmp/fp
//   node scripts/verify-chrome.mjs [cdpPort]

import { writeFileSync } from 'node:fs';

const PORT = Number(process.argv[2] ?? process.env.CDP_PORT ?? 9222);
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:8000/index.html';
const OUT_DIR = 'verify';
const results = [];

function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  ' + JSON.stringify(extra)));
}

const json = (r) => r.json();
const targets = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' }).then(json);
const wsUrl = targets.webSocketDebuggerUrl;

const ws = new WebSocket(wsUrl);
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

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await new Promise((res) => (ws.onopen = res));

async function exec(script) {
  const body = script.includes('return') ? `(() => { ${script} })()` : `(() => (${script}))()`;
  const r = await send('Runtime.evaluate', { expression: body, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: APP_URL });

  let boot = null;
  for (let i = 0; i < 40; i++) {
    boot = await exec('window.__flippy ? { ok: true, state: window.__flippy.state } : { ok: false }');
    if (boot?.ok) break;
    await new Promise((res) => setTimeout(res, 250));
  }
  check('__flippy test hooks present', boot?.ok === true);
  check('initial state is title', boot?.state === 'title', { state: boot?.state });

  const start = await exec(
    "window.__flippy.reset(); document.querySelector('#game').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); return { state: window.__flippy.state }"
  );
  check('pointerdown starts the game', start?.state === 'playing', { state: start?.state });

  const flap = await exec(
    "var y0 = window.__flippy.birdY; window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'})); window.__flippy.step(1/60); return { y0: y0, y1: window.__flippy.birdY, state: window.__flippy.state }"
  );
  check('space bar flaps the bird', flap?.state === 'playing' && flap?.y1 < flap?.y0, flap);

  const score = await exec(
    "var p = window.__flippy; p.clearPipes(); p.spawnPipe(46, 300); p.step(0.001); p.step(0.2); return { score: p.score, pipes: p.pipes.length }"
  );
  check('score increments as a pipe passes', score?.score >= 1, { score: score?.score });

  const errs = await exec(
    "window.__errs = window.__errs || []; if (!window.__errHook) { window.__errHook = true; var _e = console.error; console.error = function(){ window.__errs.push(Array.prototype.slice.call(arguments).join(' ')); _e.apply(null, arguments); }; } return { count: window.__errs.length }"
  );
  check('zero console errors so far', errs?.count === 0, { count: errs?.count });

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (typeof shot?.data === 'string' && shot.data.length > 0) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}/verify-chrome.png`, Buffer.from(shot.data, 'base64'));
    console.log(`INFO  screenshot -> ${OUT_DIR}/verify-chrome.png`);
  } else {
    check('screenshot captured', false, {});
  }
} finally {
  ws.close();
  try {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${targets.id}`);
  } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} browser checks passed (${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
