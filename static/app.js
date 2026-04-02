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
  buildLUT,
  cloneToneCurve,
  isIdentityCurve,
  TONE_CURVE_PRESETS,
} from "./tonecurve.js";

import { DEFAULT_TONE_CURVE } from "./workspace.js";

import {
  injectUI,
  applyAdjustmentsToImageData,
  handleFile,
  applyAdjustments,
  cropImage,
  rotateImage,
  flipImage,
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
const rotateCcwBtn = document.getElementById("rotateCcwBtn");
const rotateCwBtn = document.getElementById("rotateCwBtn");
const flipHBtn = document.getElementById("flipHBtn");
const flipVBtn = document.getElementById("flipVBtn");
const cropOptions = document.getElementById("cropOptions");
const ratioButtons = Array.from(document.querySelectorAll("[data-ratio]"));
const flipRatioBtn = document.getElementById("flipRatioBtn");
const cropRotationSlider = document.getElementById("cropRotationSlider");
const rotationReadout = document.getElementById("rotationReadout");
const resetRotationBtn = document.getElementById("resetRotationBtn");
const toneCurveCanvas = document.getElementById("toneCurveCanvas");
const toneCurveResetBtn = document.getElementById("toneCurveResetBtn");
const tcChannelBtns = Array.from(document.querySelectorAll(".tc-channel-btn"));
const tcPresetBtns = Array.from(document.querySelectorAll(".tc-preset-btn"));
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

// ─── Tone curve UI state (purely visual, not in workspace state) ──────────────
let _tcActiveChannel = "rgb";
let _tcDragIndex = -1;
let _tcHoverIndex = -1;

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
    crop: "Crop: Draw a rectangle on the image, then click Apply tool. Use Ratio and Rotation to fine-tune.",
    perspective: "Perspective: Drag the four corner points to the document edges, then confirm.",
  };

  toolHint.textContent = hints[mode] || hints.preview;
  applyToolBtn.disabled = !hasImage() || state.busy || mode === "preview";

  cropOptions.style.display = mode === "crop" ? "flex" : "none";

  if (mode === "crop") {
    // Reset ratio buttons to "Frei"
    ratioButtons.forEach((b) => b.classList.toggle("active", b.dataset.ratio === "free"));
    state.cropAspectRatio = null;
    // Reset rotation slider
    cropRotationSlider.value = "0";
    state.cropRotation = 0;
    rotationReadout.textContent = "0.0°";
  }

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
  rotateCcwBtn.disabled = !ready || state.busy;
  rotateCwBtn.disabled = !ready || state.busy;
  flipHBtn.disabled = !ready || state.busy;
  flipVBtn.disabled = !ready || state.busy;
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
  state.adjustments = { ...DEFAULT_ADJUSTMENTS, toneCurve: cloneToneCurve(DEFAULT_TONE_CURVE) };
  syncSliderOutputs();
  drawToneCurve();
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

// ─── Tone curve drawing ───────────────────────────────────────────────────────

const TC_CHANNEL_COLORS = {
  rgb: { curve: "#fdf7f0", hist: "rgba(220,200,170,0.22)" },
  r:   { curve: "#e05040", hist: "rgba(200,50,30,0.20)" },
  g:   { curve: "#40c060", hist: "rgba(30,160,60,0.20)" },
  b:   { curve: "#5080e0", hist: "rgba(40,90,220,0.20)" },
};

