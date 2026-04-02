# Shutterside

A local-first browser image editor. Load a photo, make adjustments, export — nothing leaves your machine, no ads, 100% free.

![Python](https://img.shields.io/badge/Python-3.10%2B-blue) ![Flask](https://img.shields.io/badge/Flask-3.x-lightgrey) ![Vanilla JS](https://img.shields.io/badge/JS-ES%20Modules-yellow)
![thumbnail](./examples/Screenshot%202026-04-02%20142058.png)
---

## Features

- **Tone Curve** — Interactive Catmull-Rom spline with master RGB + per-channel R/G/B curves, histogram backdrop, and contrast presets
- **Adjustments** — Brightness, contrast, saturation, warmth, grayscale (non-destructive, live preview)
- **Crop** — Free or fixed aspect ratio (1:1, 4:3, 3:2, 16:9), fine rotation slider ±45°
- **Rotate & Flip** — 90° CW/CCW, horizontal and vertical flip
- **Perspective Correction** — Drag four corner points to correct lens distortion or document scans
- **Background Removal** — U2Net ONNX model runs fully on-device; model downloads automatically on first use
- **Export** — PNG (lossless) or JPG with adjustable compression; live file-size estimate
- **Undo / Redo** — Full history with Ctrl+Z / Ctrl+Y
- **Histogram** — Live RGB histogram with shadow and highlight clipping indicators
- **Zoom & Pan** — Scroll to zoom, middle-click or Space+drag to pan

---

## Quick Start

```bash
# 1. Clone and create a virtual environment
git clone <repo-url>
cd shutterside
python -m venv .venv

# 2. Activate it
.venv\Scripts\activate        # Windows
source .venv/bin/activate     # macOS / Linux

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser.

> The U2Net model (`models/u2netp.onnx`) is downloaded automatically the first time you use background removal. It is about 4 MB.

---

## Supported Formats

| Input | Output |
|-------|--------|
| PNG, JPG / JPEG | PNG (lossless), JPG (adjustable quality) |

---

## Project Structure

```
shutterside/
├── app.py              # Flask routes — thin handlers: parse, delegate, respond
├── image_ops.py        # Pure image processing (no Flask, no HTTP)
├── sessions.py         # SessionStore — create, delete, TTL-expire temp files
├── requirements.txt
├── models/             # ONNX weights (gitignored, auto-downloaded)
├── tmp/                # Ephemeral session binaries (auto-cleaned)
├── templates/
│   └── index.html      # Single-page HTML shell
└── static/
    ├── app.js          # Entry point — DOM, UI functions, event wiring, rendering
    ├── api.js          # All fetch() calls to the backend
    ├── commands.js     # User-facing actions (crop, export, background removal…)
    ├── workspace.js    # Shared state, history, edit-state management
    ├── tonecurve.js    # Catmull-Rom spline math, LUT building, presets
    ├── histogram.js    # Histogram computation and canvas drawing
    └── style.css
```

---

## Architecture

Processing is split into three strict layers:

```
Browser (ES Modules)          Flask (Python)
─────────────────────         ───────────────────────
app.js  →  commands.js  →  api.js  →  app.py  →  image_ops.py
           workspace.js                          sessions.py
           tonecurve.js
           histogram.js
```

- **All image math** lives in `image_ops.py` — pure functions, bytes in / bytes out, no Flask objects.
- **All fetch calls** live in `api.js` — no fetch anywhere else in the frontend.
- **All shared state** lives in `workspace.js` as a single `state` object.
- Adjustments (including tone curve) are applied client-side via Canvas pixel manipulation — no server round-trip for previews.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Space` + drag | Pan |
| `Scroll` | Zoom in / out |
| Double-click canvas | Reset zoom |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| Flask | Web server and routing |
| Pillow | Image encoding / decoding |
| NumPy | Array operations for image processing |
| OpenCV (`opencv-python`) | Perspective warp |
| onnxruntime | Run U2Net background removal model |
| rembg | Background removal pipeline wrapper |

Optional dependencies (`opencv-python`, `onnxruntime`, `rembg`) are imported lazily — the app starts and works normally without them; only the specific features that need them will fail with a clear error message.

---

## License

MIT
