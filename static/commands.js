import * as api from "./api.js";
import {
  state,
  hasImage,
  hasActiveAdjustments,
  drawToBaseCanvas,
  replaceBaseCanvas,
  resetEditState,
  clearBaseCanvas,
  sanitizeBaseName,
  defaultPerspectivePoints,
  pushHistory,
  resetHistory,
  snapshotEditState,
  deleteSession,
  createSession,
  DEFAULT_ADJUSTMENTS,
} from "./workspace.js";

// ─── UI callbacks (injected by app.js to avoid circular deps) ─────────────────

let _ui = {};

export function injectUI(callbacks) {
  _ui = callbacks;
}

// ─── Image adjustment processing ──────────────────────────────────────────────

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function applyAdjustmentsToImageData(imageData, adjustments) {
  const pixels = imageData.data;
  const brightnessOffset = (adjustments.brightness / 100) * 255;
  const contrast = adjustments.contrast;
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const saturationFactor = 1 + adjustments.saturation / 100;
  const warmthOffset = (adjustments.warmth / 100) * 48;
  const grayscaleMix = adjustments.grayscale / 100;

  for (let index = 0; index < pixels.length; index += 4) {
    let red = pixels[index];
    let green = pixels[index + 1];
    let blue = pixels[index + 2];

    red += brightnessOffset;
    green += brightnessOffset;
    blue += brightnessOffset;

    red = contrastFactor * (red - 128) + 128;
    green = contrastFactor * (green - 128) + 128;
    blue = contrastFactor * (blue - 128) + 128;

    let luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    red = luma + (red - luma) * saturationFactor;
    green = luma + (green - luma) * saturationFactor;
    blue = luma + (blue - luma) * saturationFactor;

    red += warmthOffset;
    blue -= warmthOffset * 0.72;

    luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    red = red * (1 - grayscaleMix) + luma * grayscaleMix;
    green = green * (1 - grayscaleMix) + luma * grayscaleMix;
    blue = blue * (1 - grayscaleMix) + luma * grayscaleMix;

    pixels[index] = clamp(Math.round(red), 0, 255);
    pixels[index + 1] = clamp(Math.round(green), 0, 255);
    pixels[index + 2] = clamp(Math.round(blue), 0, 255);
  }
}

export function buildProcessedCanvas(sourceCanvas, adjustments) {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = sourceCanvas.width;
  tempCanvas.height = sourceCanvas.height;
  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
  tempCtx.drawImage(sourceCanvas, 0, 0);

  if (Object.values(adjustments).some((value) => value !== 0)) {
    const frame = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    applyAdjustmentsToImageData(frame, adjustments);
    tempCtx.putImageData(frame, 0, 0);
  }

  return tempCanvas;
}

function getPreparedExportCanvas() {
  return hasActiveAdjustments()
    ? buildProcessedCanvas(state.baseCanvas, state.adjustments)
    : state.baseCanvas;
}

function bakeAdjustmentsIntoBase() {
  if (!hasActiveAdjustments()) return false;
  pushHistory("Adjustments baked");
  const processed = buildProcessedCanvas(state.baseCanvas, state.adjustments);
  replaceBaseCanvas(processed);
  _ui.resetAdjustments(false);
  _ui.setStatus("Ready", "Adjustments have been baked into the image.", "ready");
  return true;
}

// ─── Shared async operation wrapper ───────────────────────────────────────────

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function runServerOperation({ busyMsg, statusMsg, apiFn, historyLabel }) {
  if (!hasImage()) return;
  _ui.setBusy(true, busyMsg);
  _ui.setStatus("Working", statusMsg, "busy");
  await nextFrame();

  if (hasActiveAdjustments()) {
    bakeAdjustmentsIntoBase();
  }

  try {
    const resultDataUrl = await apiFn();
    await loadImageFromDataUrl(resultDataUrl, { rememberOriginal: false });
    state.history = [{ editState: snapshotEditState(), label: historyLabel }];
    state.historyIndex = 0;
    _ui.setStatus("Ready", `${historyLabel} completed.`, "ready");
  } catch (error) {
    _ui.setStatus("Error", error.message, "idle");
  } finally {
    _ui.setBusy(false);
  }
}

// ─── File I/O helpers ─────────────────────────────────────────────────────────

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export function createImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = dataUrl;
  });
}

// ─── Load / clear workspace ───────────────────────────────────────────────────

export async function loadImageFromDataUrl(dataUrl, options = {}) {
  const { rememberOriginal = false, filename = "image" } = options;
  const image = await createImage(dataUrl);

  clearTimeout(state.estimateHandle);
  state.estimateToken += 1;

  drawToBaseCanvas(image);

  if (rememberOriginal) {
    state.originalDataUrl = dataUrl;
  }
  state.originalName = rememberOriginal ? sanitizeBaseName(filename) : state.originalName;

  resetEditState();
  resetHistory();
  pushHistory("Image loaded");

  if (rememberOriginal) {
    deleteSession().then(() => createSession(dataUrl));
  }

  _ui.onImageReady();
}

