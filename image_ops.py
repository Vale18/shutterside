from __future__ import annotations

from io import BytesIO

import numpy as np
from PIL import Image

try:
    import cv2
except ImportError:
    cv2 = None

try:
    from rembg import new_session, remove
except ImportError:
    new_session = None
    remove = None


_bg_session = None


def load_cv_image(image_bytes: bytes) -> np.ndarray:
    if cv2 is None:
        raise RuntimeError("OpenCV ist nicht installiert. Bitte requirements.txt installieren.")
    buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError("Das Bild konnte nicht gelesen werden.")
    return image


def encode_png_from_array(image: np.ndarray) -> bytes:
    if cv2 is None:
        raise RuntimeError("OpenCV ist nicht installiert. Bitte requirements.txt installieren.")
    success, encoded = cv2.imencode(".png", image)
    if not success:
        raise RuntimeError("Das Ergebnisbild konnte nicht erzeugt werden.")
    return encoded.tobytes()


def ensure_png(image_bytes: bytes) -> bytes:
    image = Image.open(BytesIO(image_bytes))
    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGBA")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def normalize_mode(image: Image.Image, target: str = "RGBA") -> Image.Image:
    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert(target)
    return image


def flatten_alpha(image: Image.Image) -> Image.Image:
    if image.mode == "RGBA":
        flattened = Image.new("RGB", image.size, "white")
        flattened.paste(image, mask=image.getchannel("A"))
        return flattened
    if image.mode != "RGB":
        return image.convert("RGB")
    return image


def jpeg_quality_params(compression: int) -> tuple[int, int]:
    quality = max(20, min(95, 95 - round(compression * 0.7)))
    if quality >= 88:
        subsampling = 0
    elif quality >= 68:
        subsampling = 1
    else:
        subsampling = 2
    return quality, subsampling


def encode_as_jpeg(image: Image.Image, compression: int) -> bytes:
    image = normalize_mode(image)
    image = flatten_alpha(image)
    quality, subsampling = jpeg_quality_params(compression)
    buffer = BytesIO()
    image.save(
        buffer,
        format="JPEG",
        quality=quality,
        optimize=True,
        subsampling=subsampling,
    )
    return buffer.getvalue()


def encode_as_png(image: Image.Image, compression: int) -> bytes:
    image = normalize_mode(image)
    compress_level = round((compression / 100) * 9)
    buffer = BytesIO()
    image.save(
        buffer,
        format="PNG",
        compress_level=compress_level,
        optimize=compression >= 40,
    )
    return buffer.getvalue()


def export_image(image_bytes: bytes, export_format: str, compression: int) -> tuple[bytes, str, str, tuple[int, int]]:
    image = Image.open(BytesIO(image_bytes))
    image.load()
    size = image.size

    if export_format == "jpg":
        return encode_as_jpeg(image, compression), "image/jpeg", "jpg", size

    return encode_as_png(image, compression), "image/png", "png", size


def warp_perspective(source: np.ndarray, src_points: np.ndarray) -> np.ndarray:
    if cv2 is None:
        raise RuntimeError("OpenCV ist nicht installiert. Bitte requirements.txt installieren.")

    width_top = np.linalg.norm(src_points[1] - src_points[0])
    width_bottom = np.linalg.norm(src_points[2] - src_points[3])
    height_left = np.linalg.norm(src_points[3] - src_points[0])
    height_right = np.linalg.norm(src_points[2] - src_points[1])

    target_width = max(int(round(max(width_top, width_bottom))), 1)
    target_height = max(int(round(max(height_left, height_right))), 1)

    dst_points = np.array(
        [
            [0, 0],
            [target_width - 1, 0],
            [target_width - 1, target_height - 1],
            [0, target_height - 1],
        ],
        dtype=np.float32,
    )

    matrix = cv2.getPerspectiveTransform(src_points, dst_points)
    return cv2.warpPerspective(
        source,
        matrix,
        (target_width, target_height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def get_bg_session():
    global _bg_session
    if new_session is None or remove is None:
        raise RuntimeError("rembg ist nicht installiert. Bitte requirements.txt installieren.")
    if _bg_session is None:
        _bg_session = new_session("u2netp")
    return _bg_session


def remove_background(image_bytes: bytes) -> bytes:
    png_bytes = ensure_png(image_bytes)
    return remove(png_bytes, session=get_bg_session())
