## Image analysis

I can't view images directly, but I can analyze them via `read` (attachments), `sips` (metadata/resize), `tesseract` (OCR), `ffmpeg` (frames/pixels), `file` (format), and raw `python3`; pixel-diff libraries (pixelmatch/sharp) aren't installed.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues on `huga-ex/flippy-bird-llm1`, operated through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix), each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` at the repo root, ADRs under `docs/adr/`. See `docs/agents/domain.md`.

### Browser automation & rendering

When asked about browser auto-testing, rendering, or headless verification, read `docs/suspicions/lightpanda-no-render.md` first — it records why Lightpanda can't render flippy-bird or Godot web exports, and that safaridriver is the working path.
