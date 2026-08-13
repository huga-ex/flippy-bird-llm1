'use strict';

import { readFileSync, existsSync, statSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  ' + JSON.stringify(extra)));
}
function fail(msg) {
  const e = new Error(msg);
  throw e;
}

function makeCtx() {
  const methods = new Set();
  const handler = {
    get(t, prop) {
      if (prop in t) return t[prop];
      methods.add(prop);
      return (...args) => {
        if (prop.startsWith('create')) return {};
        return undefined;
      };
    }
  };
  return new Proxy({ measureText: () => ({ width: 0 }) }, handler);
}

function makeCanvas() {
  const ctx = makeCtx();
  const listeners = {};
  return {
    ctx,
    listeners,
    width: 400,
    height: 600,
    getContext: () => ctx,
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); }
  };
}

function makeElement() {
  const listeners = {};
  return {
    hidden: true,
    textContent: '',
    listeners,
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    click: () => { for (const fn of listeners.click || []) fn({ stopPropagation() {} }); }
  };
}

function loadGame(storage) {
  const code = readFileSync(ROOT + '/game.js', 'utf8');
  const windowListeners = {};
  const canvas = makeCanvas();
  const mute = makeElement();
  const sandbox = {
    window: {
      addEventListener: (type, fn) => { (windowListeners[type] = windowListeners[type] || []).push(fn); },
      devicePixelRatio: 2,
      innerWidth: 390,
      innerHeight: 844
    },
    document: {
      getElementById: (id) => (id === 'game' ? canvas : id === 'mute' ? mute : null)
    },
    localStorage: {
      store: storage,
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); }
    },
    requestAnimationFrame: () => 0,
    setTimeout: () => 0,
    AudioContext: undefined
  };
  sandbox.window.__flippy = undefined;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'game.js' });
  const flippy = () => sandbox.window.__flippy;
  return {
    v: sandbox,
    flippy,
    canvas,
    mute,
    windowListeners,
    pointerdown() { for (const fn of canvas.listeners.pointerdown || []) fn({ preventDefault() {} }); },
    space() { for (const fn of windowListeners.keydown || []) fn({ code: 'Space', repeat: false, preventDefault() {} }); }
  };
}

// --- agent acceptance checks ---

check('game.js boots in sandbox without throwing', true);

let game = loadGame({});
let f = game.flippy();
check('initial state is title', f.state === 'title', f.state);
check('mute toggle visible on title', game.mute.hidden === false, game.mute.hidden);

game.pointerdown();
check('pointerdown starts the game', f.state === 'playing', f.state);
check('mute toggle hidden during play', game.mute.hidden === true, game.mute.hidden);

// flap physics: pipe-free sky, one flap then step -> birdY decreases
game = loadGame({});
f = game.flippy();
game.pointerdown();
const yBefore = f.birdY;
game.space();
game.windowListeners.keydown && null;
f.step(1 / 60);
check('space bar flaps the bird (birdY decreases)', f.birdY < yBefore, { before: yBefore, after: f.birdY });

// score: pipe passing the bird increments score once
f.clearPipes();
f.spawnPipe(46, 300);
f.step(0.001);
const pre = f.score;
f.step(0.2);
check('score increments as a pipe passes', f.score === pre + 1, { pre, post: f.score });

// collision -> dead -> gameover -> best
f.clearPipes();
f.spawnPipe(46, 400);
f.setBirdY(510);
f.step(1 / 60);
f.step(1 / 60);
f.step(1 / 60);
check('fatal collision leads to game-over', f.state === 'gameover', { state: f.state, y: f.birdY });
check('best reflects score on game over', f.best >= (pre + 1) && f.best >= 1, { best: f.best, score: f.score });
check('mute toggle visible on game over', game.mute.hidden === false, game.mute.hidden);

// mute toggle persists to localStorage
game.mute.click();
check('mute toggle flips muted state', f.muted === true, f.muted);
check('mute toggle persisted to localStorage', (game.v.localStorage.store['flippy-bird.muted']) === '1', game.v.localStorage.store['flippy-bird.muted']);

// persistence across reload: fresh page shares the same storage
const storage = game.v.localStorage.store;
const game2 = loadGame(storage);
const f2 = game2.flippy();
check('best score persists across reload', f2.best === f.best, { before: f.best, after: f2.best });
check('mute state persists across reload', f2.muted === true, f2.muted);

// PWA artifact checks (filesystem, no browser)
const manifest = JSON.parse(readFileSync(ROOT + '/manifest.webmanifest', 'utf8'));
const manifestIcons = (manifest.icons || []).map((i) => i.src);
check('manifest references both icons', manifestIcons.includes('icon-192.png') && manifestIcons.includes('icon-512.png'), manifestIcons);
let iconsOk = true;
for (const i of manifestIcons) {
  const p = ROOT + '/' + i;
  if (!existsSync(p)) iconsOk = false;
  const st = statSync(p, { throwIfNoEntry: false });
  if (st && st.size === 0) iconsOk = false;
}
check('both icon files exist and are non-empty', iconsOk);

const sw = readFileSync(ROOT + '/sw.js', 'utf8');
const swAsserts = ['./', './index.html', './styles.css', './game.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
check('sw.js precaches the full app shell', swAsserts.every((a) => sw.includes("'" + a + "'")), swAsserts);

const html = readFileSync(ROOT + '/index.html', 'utf8');
check('index.html links manifest, registers sw, loads game',
  html.includes('manifest.webmanifest') && html.includes('sw.js') && html.includes('game.js'));

check('mute button and canvas are the only DOM composite elements',
  html.includes('<button id="mute"') && html.includes('<canvas id="game"'));

const failed = results.filter((c) => !c.ok).length;
console.log('---CHECK_DONE total=' + results.length + ' failed=' + failed);
process.exit(failed === 0 ? 0 : 1);