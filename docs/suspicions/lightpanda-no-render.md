# Suspicion: Lightpanda cannot serve as the render/verify path for flippy-bird or Godot web exports

Status: **hypothesis, not yet empirically tested** (Lightpanda not installed on this machine). Evidence is from source inspection of `lightpanda-io/browser@main`. The one-line test to confirm: build/run Lightpanda under the `llmagent` account and load the game, then a Godot web export.

## 1. Lightpanda has no rendering engine — by design

Lightpanda's own docs describe it as a browser "without a graphical rendering engine." For automation/AI purposes this is a feature (no GPU, tiny footprint, runs on EC2). For anything that must actually *paint pixels*, it's an immediate disqualifier. The source confirms it:

- **Canvas 2D is a no-op stub** — `src/browser/webapi/canvas/CanvasRenderingContext2D.zig` defines the full API shape but every drawing method has an empty body:

  ```zig
  pub fn clearRect(_: *CanvasRenderingContext2D, _: f64, _: f64, _: f64, _: f64) void {}
  pub fn fillRect(_: *CanvasRenderingContext2D, _: f64, _: f64, _: f64, _: f64) void {}
  pub fn fillText(_: *CanvasRenderingContext2D, _: []const u8, _: f64, _: f64, _: ?f64) void {}
  pub fn save(_: *CanvasRenderingContext2D) void {}
  pub fn translate(_: *CanvasRenderingContext2D, _: f64, _: f64) void {}
  pub fn fill(_: *CanvasRenderingContext2D) void {}
  ```

  Only *state* is real (fillStyle parses/stores a color; font/globalAlpha etc. are template properties). Nothing is rasterized — there is no pixel buffer behind the canvas.

- **WebGL is even less real** — `WebGLRenderingContext.zig` stubs only `getParameter` (returns `""`), `getExtension`, `getSupportedExtensions`. And crucially, **`getContext('webgl')` returns `null`**, by deliberate design:

  > "Pretending WebGL works until the first non-stubbed call is the worst of both worlds... Spec-correct signal for 'no WebGL' is null, so apps that check (Three.js does) can degrade gracefully."

  `webgl2` isn't handled at all — also `null`.

- **Screenshots are fake** — `src/cdp/domains/page.zig:973` returns `@embedFile("screenshot.png")`, a fixed 1920×1080 placeholder baked into the binary. Not a capture of the page.

- **No WebAudio** — `media/` contains only `MediaError`, `TextTrackCue`, `VTTCue`. No `AudioContext`.

## 2. Why flippy-bird specifically doesn't fit

flippy-bird renders with Canvas 2D (`ctx.fillRect`, `ctx.fillText`, `translate`, etc. — see `game.js`) and synthesizes audio with WebAudio.

- **Rendering:** the game would boot under Lightpanda — `getContext('2d')` returns a context object, and the no-op methods don't throw. The `window.__flippy` test hooks would report state correctly (they read JS properties). But the canvas would be permanently blank. A "successful" verify run would be **vacuous** — logic passes, zero pixels rendered.
- **Screenshot check:** `verify-safari.mjs` treats the screenshot as evidence of rendering. Lightpanda would return the *same placeholder image every run*, so that step becomes meaningless rather than failing.
- **Audio:** game.js:136 guards `if (!AC) return;` so missing AudioContext doesn't crash — it just silently mutes. Silent false pass again.
- **Protocol:** the script speaks W3C WebDriver to port 4444; Lightpanda speaks CDP/WebSocket on 9222. Not a drop-in even before rendering is considered.

Net: Lightpanda could *falsely* green a logic-only harness while rendering nothing — the opposite of what a browser verification is for.

## 3. Why Godot web exports don't fit — worse than flippy-bird

A Godot web export is a different beast: the **entire engine compiled to WASM** that drives the canvas through the WebGL API (Godot 4 web uses WebGL2, `gl_compatibility` renderer; audio via WebAudio).

- **First failure is at `getContext` itself.** Godot's runtime calls `canvas.getContext('webgl2')` (or `webgl`). Lightpanda returns **null** for both. Godot's initialization code checks for a valid context and errors out / refuses to start — the engine never even boots. This is not "bad rendering," it's "no renderer at all."
- **Even if a context were handed out**, the stub lacks `createTexture`, `createBuffer`, `createShader`, etc. — the Canvas.zig comment notes real consumers throw `TypeError: e.createTexture is not a function` on the first non-stubbed call.
- **The 2D fallback doesn't save it.** Godot web exports don't have a Canvas-2D rendering path; 2D games still go through WebGL. And Lightpanda's 2D canvas is a no-op anyway.
- **Screenshot/audio gaps** apply identically: fake screenshot, no WebAudio (Godot's WebAudio output would be missing).

So the severity ordering is:

- flippy-bird: **runs silently, renders nothing** (dangerous — false-positive verification).
- Godot web export: **refuses to start** (clear failure, but complete non-starter).

## 4. What this means for the Chromium-blocked machine

Lightpanda genuinely sidesteps the macOS 14+ AppKit/WindowManagement crash (it's Zig, links only CoreFoundation+SystemConfiguration, no AppKit) — so it's a valid headless *JS/DOM* runtime under `llmagent`. But it is not a *browser rendering* substitute for either of these workloads. The working verification path for flippy-bird remains **safaridriver**; for a future Godot web game, the same answer would need to be evaluated (Safari is the only real renderer available to this account today).

## Evidence references

- `CanvasRenderingContext2D.zig` (no-op draw methods, real-only state)
- `WebGLRenderingContext.zig` (only 3 stubbed methods)
- `Canvas.zig getContext` (returns null for webgl/experimental-webgl; the comment explains why)
- `page.zig:973 captureScreenshot` (`// Return a fake screenshot`, embedded PNG)
- `media/` listing (no AudioContext)
