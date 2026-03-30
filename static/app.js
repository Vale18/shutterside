import {
  state,
  DEFAULT_ADJUSTMENTS,
  hasImage,
  hasActiveAdjustments,
  defaultPerspectivePoints,
  stepHistory,
} from "./workspace.js";

import {
  computeHistogramBins,
  detectClipping,
  drawHistogram,
} from "./histogram.js";

import {
  injectUI,
  applyAdjustmentsToImageData,
  handleFile,
  applyAdjustments,
  cropImage,
  applyPerspectiveCorrection,
  removeBackground,
  exportImage,
  resetToOriginal,
  clearWorkspace,
  requestExportEstimate,
} from "./commands.js";

// ─── DOM references ───────────────────────────────────────────────────────────

const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const resetAllBtn = document.getElementById("resetAllBtn");
const resetAdjustmentsBtn = document.getElementById("resetAdjustmentsBtn");
const applyAdjustmentsBtn = document.getElementById("applyAdjustmentsBtn");
const applyToolBtn = document.getElementById("applyToolBtn");
const removeBgBtn = document.getElementById("removeBgBtn");
const exportFormatSelect = document.getElementById("exportFormat");
const exportCompressionInput = document.getElementById("exportCompression");
const exportCompressionValue = document.getElementById("exportCompressionValue");
const exportHint = document.getElementById("exportHint");
const exportDimensions = document.getElementById("exportDimensions");
const exportEstimate = document.getElementById("exportEstimate");
const exportSaveBtn = document.getElementById("exportSaveBtn");
const toolHint = document.getElementById("toolHint");
const statusText = document.getElementById("statusText");
const statusBadge = document.getElementById("statusBadge");
const canvasViewport = document.getElementById("canvasViewport");
const canvasStack = document.getElementById("canvasStack");
const emptyState = document.getElementById("emptyState");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");
const imageCanvas = document.getElementById("imageCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const toolButtons = Array.from(document.querySelectorAll("[data-mode]"));
const histogramCanvas = document.getElementById("histogramCanvas");
const histogramCard = document.getElementById("histogramCard");
const histogramToggleBtn = document.getElementById("histogramToggleBtn");
const clipShadow = document.getElementById("clipShadow");
const clipHighlight = document.getElementById("clipHighlight");
const zoomLevelChip = document.getElementById("zoomLevel");
const adjustmentInputs = [
  document.getElementById("brightness"),
  document.getElementById("contrast"),
  document.getElementById("saturation"),
  document.getElementById("warmth"),
  document.getElementById("grayscale"),
];

let _spaceHeld = false;
let _panDragging = false;
let _panDragStart = { x: 0, y: 0 };
let _panAtDragStart = { x: 0, y: 0 };

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatBytes(byteCount) {
  if (!Number.isFinite(byteCount) || byteCount <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = byteCount;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function fitSize(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
  return {
    width: Math.max(1, Math.round(sourceWidth * ratio)),
    height: Math.max(1, Math.round(sourceHeight * ratio)),
  };
}

// ─── UI functions ─────────────────────────────────────────────────────────────

function setStatus(label, message, tone = "idle") {
  statusBadge.textContent = label;
  statusBadge.classList.toggle("is-busy", tone === "busy");
  statusBadge.classList.toggle("is-ready", tone === "ready");
  statusText.textContent = message;
}

function setBusy(isBusy, message = "Processing image...") {
  state.busy = isBusy;
  loadingOverlay.classList.toggle("is-visible", isBusy);
  loadingText.textContent = message;
  updateUiState();
}

function setMode(mode) {
  state.mode = mode;
  if (mode === "perspective" && !state.perspectivePoints?.length) {
    state.perspectivePoints = defaultPerspectivePoints();
  }
  toolButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  const hints = {
    preview: "Preview active. Use the sliders or switch to a tool.",
    crop: "Crop: Draw a rectangle on the image, then click Apply tool.",
    perspective: "Perspective: Drag the four corner points to the document edges, then confirm.",
  };

  toolHint.textContent = hints[mode] || hints.preview;
  applyToolBtn.disabled = !hasImage() || state.busy || mode === "preview";
  scheduleRender();
}

function updateUiState() {
  const ready = hasImage();
  applyAdjustmentsBtn.disabled = !ready || state.busy || !hasActiveAdjustments();
  resetAllBtn.disabled = !state.originalDataUrl || state.busy;
  resetAdjustmentsBtn.disabled = !ready || state.busy;
  removeBgBtn.disabled = !ready || state.busy;
  exportFormatSelect.disabled = !ready || state.busy;
  exportCompressionInput.disabled = !ready || state.busy;
  exportSaveBtn.disabled = !ready || state.busy;
  applyToolBtn.disabled = !ready || state.busy || state.mode === "preview";
}

function syncSliderOutputs() {
  adjustmentInputs.forEach((input) => {
    const output = document.getElementById(`${input.id}Value`);
    const value = Number(input.value);
    const prefix = value > 0 ? "+" : "";
    output.textContent = `${prefix}${value}`;
  });
}

function syncAdjustmentsFromInputs() {
  adjustmentInputs.forEach((input) => {
    state.adjustments[input.name] = Number(input.value);
  });
}

function syncInputsFromEditState() {
  adjustmentInputs.forEach((input) => {
    if (input.name in state.adjustments) {
      input.value = String(state.adjustments[input.name]);
    }
  });
}

function syncExportControls() {
  state.exportSettings.format = exportFormatSelect.value;
  state.exportSettings.compression = Number(exportCompressionInput.value);
  exportCompressionValue.textContent = `${state.exportSettings.compression}%`;

  if (state.exportSettings.format === "png") {
    exportHint.textContent =
      "PNG is lossless. Higher compression means a smaller file, not lower quality.";
    return;
  }

  exportHint.textContent =
    "JPG uses lossy compression. Higher compression makes the file smaller but reduces quality. Transparency is flattened to white.";
}

function resetAdjustments(render = true) {
  adjustmentInputs.forEach((input) => {
    input.value = String(DEFAULT_ADJUSTMENTS[input.name]);
  });
  state.adjustments = { ...DEFAULT_ADJUSTMENTS };
  syncSliderOutputs();
  if (render) {
    scheduleRender();
    scheduleExportEstimate();
  }
}

function updateExportDisplay(payload) {
  exportDimensions.textContent = `${payload.width} x ${payload.height}px`;
  exportEstimate.textContent = `~${formatBytes(payload.bytes)}`;
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────

function applyZoomTransform() {
  canvasStack.style.transform = `translate(${state.zoomPanX}px, ${state.zoomPanY}px) scale(${state.zoomLevel})`;
  if (zoomLevelChip) zoomLevelChip.textContent = `${Math.round(state.zoomLevel * 100)}%`;
}

function resetZoom() {
  state.zoomLevel = 1;
  state.zoomPanX = 0;
  state.zoomPanY = 0;
  applyZoomTransform();
}

// ─── Histogram bridge ─────────────────────────────────────────────────────────

function updateHistogram() {
  const W = histogramCanvas.width;
  const H = histogramCanvas.height;

  if (!state.histogramVisible || !hasImage() || imageCanvas.width === 0) {
    const hCtx = histogramCanvas.getContext("2d");
    hCtx.clearRect(0, 0, W, H);
    clipShadow.classList.remove("is-clipping");
    clipHighlight.classList.remove("is-clipping");
    return;
  }

  const imgCtx = imageCanvas.getContext("2d", { willReadFrequently: true });
  const frame = imgCtx.getImageData(0, 0, imageCanvas.width, imageCanvas.height);

  const bins = computeHistogramBins(frame);
  const clipping = detectClipping(bins, bins.total);

  clipShadow.classList.toggle("is-clipping", clipping.shadow);
  clipHighlight.classList.toggle("is-clipping", clipping.highlight);

  drawHistogram(histogramCanvas, bins);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function scheduleRender() {
  cancelAnimationFrame(state.renderHandle);
  state.renderHandle = requestAnimationFrame(renderPreview);
}

function resizeDisplayCanvases(width, height) {
  if (imageCanvas.width !== width || imageCanvas.height !== height) {
    imageCanvas.width = width;
    imageCanvas.height = height;
    imageCanvas.style.width = `${width}px`;
    imageCanvas.style.height = `${height}px`;
  }

  if (overlayCanvas.width !== width || overlayCanvas.height !== height) {
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    overlayCanvas.style.width = `${width}px`;
    overlayCanvas.style.height = `${height}px`;
  }
}

function renderPreview() {
  if (!hasImage()) return;

  const maxWidth = Math.max(240, canvasViewport.clientWidth - 48);
  const maxHeight = Math.max(240, canvasViewport.clientHeight - 48);
  const { width, height } = fitSize(
    state.baseCanvas.width,
    state.baseCanvas.height,
    maxWidth,
    maxHeight,
  );

  state.previewWidth = width;
  state.previewHeight = height;

  resizeDisplayCanvases(width, height);

  const imageCtx = imageCanvas.getContext("2d", { willReadFrequently: true });
  imageCtx.clearRect(0, 0, width, height);
  imageCtx.drawImage(state.baseCanvas, 0, 0, width, height);

  if (hasActiveAdjustments()) {
    const frame = imageCtx.getImageData(0, 0, width, height);
    applyAdjustmentsToImageData(frame, state.adjustments);
    imageCtx.putImageData(frame, 0, 0);
  }

  drawOverlay();
  updateHistogram();
}

// ─── Overlay drawing ──────────────────────────────────────────────────────────

function drawOverlay() {
  const ctx = overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!hasImage()) return;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (state.mode === "crop") drawCropOverlay(ctx);
  if (state.mode === "perspective") drawPerspectiveOverlay(ctx);
}

function drawCropOverlay(ctx) {
  ctx.fillStyle = "rgba(20, 12, 8, 0.42)";
  ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (!state.cropRect) {
    drawOverlayMessage(ctx, "Draw a crop rectangle on the image.");
    return;
  }

  const rect = {
    x: state.cropRect.x * overlayCanvas.width,
    y: state.cropRect.y * overlayCanvas.height,
    w: state.cropRect.w * overlayCanvas.width,
    h: state.cropRect.h * overlayCanvas.height,
  };

  ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = "#fdf7f0";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  ctx.strokeStyle = "rgba(253, 247, 240, 0.45)";
  ctx.beginPath();
  ctx.moveTo(rect.x + rect.w / 3, rect.y);
  ctx.lineTo(rect.x + rect.w / 3, rect.y + rect.h);
  ctx.moveTo(rect.x + (rect.w / 3) * 2, rect.y);
  ctx.lineTo(rect.x + (rect.w / 3) * 2, rect.y + rect.h);
  ctx.moveTo(rect.x, rect.y + rect.h / 3);
  ctx.lineTo(rect.x + rect.w, rect.y + rect.h / 3);
  ctx.moveTo(rect.x, rect.y + (rect.h / 3) * 2);
  ctx.lineTo(rect.x + rect.w, rect.y + (rect.h / 3) * 2);
  ctx.stroke();
}

function drawPerspectiveOverlay(ctx) {
  const points = state.perspectivePoints.map((point) => ({
    x: point.x * overlayCanvas.width,
    y: point.y * overlayCanvas.height,
  }));

  ctx.fillStyle = "rgba(15, 12, 10, 0.18)";
  ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.clip();
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  ctx.strokeStyle = "rgba(15, 123, 118, 0.38)";
  ctx.lineWidth = 1;
  for (let step = 1; step < 4; step += 1) {
    const t = step / 4;
    const left = lerpPoint(points[0], points[3], t);
    const right = lerpPoint(points[1], points[2], t);
    const top = lerpPoint(points[0], points[1], t);
    const bottom = lerpPoint(points[3], points[2], t);

    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "#0f7b76";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.stroke();

  points.forEach((point, index) => {
    ctx.fillStyle = "#fff9f2";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0f7b76";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#0f7b76";
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.fillText(String(index + 1), point.x + 12, point.y - 12);
  });
}

function drawOverlayMessage(ctx, message) {
  ctx.fillStyle = "rgba(253, 247, 240, 0.94)";
  ctx.font = '15px "IBM Plex Mono", monospace';
  ctx.textAlign = "center";
  ctx.fillText(message, overlayCanvas.width / 2, overlayCanvas.height / 2);
}

function lerpPoint(start, end, t) {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

// ─── Export estimate ──────────────────────────────────────────────────────────

function scheduleExportEstimate() {
  clearTimeout(state.estimateHandle);

  if (!hasImage()) {
    exportDimensions.textContent = "-";
    exportEstimate.textContent = "No image loaded";
    return;
  }

  exportDimensions.textContent = `${state.baseCanvas.width} x ${state.baseCanvas.height}px`;
  exportEstimate.textContent = "Estimating size...";

  state.estimateHandle = window.setTimeout(() => {
    refreshExportEstimate();
  }, 220);
}

async function refreshExportEstimate() {
  if (!hasImage()) {
    exportDimensions.textContent = "-";
    exportEstimate.textContent = "No image loaded";
    return;
  }

  const token = ++state.estimateToken;

  try {
    const payload = await requestExportEstimate();
    if (token !== state.estimateToken) return;
    exportDimensions.textContent = `${payload.width} x ${payload.height}px`;
    exportEstimate.textContent = `~${formatBytes(payload.bytes)}`;
  } catch {
    if (token !== state.estimateToken) return;
    exportEstimate.textContent = "Size unknown";
  }
}

// ─── Lifecycle callbacks for commands.js ──────────────────────────────────────

function onImageReady() {
  resetZoom();
  emptyState.style.display = "none";
  canvasStack.classList.add("is-visible");
  setMode("preview");
  setStatus(
    "Ready",
    `Image loaded: ${state.baseCanvas.width} x ${state.baseCanvas.height} pixels.`,
    "ready",
  );
  updateUiState();
  scheduleRender();
  scheduleExportEstimate();
}

function onWorkspaceCleared() {
  resetAdjustments(false);
  resetZoom();
  updateHistogram();
  imageCanvas.width = 0;
  imageCanvas.height = 0;
  overlayCanvas.width = 0;
  overlayCanvas.height = 0;
  canvasStack.classList.remove("is-visible");
  emptyState.style.display = "grid";
  setMode("preview");
  setStatus("Idle", "Load an image to start editing.");
  exportDimensions.textContent = "-";
  exportEstimate.textContent = "No image loaded";
  updateUiState();
}

// ─── Inject UI callbacks into commands.js ─────────────────────────────────────

injectUI({
  setStatus,
  setBusy,
  setMode,
  updateUiState,
  scheduleRender,
  scheduleExportEstimate,
  resetAdjustments,
  onImageReady,
  onWorkspaceCleared,
  updateExportDisplay,
  formatBytes,
});

// ─── Pointer interaction ──────────────────────────────────────────────────────

function getPointerPosition(event) {
  const rect = overlayCanvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function getPerspectiveHandleIndex(pointer) {
  const px = pointer.x * overlayCanvas.width;
  const py = pointer.y * overlayCanvas.height;

  return state.perspectivePoints.findIndex((point) => {
    const hx = point.x * overlayCanvas.width;
    const hy = point.y * overlayCanvas.height;
    return Math.hypot(px - hx, py - hy) <= 18;
  });
}

overlayCanvas.addEventListener("pointerdown", (event) => {
  if (!hasImage() || state.busy) return;

  const pointer = getPointerPosition(event);

  if (state.mode === "crop") {
    state.drag = { type: "crop", start: pointer };
    state.cropRect = { x: pointer.x, y: pointer.y, w: 0, h: 0 };
    overlayCanvas.setPointerCapture(event.pointerId);
    scheduleRender();
    return;
  }

  if (state.mode === "perspective") {
    const handleIndex = getPerspectiveHandleIndex(pointer);
    if (handleIndex >= 0) {
      state.drag = { type: "perspective", handleIndex };
      overlayCanvas.setPointerCapture(event.pointerId);
    }
  }
});

overlayCanvas.addEventListener("pointermove", (event) => {
  if (!state.drag) return;

  const pointer = getPointerPosition(event);

  if (state.drag.type === "crop") {
    const start = state.drag.start;
    state.cropRect = {
      x: Math.min(start.x, pointer.x),
      y: Math.min(start.y, pointer.y),
      w: Math.abs(pointer.x - start.x),
      h: Math.abs(pointer.y - start.y),
    };
    scheduleRender();
  }

  if (state.drag.type === "perspective") {
    state.perspectivePoints[state.drag.handleIndex] = {
      x: clamp(pointer.x, 0, 1),
      y: clamp(pointer.y, 0, 1),
    };
    scheduleRender();
  }
});

function releasePointer(event) {
  if (state.drag) {
    state.drag = null;
    overlayCanvas.releasePointerCapture(event.pointerId);
    scheduleRender();
  }
}

overlayCanvas.addEventListener("pointerup", releasePointer);
overlayCanvas.addEventListener("pointercancel", releasePointer);

// ─── Event listeners ──────────────────────────────────────────────────────────

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  handleFile(file);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  [dropZone, canvasViewport].forEach((target) => {
    target.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  });
});

["dragleave", "drop"].forEach((eventName) => {
  [dropZone, canvasViewport].forEach((target) => {
    target.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
    });
  });
});

[dropZone, canvasViewport].forEach((target) => {
  target.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer?.files || [];
    handleFile(file);
  });
});

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!hasImage() && button.dataset.mode !== "preview") return;
    setMode(button.dataset.mode);
  });
});

