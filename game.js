'use strict';

(() => {
  const W = 400, H = 600;
  const GRAVITY = 1200;
  const FLAP = -390;
  const MAXFALL = 480;
  const PIPE_SPEED = 150;
  const PIPE_W = 70;
  const PIPE_GAP = 160;
  const PIPE_SPACING = 240;
  const GROUND_H = 90;
  const BIRD = 36;
  const BIRD_X = 110;
  const SKY = '#87CEEB';
  const LETTERBOX = '#000';
  const GROUND_COLOR = '#d8c46a';
  const PIPE = '#5cbf3a';
  const PIPE_EDGE = '#3a8f25';
  const BIRD_EMOJI = '🐤';
  const MUTE_KEY = 'flippy-bird.muted';
  const BEST_KEY = 'flippy-bird.best';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const muteBtn = document.getElementById('mute');

  let state = 'title';
  let score = 0;
  let best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
  let muted = localStorage.getItem(MUTE_KEY) === '1';
  let birdY = H / 2;
  let vy = 0;
  let pipes = [];
  let scrollX = 0;
  let lastT = 0;

  const clouds = [
    { x: 60, y: 90, s: 34, v: 4 },
    { x: 230, y: 190, s: 28, v: 7 },
    { x: 330, y: 90, s: 40, v: 5 }
  ];

  function makePipe(x, gapY) {
    return { x: x, gapY: gapY, scored: false };
  }

  function randomGapY() {
    return 140 + Math.random() * (H - GROUND_H - 280);
  }

  function spawnPipes() {
    if (pipes.length === 0) {
      pipes.push(makePipe(W + 180, randomGapY()));
      return;
    }
    const last = pipes[pipes.length - 1];
    if (last.x < W - 20) {
      pipes.push(makePipe(Math.max(last.x + PIPE_SPACING, W + 20), randomGapY()));
    }
  }

  function syncMute() {
    muteBtn.hidden = state === 'playing';
  }

  function runReset() {
    score = 0;
    birdY = H / 2;
    vy = 0;
    pipes = [];
    scrollX = 0;
    state = 'playing';
    syncMute();
  }

  function hitGround() { return birdY >= H - GROUND_H - BIRD / 2; }

  function die() {
    state = 'dead';
    sfx.hit();
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
    }
  }

  function collide() {
    if (hitGround()) return true;
    const r = BIRD / 2;
    const bx = BIRD_X, by = birdY;
    for (const p of pipes) {
      if (bx + r < p.x || bx - r > p.x + PIPE_W) continue;
      const topBottom = p.gapY - PIPE_GAP / 2;
      const bottomTop = p.gapY + PIPE_GAP / 2;
      if (by - r < topBottom || by + r > bottomTop) return true;
    }
    return false;
  }

  function stepFrame(dt) {
    if (state === 'playing') {
      vy = Math.min(vy + GRAVITY * dt, MAXFALL);
      birdY += vy * dt;
      if (birdY <= BIRD / 2) { birdY = BIRD / 2; vy = Math.max(vy, 0); }
      for (const p of pipes) p.x -= PIPE_SPEED * dt;
      scrollX += PIPE_SPEED * dt;
      spawnPipes();
      for (const p of pipes) {
        if (!p.scored && p.x + PIPE_W < BIRD_X) {
          p.scored = true;
          score++;
          sfx.score();
        }
      }
      if (collide()) die();
    } else if (state === 'dead') {
      vy = Math.min(vy + GRAVITY * dt, MAXFALL);
      birdY += vy * dt;
      scrollX += PIPE_SPEED * dt;
      if (hitGround()) { state = 'gameover'; syncMute(); }
    } else if (state === 'title') {
      for (const c of clouds) c.x -= c.v * dt;
    }
    if (state !== 'dead') {
      for (const c of clouds) {
        c.x -= c.v * dt;
        if (c.x < -60) { c.x = W + 60; c.y = 40 + Math.random() * 200; }
      }
    }
  }

  const sfx = {
    ensure() {
      if (!this.actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.actx = new AC();
      }
      if (this.actx.state === 'suspended') this.actx.resume();
    },
    tone(f0, f1, dur, type, vol) {
      if (muted) return;
      const a = this.actx;
      if (!a) return;
      const t = a.currentTime;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(a.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    noise(dur, cutoff, vol) {
      if (muted) return;
      const a = this.actx;
      if (!a) return;
      const t = a.currentTime;
      const len = Math.max(1, Math.floor(a.sampleRate * dur));
      const buf = a.createBuffer(1, len, a.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = a.createBufferSource();
      src.buffer = buf;
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      const g = a.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(a.destination);
      src.start(t);
    },
    flap() { this.tone(500, 240, 0.09, 'triangle', 0.22); },
    score() { this.tone(660, null, 0.08, 'sine', 0.3); this.tone(880, null, 0.1, 'sine', 0.28); },
    hit() { this.noise(0.25, 900, 0.5); this.tone(180, 55, 0.3, 'sawtooth', 0.35); }
  };
  setTimeout(() => { if (muted) muteBtn.textContent = '🔇'; else muteBtn.textContent = '🔊'; }, 0);

  function input() {
    sfx.ensure();
    if (state === 'title') {
      runReset();
      return;
    }
    if (state === 'playing') {
      vy = FLAP;
      sfx.flap();
      return;
    }
    if (state === 'gameover') {
      runReset();
      return;
    }
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    input();
  });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) input();
    }
  });

  muteBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawWorld();
    if (state !== 'playing') drawOverlay();
  }

  function drawWorld() {
    ctx.fillStyle = LETTERBOX;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    const s = Math.min(canvas.width / W, canvas.height / H);
    const ox = (canvas.width - W * s) / 2;
    const oy = (canvas.height - H * s) / 2;
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.fillStyle = SKY;
    ctx.fillRect(0, 0, W, H);

    ctx.font = '30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of clouds) {
      ctx.globalAlpha = 0.85;
      ctx.fillText('☁️', c.x, c.y);
      ctx.globalAlpha = 1;
    }

    for (const p of pipes) drawPipe(p);

    drawGround();

    if (state === 'playing') {
      ctx.font = 'bold 42px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(String(score), W / 2, 70);
    }

    if (state !== 'title') {
      ctx.save();
      ctx.translate(BIRD_X, birdY);
      const ang = Math.max(-0.5, Math.min(1.1, (vy / MAXFALL) * 1.1));
      ctx.rotate(ang);
      ctx.scale(-1, 1);
      ctx.font = BIRD + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(BIRD_EMOJI, 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawPipe(p) {
    const half = PIPE_GAP / 2;
    ctx.fillStyle = PIPE;
    ctx.fillRect(p.x, -20, PIPE_W, p.gapY - half + 20);
    ctx.fillRect(p.x, p.gapY + half, PIPE_W, H - GROUND_H - (p.gapY + half));
    ctx.fillStyle = PIPE_EDGE;
    ctx.fillRect(p.x, p.gapY - half - 4, PIPE_W, 24);
    ctx.fillRect(p.x, p.gapY + half - 20, PIPE_W, 24);
  }

  function drawGround() {
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, H - GROUND_H, W, GROUND_H);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 3;
    const off = scrollX % 26;
    ctx.beginPath();
    for (let x = -off; x < W + 26; x += 26) {
      ctx.moveTo(x, H - GROUND_H + 14);
      ctx.lineTo(x + 14, H - GROUND_H + 8);
    }
    ctx.stroke();
  }

  function drawOverlay() {
    ctx.save();
    const s = Math.min(canvas.width / W, canvas.height / H);
    const ox = (canvas.width - W * s) / 2;
    const oy = (canvas.height - H * s) / 2;
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, H / 2 - 130, W, 260);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (state === 'title') {
      ctx.fillText('flippy-bird', W / 2, H / 2 - 70);
      ctx.font = '56px sans-serif';
      ctx.save();
      ctx.translate(W / 2, H / 2 - 6);
      ctx.scale(-1, 1);
      ctx.fillText(BIRD_EMOJI, 0, 0);
      ctx.restore();
      ctx.font = '18px sans-serif';
      ctx.fillStyle = '#e8f4ff';
      ctx.fillText('tap, click, or press space', W / 2, H / 2 + 56);
    } else if (state === 'gameover') {
      ctx.font = 'bold 38px sans-serif';
      ctx.fillText('game over', W / 2, H / 2 - 80);
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('score ' + score, W / 2, H / 2 - 24);
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#ffe28a';
      ctx.fillText('best ' + best, W / 2, H / 2 + 18);
      ctx.fillStyle = '#e8f4ff';
      ctx.fillText('tap to restart', W / 2, H / 2 + 66);
    }
    ctx.restore();
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function loop(t) {
    const dt = Math.min(0.033, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    stepFrame(dt);
    draw();
    requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener('resize', resize);
  syncMute();
  requestAnimationFrame(function (t) { lastT = t; requestAnimationFrame(loop); });

  window.__flippy = {
    get state() { return state; },
    get score() { return score; },
    get best() { return best; },
    get birdY() { return birdY; },
    get pipes() { return pipes; },
    get muted() { return muted; },
    spawnPipe: function (x, gapY) { pipes.push(makePipe(x, gapY)); },
    clearPipes: function () { pipes.length = 0; },
    setPipeX: function (i, x) { pipes[i].x = x; },
    setBirdY: function (y) { birdY = y; },
    step: stepFrame,
    reset: runReset,
    draw: draw
  };
})();