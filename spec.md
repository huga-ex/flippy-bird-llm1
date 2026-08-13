# flippy-bird — demo spec

A cross-platform-to-mobile single-page **flippy-bird web/PWA demo**, built as one measured agent build run. This spec is the contract that build runs against. Everything below is settled; the build may **tune constants by up to ±20%** for feel, but must not change the structure.

## 1. Tech

- **Canvas 2D** game loop with requestAnimationFrame; DOM only for the page shell and buttons.
- No frameworks, no external assets, no network dependencies at runtime. Emoji and geometry drawn programmatically; any image asset (icons) generated at build time.
- HTTP server required to serve it (file:// blocks SW and some canvas font behavior). Use a local static server (e.g. `npx serve .` or `python3 -m http.server`).

## 2. Files

```
index.html          single page shell; links manifest, registers sw
styles.css          full-viewport canvas, centered card, fonts
game.js             all game logic, rendering, audio
manifest.webmanifest
sw.js               offline app-shell cache
icon-192.png        generated at build time
icon-512.png        generated at build time
```

## 3. Game design

- **Theme**: classic bird-and-pipes over a sky. Bird is the **🐤** emoji drawn via `ctx.fillText` (centered, ~36px logical), tilted by velocity: about −30° while rising to +90° while falling.
- **Pipes**: flat green geometry (solid fill with a lighter highlight edge and darker rim), 70px wide, drawn per column pair.
- **Ground**: flat brown/tan scrolling strip at the bottom, ~90px tall, subtle dark texture lines scrolling at pipe speed.
- **Sky**: light blue; slow-drifting ☁️ emoji accents in the background.
- **World**: fixed portrait logical world **400×600**, scaled to fit the viewport (letterboxed, centered), with `devicePixelRatio` capping for crispness. No rotate lock.

### Physics constants (defaults, tunable ±20%)

| Quantity | Value |
|---|---|
| Logical world | 400×600 |
| Gravity | 1200 px/s² |
| Flap impulse | −390 px/s (upward) close to instant velocity set |
| Max fall speed | 480 px/s |
| Pipe scroll speed | 150 px/s |
| Pipe width | 70 px |
| Pipe gap | 160 px (≈4.4 bird-heights at 36px) |
| Pipe pair spacing (x) | 240 px |
| Ground height | 90 px |
| Bird size | 36×36 |

### Rules

- Score = pipes passed; increments once per pipe once its right edge passes the bird's x.
- Game over on collision with a pipe or the ground. Ceiling caps rise (no death on ceiling).
- Collision as AABB between bird rect and pipe rects / ground band.
- Classic single-life; no pause.

## 4. Screens & flow

1. **TITLE** — "flippy-bird" (system font stack, bold), 🐤 above it, hint "tap, click, or press space", mute toggle top-right. Tap/click/space → PLAYING.
2. **PLAYING** — score counter top-center; bird flaps on each tap/click/space; silent after bird death (visual tumble) then → GAMEOVER.
3. **GAMEOVER** — dark overlay panel: final score, "best: N", mute toggle, "tap to restart". Tap/click/space → TITLE→ instant restart (PLAYING).

Mute toggle buttons are the only DOM controls drawn over the canvas.

## 5. Controls

- Flap on **touch tap anywhere** on canvas **or mouse click** **or space bar** — one flap mapped to one physical input; holding does not repeat.
- The same inputs advance title and game-over screens.

## 6. Audio (WebAudio, procedural — no files)

- **Flap**: short noise-filtersweep "whoosh".
- **Score**: two-note rising ding.
- **Hit**: low thud/tumble.
- Autoplay-safe: audio context created/resumed on the first user input.
- **Mute**: sound-on **by default**; toggle on TITLE and GAMEOVER; persisted in localStorage so muted state survives reloads.

## 7. Persistence

- localStorage `flippy-bird.best` = best score, read at game over to display "best"; written when a run's score exceeds it.

## 8. PWA

- `manifest.webmanifest`: name **flippy-bird**, `display: standalone`, `start_url: ./`, theme/background colors and both icons (192/512). Referenced from `<head>`.
- `sw.js`: precache app shell on install; cache-first, network-fallback-on-failure; versioned cache id; register from `index.html`. After first load the game must work fully offline.
- Icons are generated at build time by `scripts/make-icons.mjs` — a dependency-free pure-node PNG encoder rasterizing a geometric bird on a colored square (no external art). The 🐤 emoji rendering path is unavailable because no browser canvas exists on the build machine.

## 9. Acceptance (definition of done)

Verification is split between the agent build run and the user, because browser-level automation on the build machine is unusable (Chromium crashes; safaridriver lacks touch/console/offline emulation). 

**Agent-side (node-logic checks + artifacts):**

- [ ] `scripts/check-logic.mjs` runs headless in node: loads `game.js` with DOM/canvas/audio/localStorage stubs and passes checks for state machine (title → playing → dead → gameover), physics (flap impulse, gravity, max-fall clamp), scoring (increment on pipe pass), collisions (pipe + ground), and best/mute persistence logic.
- [ ] Manifest linked and valid; `sw.js` references existing `icon-192.png`/`icon-512.png`; both icons present on disk at build time.

**User-side (on the deployed URL, real devices — desktop in 04):**

- [ ] Runs on a local static server with zero console errors.
- [ ] Title → play → game-over cycle works with click and space (desktop) and touch (phone).
- [ ] Bird flips, flaps, scores, dies correctly per the physics above.
- [ ] Sound effects audible and mute toggle persists.
- [ ] Best score persists across reloads.
- [ ] Service worker registered and the app **loads from cache with network disabled**.

## 10. Metrics

This build is a **single opencode session** (one run). Afterwards, capture the run record from `~/.local/share/opencode/opencode.db` (`parent_id IS NULL AND path='Users/Shared/llm_workspace/flippy-bird'`) per the resolved metric ticket and write `run-report.md` in the repo.