adjustmentInputs.forEach((input) => {
  input.addEventListener("input", () => {
    syncSliderOutputs();
    syncAdjustmentsFromInputs();
    updateUiState();
    scheduleRender();
    scheduleExportEstimate();
  });

  input.addEventListener("dblclick", () => {
    input.value = String(DEFAULT_ADJUSTMENTS[input.name]);
    syncSliderOutputs();
    syncAdjustmentsFromInputs();
    updateUiState();
    scheduleRender();
    scheduleExportEstimate();
  });
});

exportFormatSelect.addEventListener("change", () => {
  syncExportControls();
  scheduleExportEstimate();
});

exportCompressionInput.addEventListener("input", () => {
  syncExportControls();
  scheduleExportEstimate();
});

applyAdjustmentsBtn.addEventListener("click", applyAdjustments);
resetAdjustmentsBtn.addEventListener("click", () => {
  resetAdjustments(true);
  syncAdjustmentsFromInputs();
  updateUiState();
});

applyToolBtn.addEventListener("click", () => {
  if (state.mode === "crop") cropImage();
  else if (state.mode === "perspective") applyPerspectiveCorrection();
});

removeBgBtn.addEventListener("click", removeBackground);
exportSaveBtn.addEventListener("click", exportImage);
resetAllBtn.addEventListener("click", resetToOriginal);

