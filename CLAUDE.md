# Shutterside — Localhost Image Editor

## Overview

Shutterside is a local-first browser image editor backed by a Flask API. Users load a PNG or JPG, apply non-destructive adjustments (brightness, contrast, saturation, warmth, grayscale), crop, correct perspective, remove backgrounds via a U2Net model, and export as PNG or JPG. All processing happens on localhost — no files leave the machine.

## Quick start

```bash
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt
python app.py               # http://127.0.0.1:5000
```

The U2Net model (`models/u2netp.onnx`) downloads automatically on first background-removal request.

## Project structure

```
imageTool/
├── app.py              # Flask routes — thin handlers: parse, delegate, respond
├── image_ops.py        # Pure image processing (no Flask, no HTTP)
├── sessions.py         # SessionStore class — create, delete, expire temp files
├── requirements.txt
├── models/             # ONNX model weights (gitignored, auto-downloaded)
├── tmp/                # Ephemeral session binaries (auto-cleaned)
├── templates/
│   └── index.html      # Single-page HTML shell
└── static/
    ├── app.js          # DOM refs, UI functions, event wiring, rendering
    ├── api.js          # All fetch() calls to the backend
    ├── commands.js     # User actions (crop, perspective, export, bg removal)
    ├── workspace.js    # Shared state, history, edit-state management
    ├── histogram.js    # Histogram computation and canvas drawing
    └── style.css
```

## Architecture

### Backend (Python)

Three layers with a strict dependency direction:

```
app.py  →  image_ops.py   (pure functions, no I/O beyond bytes in / bytes out)
        →  sessions.py    (file I/O scoped to tmp/)
```

- **app.py** owns Flask, request parsing, data-URL encoding/decoding, and JSON responses. Route handlers should stay thin: decode input, call a service function, encode output.
- **image_ops.py** contains all image processing: encoding (JPEG/PNG), format conversion, perspective warping, background removal. Functions accept and return `bytes`, `np.ndarray`, or `PIL.Image` — never Flask objects.
- **sessions.py** encapsulates temp-file lifecycle in a `SessionStore` class with thread-safe locking and TTL-based expiry.

### Frontend (JavaScript ES modules)

```
app.js  →  commands.js  →  api.js
        →  workspace.js
        →  histogram.js
```

- **app.js** is the entry point (`type="module"`). It owns all DOM references, UI functions (status, busy, zoom, overlays), event listeners, and rendering. It injects UI callbacks into `commands.js` via `injectUI()` to avoid circular dependencies.
- **commands.js** contains user-facing actions (crop, perspective, export, background removal, file loading). Repeated patterns use `runServerOperation()` to eliminate duplication. Depends on `api.js` for fetch calls and `workspace.js` for state.
- **api.js** is the sole location for all `fetch()` calls. Every backend endpoint has exactly one corresponding function here.
- **workspace.js** holds the shared `state` object, history (undo/redo), edit-state management, and session helpers.
- **histogram.js** handles histogram bin computation, clipping detection, and canvas drawing. Pure data-in / draw-out — no DOM state.

## Conventions

### Single Responsibility

Every function and module has one job. This is the core design principle of the codebase.

- Route handlers parse input, delegate to a service, return a response. No image math in routes.
- `image_ops.py` functions never touch Flask, HTTP, or the filesystem (except through bytes).
- Frontend `api.js` only does fetch calls — no DOM, no state mutation.
- `commands.js` orchestrates (state + API + UI callbacks) but does not own DOM references.
- If a new function does two things, split it. If a shared pattern emerges, extract a helper (see `runServerOperation` as the model).

### Python

- Type hints on all function signatures.
- German user-facing error messages (the UI is in German).
- Image functions accept/return `bytes`, `np.ndarray`, or `PIL.Image` — not data URLs or JSON.
- Data-URL encoding/decoding lives only in `app.py` (the HTTP boundary).
- Optional dependencies (`cv2`, `rembg`) are guarded with try/except at import time and raise clear `RuntimeError` messages if used when missing.

### JavaScript

- ES modules (`import`/`export`) — no bundler, no globals.
- Shared state lives in `workspace.js` as a single `state` object. Do not create parallel state elsewhere.
- UI callbacks are injected into `commands.js` via `injectUI()`. This keeps the dependency graph acyclic: `commands.js` never imports from `app.js`.
- History changes go through `pushHistory()` / `stepHistory()` / `resetHistory()`.
- Use `scheduleRender()` (requestAnimationFrame) instead of calling `renderPreview()` directly.
- Export estimates are debounced via `scheduleExportEstimate()`.

### Adding a new feature

1. **New image operation**: add a pure function to `image_ops.py`. Write a thin route in `app.py` that decodes input, calls the function, encodes output.
2. **New API endpoint**: add the `fetch` wrapper in `api.js`. Add the user-facing command in `commands.js` using `runServerOperation()` if it follows the busy-bake-fetch-reload pattern. Wire the button in `app.js`.
3. **New adjustment slider**: add the HTML input in `index.html`, add the key to `DEFAULT_ADJUSTMENTS` in `workspace.js`, and handle the math in `applyAdjustmentsToImageData()` in `commands.js`.

### What to avoid

- Putting image processing logic in route handlers or event listeners.
- Importing from `app.js` in any other JS module (it is the root — dependencies flow inward).
- Mixing fetch calls into `commands.js` directly — always go through `api.js`.
- Adding global mutable state outside the `state` object in `workspace.js`.
- Catching and silencing errors in commands — surface them via `setStatus("Fehler", ...)`.
