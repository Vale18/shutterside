from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

import numpy as np
from flask import Flask, jsonify, render_template, request

from image_ops import (
    encode_png_from_array,
    export_image,
    load_cv_image,
    remove_background,
    warp_perspective,
)
from sessions import SessionStore

ROOT = Path(__file__).resolve().parent
MODELS_DIR = ROOT / "models"
MODELS_DIR.mkdir(exist_ok=True)
TMP_DIR = ROOT / "tmp"
TMP_DIR.mkdir(exist_ok=True)
os.environ.setdefault("U2NET_HOME", str(MODELS_DIR))

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

session_store = SessionStore(TMP_DIR)


# ─── Request helpers ───────────────────────────────────────────────────────────

def decode_data_url(data_url: str) -> bytes:
    if "," not in data_url:
        raise ValueError("Ungueltiges Bildformat.")
    _, encoded = data_url.split(",", 1)
    return base64.b64decode(encoded)


def image_bytes_to_data_url(image_bytes: bytes, mime_type: str) -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def validate_points(raw_points: Any) -> np.ndarray:
    if not isinstance(raw_points, list) or len(raw_points) != 4:
        raise ValueError("Es werden genau vier Perspektivpunkte benoetigt.")

    points: list[list[float]] = []
    for item in raw_points:
        if not isinstance(item, dict) or "x" not in item or "y" not in item:
            raise ValueError("Ungueltige Punktdaten fuer die Perspektivkorrektur.")
        points.append([float(item["x"]), float(item["y"])])
    return np.array(points, dtype=np.float32)


def parse_export_settings(payload: dict[str, Any]) -> tuple[str, int]:
    export_format = str(payload.get("format", "png")).lower()
    if export_format not in {"png", "jpg"}:
        raise ValueError("Bitte PNG oder JPG als Exportformat verwenden.")

    try:
        compression = int(payload.get("compression", 35))
    except (TypeError, ValueError) as exc:
        raise ValueError("Die Komprimierung muss eine Zahl zwischen 0 und 100 sein.") from exc

    return export_format, max(0, min(compression, 100))


# ─── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.post("/api/session")
def create_session():
    session_store.cleanup_expired()
    payload = request.get_json(silent=True) or {}
    try:
        image_bytes = decode_data_url(payload.get("image", ""))
        session_id = session_store.create(image_bytes)
        return jsonify({"session_id": session_id})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.delete("/api/session/<session_id>")
def delete_session(session_id: str):
    session_store.delete(session_id)
    return jsonify({"ok": True})


@app.post("/api/perspective")
def perspective():
    payload = request.get_json(silent=True) or {}
    try:
        image_bytes = decode_data_url(payload.get("image", ""))
        source = load_cv_image(image_bytes)
        src_points = validate_points(payload.get("points"))
        warped = warp_perspective(source, src_points)
        return jsonify({"image": image_bytes_to_data_url(encode_png_from_array(warped), "image/png")})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/remove-background")
def remove_bg():
    payload = request.get_json(silent=True) or {}
    try:
        image_bytes = decode_data_url(payload.get("image", ""))
        result = remove_background(image_bytes)
        return jsonify({"image": image_bytes_to_data_url(result, "image/png")})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/export")
def export_endpoint():
    payload = request.get_json(silent=True) or {}
    try:
        image_bytes = decode_data_url(payload.get("image", ""))
        export_format, compression = parse_export_settings(payload)
        rendered_bytes, mime_type, extension, size = export_image(
            image_bytes, export_format, compression,
        )

        response = {
            "bytes": len(rendered_bytes),
            "mime_type": mime_type,
            "extension": extension,
            "width": size[0],
            "height": size[1],
        }

        if bool(payload.get("include_image")):
            response["image"] = image_bytes_to_data_url(rendered_bytes, mime_type)

        return jsonify(response)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