// ─── Zoom / Pan events ───────────────────────────────────────────────────────

canvasViewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (!hasImage()) return;

  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  const newLevel = clamp(state.zoomLevel * factor, 0.1, 8);

  const vpRect = canvasViewport.getBoundingClientRect();
  const Cx = vpRect.left + vpRect.width / 2;
  const Cy = vpRect.top + vpRect.height / 2;
  const dx = event.clientX - Cx;
  const dy = event.clientY - Cy;

  state.zoomPanX = dx - (dx - state.zoomPanX) * newLevel / state.zoomLevel;
  state.zoomPanY = dy - (dy - state.zoomPanY) * newLevel / state.zoomLevel;
  state.zoomLevel = newLevel;
  applyZoomTransform();
}, { passive: false });

canvasViewport.addEventListener("dblclick", (event) => {
  if (event.target === overlayCanvas) return;
  resetZoom();
});

canvasViewport.addEventListener("pointerdown", (event) => {
  const isPanTrigger = _spaceHeld || event.button === 1 || event.button === 2;
  if (!isPanTrigger || !hasImage()) return;
  event.preventDefault();
  event.stopPropagation();
  _panDragging = true;
  _panDragStart = { x: event.clientX, y: event.clientY };
  _panAtDragStart = { x: state.zoomPanX, y: state.zoomPanY };
  canvasViewport.setPointerCapture(event.pointerId);
  canvasViewport.style.cursor = "grabbing";
});