function drawToneCurve() {
  const canvas = toneCurveCanvas;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;   // 256
  const H = canvas.height;  // 180

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#1c1612";
  ctx.fillRect(0, 0, W, H);

  // Helper: map [0,255] curve coordinates to canvas pixels
  // x → canvas x,  y → canvas y (inverted: 0 = bottom, 255 = top)
  const cx = (v) => (v / 255) * W;
  const cy = (v) => H - (v / 255) * H;

  // ── Draw subtle grid ──
  ctx.strokeStyle = "rgba(255,249,240,0.06)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const gx = Math.round((i / 4) * W) + 0.5;
    const gy = Math.round((i / 4) * H) + 0.5;
    ctx.beginPath(); ctx.moveTo(gx, 0);     ctx.lineTo(gx, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, gy);     ctx.lineTo(W, gy); ctx.stroke();
  }

  // ── Histogram backdrop ──
  if (hasImage() && imageCanvas.width > 0) {
    const imgCtx = imageCanvas.getContext("2d", { willReadFrequently: true });
    const frame = imgCtx.getImageData(0, 0, imageCanvas.width, imageCanvas.height);
    const bins = computeHistogramBins(frame);

    const drawHistBand = (binArray, color) => {
      const peak = Math.max(...binArray) || 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) {
        const bh = (binArray[i] / peak) * H;
        ctx.lineTo(cx(i), H - bh);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    };

    if (_tcActiveChannel === "rgb") {
      // Blend all three channels
      drawHistBand(bins.rB, "rgba(200,80,60,0.18)");
      drawHistBand(bins.gB, "rgba(60,180,80,0.15)");
      drawHistBand(bins.bB, "rgba(60,100,220,0.18)");
    } else if (_tcActiveChannel === "r") {
      drawHistBand(bins.rB, TC_CHANNEL_COLORS.r.hist);
    } else if (_tcActiveChannel === "g") {
      drawHistBand(bins.gB, TC_CHANNEL_COLORS.g.hist);
    } else {
      drawHistBand(bins.bB, TC_CHANNEL_COLORS.b.hist);
    }
  }

  // ── Identity diagonal (dashed) ──
  ctx.strokeStyle = "rgba(255,249,240,0.18)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(W, 0);
  ctx.stroke();
  ctx.setLineDash([]);

  const tc = state.adjustments.toneCurve;

  // ── If viewing a single channel, draw RGB master curve faintly ──
  if (_tcActiveChannel !== "rgb" && !isIdentityCurve(tc.rgb)) {
    const masterLut = buildLUT(tc.rgb);
    ctx.strokeStyle = "rgba(253,247,240,0.18)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < 256; x++) {
      const y = masterLut[x];
      if (x === 0) ctx.moveTo(cx(x), cy(y));
      else ctx.lineTo(cx(x), cy(y));
    }
    ctx.stroke();
  }

  // ── Active channel curve ──
  const activePts = tc[_tcActiveChannel];
  const activeLut = buildLUT(activePts);
  const curveColor = TC_CHANNEL_COLORS[_tcActiveChannel].curve;

  ctx.strokeStyle = curveColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < 256; x++) {
    const y = activeLut[x];
    if (x === 0) ctx.moveTo(cx(x), cy(y));
    else ctx.lineTo(cx(x), cy(y));
  }
  ctx.stroke();

  // ── Control points ──
  activePts.forEach((pt, i) => {
    const isEndpoint = i === 0 || i === activePts.length - 1;
    const isDragging = i === _tcDragIndex;
    const isHovered  = i === _tcHoverIndex;

    const r = isDragging || isHovered ? 7 : isEndpoint ? 4.5 : 5.5;
    const alpha = isEndpoint ? 0.7 : 1;

    ctx.beginPath();
    ctx.arc(cx(pt[0]), cy(pt[1]), r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(253,247,240,${alpha})`;
    ctx.fill();
    ctx.strokeStyle = isDragging ? curveColor : "rgba(28,22,18,0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
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

  if (state.mode === "crop" && state.cropRotation !== 0) {
    const rad = state.cropRotation * Math.PI / 180;
    imageCtx.save();
    imageCtx.translate(width / 2, height / 2);
    imageCtx.rotate(rad);
    imageCtx.drawImage(state.baseCanvas, -width / 2, -height / 2, width, height);
    imageCtx.restore();
  } else {
    imageCtx.drawImage(state.baseCanvas, 0, 0, width, height);
  }

  if (hasActiveAdjustments()) {
    const frame = imageCtx.getImageData(0, 0, width, height);
    applyAdjustmentsToImageData(frame, state.adjustments);
    imageCtx.putImageData(frame, 0, 0);
  }

  drawOverlay();
  updateHistogram();
  drawToneCurve();
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

  // Resize handles
  const handles = [
    { x: rect.x,               y: rect.y },
    { x: rect.x + rect.w,      y: rect.y },
    { x: rect.x,               y: rect.y + rect.h },
    { x: rect.x + rect.w,      y: rect.y + rect.h },
    { x: rect.x + rect.w / 2,  y: rect.y },
    { x: rect.x + rect.w / 2,  y: rect.y + rect.h },
    { x: rect.x,               y: rect.y + rect.h / 2 },
    { x: rect.x + rect.w,      y: rect.y + rect.h / 2 },
  ];
  const hs = 7;
  ctx.fillStyle = "#fdf7f0";
  ctx.strokeStyle = "rgba(34, 26, 18, 0.4)";
  ctx.lineWidth = 1;
  handles.forEach((h) => {
    ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
    ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
  });
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
  resetAdjustments(false);
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

const RATIO_MAP = {
  free: null,
  "1:1": 1,
  "4:3": 4 / 3,
  "3:2": 3 / 2,
  "16:9": 16 / 9,
};

function getNormRatio() {
  if (state.cropAspectRatio === null) return null;
  return state.cropAspectRatio / (state.baseCanvas.width / state.baseCanvas.height);
}

function constrainCropRect() {
  if (!state.cropRect || state.cropAspectRatio === null) return;
  const normRatio = getNormRatio();
  const r = state.cropRect;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let nw = r.w;
  let nh = r.h;
  if (nw / normRatio <= 1) {
    nh = nw / normRatio;
    if (nh > 1) { nh = 1; nw = nh * normRatio; }
  } else {
    nw = nh * normRatio;
    if (nw > 1) { nw = 1; nh = nw / normRatio; }
  }
  state.cropRect = {
    x: clamp(cx - nw / 2, 0, 1 - nw),
    y: clamp(cy - nh / 2, 0, 1 - nh),
    w: nw,
    h: nh,
  };
}

function getCropHandle(pointer) {
  if (!state.cropRect) return null;
  const r = state.cropRect;
  const threshold = 14 / overlayCanvas.width;

  const nearLeft   = Math.abs(pointer.x - r.x) < threshold;
  const nearRight  = Math.abs(pointer.x - (r.x + r.w)) < threshold;
  const nearTop    = Math.abs(pointer.y - r.y) < threshold;
  const nearBottom = Math.abs(pointer.y - (r.y + r.h)) < threshold;
  const insideX    = pointer.x > r.x + threshold && pointer.x < r.x + r.w - threshold;
  const insideY    = pointer.y > r.y + threshold && pointer.y < r.y + r.h - threshold;

  if (nearLeft && nearTop)     return "nw";
  if (nearRight && nearTop)    return "ne";
  if (nearLeft && nearBottom)  return "sw";
  if (nearRight && nearBottom) return "se";
  if (nearTop && insideX)      return "n";
  if (nearBottom && insideX)   return "s";
  if (nearLeft && insideY)     return "w";
  if (nearRight && insideY)    return "e";

  if (pointer.x >= r.x && pointer.x <= r.x + r.w &&
      pointer.y >= r.y && pointer.y <= r.y + r.h) return "move";

  return null;
}

const HANDLE_CURSORS = {
  nw: "nwse-resize", se: "nwse-resize",
  ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize",    s: "ns-resize",
  e: "ew-resize",    w: "ew-resize",
  move: "move",
};

function resizeCropFromHandle(pointer, handle, orig) {
  let { x, y, w, h } = orig;
  const normRatio = getNormRatio();

  if (handle === "nw" || handle === "w" || handle === "sw") {
    const newX = clamp(pointer.x, 0, x + w - 0.01);
    w = x + w - newX;
    x = newX;
  }
  if (handle === "ne" || handle === "e" || handle === "se") {
    w = clamp(pointer.x - x, 0.01, 1 - x);
  }
  if (handle === "nw" || handle === "n" || handle === "ne") {
    const newY = clamp(pointer.y, 0, y + h - 0.01);
    h = y + h - newY;
    y = newY;
  }
  if (handle === "sw" || handle === "s" || handle === "se") {
    h = clamp(pointer.y - y, 0.01, 1 - y);
  }

  if (normRatio !== null) {
    // For corner handles: derive h from w; for edge handles: fix the dominant axis
    const isCorner = handle === "nw" || handle === "ne" || handle === "sw" || handle === "se";
    const isHEdge  = handle === "n" || handle === "s";
    if (isCorner || !isHEdge) {
      h = w / normRatio;
      if (handle === "nw" || handle === "sw") {
        // x was moved — keep bottom/top fixed
        if (handle === "nw") y = orig.y + orig.h - h;
        // sw: y stays (bottom anchor)
      }
      if (handle === "ne" || handle === "nw") {
        y = orig.y + orig.h - h;
      }
    } else {
      w = h * normRatio;
    }
    // Re-clamp after ratio adjustment
    x = clamp(x, 0, 1);
    y = clamp(y, 0, 1);
    w = clamp(w, 0.01, 1 - x);
    h = clamp(h, 0.01, 1 - y);
  }

  state.cropRect = { x, y, w, h };
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
    if (state.cropRect) {
      const handle = getCropHandle(pointer);
      if (handle === "move") {
        state.drag = {
          type: "crop-move",
          offsetX: pointer.x - state.cropRect.x,
          offsetY: pointer.y - state.cropRect.y,
        };
        overlayCanvas.setPointerCapture(event.pointerId);
        return;
      }
      if (handle) {
        state.drag = { type: "crop-resize", handle, origRect: { ...state.cropRect } };
        overlayCanvas.setPointerCapture(event.pointerId);
        return;
      }
    }
    // Draw new rectangle
    state.drag = { type: "crop-draw", start: pointer };
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
  const pointer = getPointerPosition(event);

  // Cursor feedback when not dragging
  if (!state.drag && state.mode === "crop") {
    const handle = getCropHandle(pointer);
    overlayCanvas.style.cursor = handle ? (HANDLE_CURSORS[handle] || "crosshair") : "crosshair";
  }

  if (!state.drag) return;

  if (state.drag.type === "crop-draw") {
    const start = state.drag.start;
    let w = pointer.x - start.x;
    let h = pointer.y - start.y;

    const normRatio = getNormRatio();
    if (normRatio !== null) {
      h = Math.sign(h || 1) * Math.abs(w) / normRatio;
    }

    state.cropRect = {
      x: clamp(Math.min(start.x, start.x + w), 0, 1),
      y: clamp(Math.min(start.y, start.y + h), 0, 1),
      w: clamp(Math.abs(w), 0, 1),
      h: clamp(Math.abs(h), 0, 1),
    };
    scheduleRender();
  }

  if (state.drag.type === "crop-move") {
    const nx = clamp(pointer.x - state.drag.offsetX, 0, 1 - state.cropRect.w);
    const ny = clamp(pointer.y - state.drag.offsetY, 0, 1 - state.cropRect.h);
    state.cropRect.x = nx;
    state.cropRect.y = ny;
    scheduleRender();
  }

  if (state.drag.type === "crop-resize") {
    resizeCropFromHandle(pointer, state.drag.handle, state.drag.origRect);
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

rotateCcwBtn.addEventListener("click", () => { if (!state.busy) rotateImage(-1); });
rotateCwBtn.addEventListener("click",  () => { if (!state.busy) rotateImage(1); });
flipHBtn.addEventListener("click",     () => { if (!state.busy) flipImage("h"); });
flipVBtn.addEventListener("click",     () => { if (!state.busy) flipImage("v"); });

ratioButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    ratioButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.cropAspectRatio = RATIO_MAP[btn.dataset.ratio] ?? null;
    if (state.cropRect && state.cropAspectRatio !== null) constrainCropRect();
    scheduleRender();
  });
});

flipRatioBtn.addEventListener("click", () => {
  if (state.cropAspectRatio === null || state.cropAspectRatio === 1) return;
  state.cropAspectRatio = 1 / state.cropAspectRatio;
  if (state.cropRect) constrainCropRect();
  scheduleRender();
});

cropRotationSlider.addEventListener("input", () => {
  state.cropRotation = parseFloat(cropRotationSlider.value);
  const sign = state.cropRotation > 0 ? "+" : "";
  rotationReadout.textContent = `${sign}${state.cropRotation.toFixed(1)}°`;
  scheduleRender();
});

resetRotationBtn.addEventListener("click", () => {
  cropRotationSlider.value = "0";
  state.cropRotation = 0;
  rotationReadout.textContent = "0.0°";
  scheduleRender();
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
      drawToneCurve();
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
      drawToneCurve();
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

// ─── Tone curve interaction ───────────────────────────────────────────────────

const TC_HIT_RADIUS = 10; // canvas pixels

function tcCanvasToPoint(event) {
  const rect = toneCurveCanvas.getBoundingClientRect();
  const scaleX = toneCurveCanvas.width  / rect.width;
  const scaleY = toneCurveCanvas.height / rect.height;
  const cx = (event.clientX - rect.left) * scaleX;
  const cy = (event.clientY - rect.top)  * scaleY;
  return [
    Math.round(clamp(cx / toneCurveCanvas.width  * 255, 0, 255)),
    Math.round(clamp((1 - cy / toneCurveCanvas.height) * 255, 0, 255)),
  ];
}

function tcHitTest(pt) {
  const pts = state.adjustments.toneCurve[_tcActiveChannel];
  const cx = (v) => (v / 255) * toneCurveCanvas.width;
  const cy = (v) => toneCurveCanvas.height - (v / 255) * toneCurveCanvas.height;
  const rect = toneCurveCanvas.getBoundingClientRect();
  const scaleX = toneCurveCanvas.width / rect.width;
  const scaleY = toneCurveCanvas.height / rect.height;
  const threshold = TC_HIT_RADIUS * Math.max(scaleX, scaleY);

  for (let i = pts.length - 1; i >= 0; i--) {
    const dx = cx(pts[i][0]) - cx(pt[0]);
    const dy = cy(pts[i][1]) - cy(pt[1]);
    if (Math.hypot(dx, dy) <= threshold) return i;
  }
  return -1;
}

toneCurveCanvas.addEventListener("pointerdown", (event) => {
  if (!hasImage()) return;
  event.preventDefault();

  const pt = tcCanvasToPoint(event);
  const hitIdx = tcHitTest(pt);
  const pts = state.adjustments.toneCurve[_tcActiveChannel];

  if (hitIdx >= 0) {
    _tcDragIndex = hitIdx;
  } else {
    // Insert new point, keeping sorted order, min 4px x-gap
    const newPt = [...pt];
    const canInsert = pts.every((p) => Math.abs(p[0] - newPt[0]) >= 4);
    if (canInsert && pts.length < 16) {
      pts.push(newPt);
      pts.sort((a, b) => a[0] - b[0]);
      _tcDragIndex = pts.findIndex((p) => p === newPt);
    }
  }

  toneCurveCanvas.setPointerCapture(event.pointerId);
  drawToneCurve();
  scheduleRender();
});

toneCurveCanvas.addEventListener("pointermove", (event) => {
  const pt = tcCanvasToPoint(event);

  if (_tcDragIndex >= 0) {
    const pts = state.adjustments.toneCurve[_tcActiveChannel];
    const isFirst = _tcDragIndex === 0;
    const isLast  = _tcDragIndex === pts.length - 1;

    // Endpoints: x locked to 0 / 255
    let newX = isFirst ? 0 : isLast ? 255 : pt[0];

    // Constrain x between neighbours with min 4px gap
    if (!isFirst) newX = Math.max(newX, pts[_tcDragIndex - 1][0] + 4);
    if (!isLast)  newX = Math.min(newX, pts[_tcDragIndex + 1][0] - 4);
    newX = clamp(newX, 0, 255);

    pts[_tcDragIndex] = [newX, clamp(pt[1], 0, 255)];

    drawToneCurve();
    scheduleRender();
    scheduleExportEstimate();
  } else {
    const hover = tcHitTest(pt);
    if (hover !== _tcHoverIndex) {
      _tcHoverIndex = hover;
      toneCurveCanvas.style.cursor = hover >= 0 ? "grab" : "crosshair";
      drawToneCurve();
    }
  }
});

toneCurveCanvas.addEventListener("pointerup", (event) => {
  if (_tcDragIndex >= 0) {
    _tcDragIndex = -1;
    toneCurveCanvas.releasePointerCapture(event.pointerId);
    drawToneCurve();
  }
});

toneCurveCanvas.addEventListener("pointercancel", () => {
  _tcDragIndex = -1;
  drawToneCurve();
});

function tcRemovePointAt(event) {
  const pt = tcCanvasToPoint(event);
  const hitIdx = tcHitTest(pt);
  const pts = state.adjustments.toneCurve[_tcActiveChannel];
  if (hitIdx < 0) return;
  if (hitIdx === 0 || hitIdx === pts.length - 1) return; // endpoints locked
  pts.splice(hitIdx, 1);
  _tcHoverIndex = -1;
  drawToneCurve();
  scheduleRender();
  scheduleExportEstimate();
}

toneCurveCanvas.addEventListener("dblclick", tcRemovePointAt);
toneCurveCanvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  tcRemovePointAt(event);
});

// ─── Tone curve button wiring ─────────────────────────────────────────────────

tcChannelBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    _tcActiveChannel = btn.dataset.channel;
    tcChannelBtns.forEach((b) => b.classList.toggle("active", b === btn));
    drawToneCurve();
  });
});

tcPresetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const preset = TONE_CURVE_PRESETS[btn.dataset.preset];
    if (!preset) return;
    state.adjustments.toneCurve = cloneToneCurve(preset);
    // Switch back to RGB tab
    _tcActiveChannel = "rgb";
    tcChannelBtns.forEach((b) => b.classList.toggle("active", b.dataset.channel === "rgb"));
    drawToneCurve();
    scheduleRender();
    scheduleExportEstimate();
  });
});

toneCurveResetBtn.addEventListener("click", () => {
  state.adjustments.toneCurve = cloneToneCurve(DEFAULT_TONE_CURVE);
  _tcActiveChannel = "rgb";
  tcChannelBtns.forEach((b) => b.classList.toggle("active", b.dataset.channel === "rgb"));
  drawToneCurve();
  scheduleRender();
  scheduleExportEstimate();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

syncSliderOutputs();
syncAdjustmentsFromInputs();
syncExportControls();
clearWorkspace();