export function clearWorkspace() {
  clearTimeout(state.estimateHandle);
  state.estimateToken += 1;

  clearBaseCanvas();
  state.originalDataUrl = null;
  resetEditState();
  deleteSession();
  resetHistory();

  _ui.onWorkspaceCleared();
}

// ─── User commands ────────────────────────────────────────────────────────────

export async function applyAdjustments() {
  if (!hasImage() || !hasActiveAdjustments()) return;

  _ui.setBusy(true, "Baking adjustments...");
  _ui.setStatus("Working", "Adjustments are being permanently applied to the image.", "busy");
  await nextFrame();

  bakeAdjustmentsIntoBase();

  _ui.setBusy(false);
  _ui.updateUiState();
  _ui.scheduleRender();
  _ui.scheduleExportEstimate();
}

export function cropImage() {
  if (!state.cropRect || state.cropRect.w < 0.01 || state.cropRect.h < 0.01) {
    _ui.setStatus("Note", "Draw a visible crop rectangle first.", "idle");
    return;
  }

  if (hasActiveAdjustments()) {
    bakeAdjustmentsIntoBase();
  }

  const x = Math.round(state.cropRect.x * state.baseCanvas.width);
  const y = Math.round(state.cropRect.y * state.baseCanvas.height);
  const width = Math.max(1, Math.round(state.cropRect.w * state.baseCanvas.width));
  const height = Math.max(1, Math.round(state.cropRect.h * state.baseCanvas.height));

  const nextCanvas = document.createElement("canvas");
  nextCanvas.width = width;
  nextCanvas.height = height;
  const nextCtx = nextCanvas.getContext("2d");
  nextCtx.drawImage(state.baseCanvas, x, y, width, height, 0, 0, width, height);

  replaceBaseCanvas(nextCanvas);
  state.cropRect = null;
  resetHistory();
  pushHistory("Crop applied");
  _ui.setMode("preview");
  _ui.setStatus("Ready", `Crop applied: ${width} x ${height} pixels.`, "ready");
  _ui.scheduleRender();
  _ui.scheduleExportEstimate();
}

export async function applyPerspectiveCorrection() {
  const points = state.perspectivePoints.map((point) => ({
    x: point.x * state.baseCanvas.width,
    y: point.y * state.baseCanvas.height,
  }));

  await runServerOperation({
    busyMsg: "Correcting perspective...",
    statusMsg: "Perspective is being corrected on the server.",
    apiFn: async () => {
      const payload = await api.postPerspective(
        state.baseCanvas.toDataURL("image/png"),
        points,
      );
      return payload.image;
    },
    historyLabel: "Perspective correction",
  });
}

export async function removeBackground() {
  await runServerOperation({
    busyMsg: "Removing background...",
    statusMsg: "Background removal in progress. The model may take a moment to load on first use.",
    apiFn: async () => {
      const payload = await api.postRemoveBackground(
        state.baseCanvas.toDataURL("image/png"),
      );
      return payload.image;
    },
    historyLabel: "Background removed",
  });
}

export async function exportImage() {
  if (!hasImage()) return;

  _ui.setBusy(true, "Creating export...");
  _ui.setStatus("Working", "File is being created with the selected export settings.", "busy");

  try {
    const sourceCanvas = getPreparedExportCanvas();
    const payload = await api.postExport(
      sourceCanvas.toDataURL("image/png"),
      state.exportSettings.format,
      state.exportSettings.compression,
      true,
    );

    const link = document.createElement("a");
    link.href = payload.image;
    link.download = `${state.originalName}-edited.${payload.extension}`;
    link.click();

    _ui.updateExportDisplay(payload);
    _ui.setStatus(
      "Ready",
      `Export saved: ${payload.extension.toUpperCase()}, ~${_ui.formatBytes(payload.bytes)}.`,
      "ready",
    );
  } catch (error) {
    _ui.setStatus("Error", error.message, "idle");
  } finally {
    _ui.setBusy(false);
  }
}

export async function requestExportEstimate() {
  const sourceCanvas = getPreparedExportCanvas();
  return api.postExport(
    sourceCanvas.toDataURL("image/png"),
    state.exportSettings.format,
    state.exportSettings.compression,
    false,
  );
}

export async function handleFile(file) {
  if (!file) return;

  if (!/^image\/(png|jpeg|jpg)$/.test(file.type)) {
    _ui.setStatus("Error", "Please load PNG or JPG files only.");
    return;
  }

  _ui.setBusy(true, "Loading image...");
  _ui.setStatus("Working", "Reading file.", "busy");

  try {
    const dataUrl = await readFileAsDataUrl(file);
    await loadImageFromDataUrl(dataUrl, {
      rememberOriginal: true,
      filename: file.name,
    });
  } catch (error) {
    _ui.setStatus("Error", error.message);
  } finally {
    _ui.setBusy(false);
  }
}

export async function resetToOriginal() {
  if (!state.originalDataUrl || state.busy) return;

  _ui.setBusy(true, "Restoring original...");
  try {
    await loadImageFromDataUrl(state.originalDataUrl, {
      rememberOriginal: false,
      filename: state.originalName,
    });
    _ui.setStatus("Ready", "Original image restored.", "ready");
  } finally {
    _ui.setBusy(false);
  }
}