canvasViewport.addEventListener("pointermove", (event) => {
  if (!_panDragging) return;
  state.zoomPanX = _panAtDragStart.x + (event.clientX - _panDragStart.x);
  state.zoomPanY = _panAtDragStart.y + (event.clientY - _panDragStart.y);
  applyZoomTransform();
});

canvasViewport.addEventListener("pointerup", (event) => {
  if (!_panDragging) return;
  _panDragging = false;
  canvasViewport.releasePointerCapture(event.pointerId);
  canvasViewport.style.cursor = _spaceHeld ? "grab" : "";
});

canvasViewport.addEventListener("contextmenu", (event) => event.preventDefault());

// ─── Keyboard ─────────────────────────────────────────────────────────────────

document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !event.repeat && !event.target.matches("input, select, textarea, button")) {
    event.preventDefault();
    _spaceHeld = true;
    if (hasImage()) canvasViewport.style.cursor = "grab";
    return;
  }

  if (state.busy) return;
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && !event.shiftKey && event.key === "z") {
    event.preventDefault();
    const snapshot = stepHistory(-1);
    if (snapshot) {
      syncInputsFromEditState();
      syncSliderOutputs();
      updateUiState();
      scheduleRender();
      scheduleExportEstimate();
      setStatus("History", snapshot.label, "ready");
    }
  } else if (ctrl && (event.key === "y" || (event.shiftKey && event.key === "z"))) {
    event.preventDefault();
    const snapshot = stepHistory(1);
    if (snapshot) {
      syncInputsFromEditState();
      syncSliderOutputs();
      updateUiState();
      scheduleRender();
      scheduleExportEstimate();
      setStatus("History", snapshot.label, "ready");
    }
  }
});

document.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    _spaceHeld = false;
    if (!_panDragging) canvasViewport.style.cursor = "";
  }
});

// ─── Histogram toggle ─────────────────────────────────────────────────────────

histogramToggleBtn.addEventListener("click", () => {
  state.histogramVisible = !state.histogramVisible;
  histogramCard.classList.toggle("is-collapsed", !state.histogramVisible);
  histogramToggleBtn.textContent = state.histogramVisible ? "hide" : "show";
  if (state.histogramVisible) updateHistogram();
});

window.addEventListener("resize", scheduleRender);

// ─── Init ─────────────────────────────────────────────────────────────────────

syncSliderOutputs();
syncAdjustmentsFromInputs();
syncExportControls();
clearWorkspace();
