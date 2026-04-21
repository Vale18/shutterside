import * as api from "./api.js";
import { cloneToneCurve, isToneCurveIdentity } from "./tonecurve.js";

export const DEFAULT_TONE_CURVE = {
  rgb: [[0, 0], [255, 255]],
  r:   [[0, 0], [255, 255]],
  g:   [[0, 0], [255, 255]],
  b:   [[0, 0], [255, 255]],
};

const DEFAULT_ADJUSTMENTS = {
  brightness: 0,
  contrast: 0,
  toneCurve: DEFAULT_TONE_CURVE,
  saturation: 0,
  warmth: 0,
  grayscale: 0,
};

export { DEFAULT_ADJUSTMENTS };

export const state = {
  mode: "preview",
  busy: false,
  originalName: "image",
  originalDataUrl: null,
  cropRect: null,
  cropAspectRatio: null,
  cropRotation: 0,
  perspectivePoints: defaultPerspectivePoints(),
  drag: null,
  previewWidth: 0,
  previewHeight: 0,
  renderHandle: 0,
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  exportSettings: {
    format: "png",
    compression: 35,
  },
  estimateHandle: 0,
  estimateToken: 0,
  baseCanvas: document.createElement("canvas"),
  baseCtx: null,
  history: [],
  historyIndex: -1,
  beforeAfterMode: false,
  sessionId: null,
  zoomLevel: 1,
  zoomPanX: 0,
  zoomPanY: 0,
  histogramVisible: true,
  beforeAfterSplitX: null,
};

state.baseCtx = state.baseCanvas.getContext("2d", { willReadFrequently: true });

export function defaultPerspectivePoints() {
  return [
    { x: 0.08, y: 0.08 },
    { x: 0.92, y: 0.08 },
    { x: 0.92, y: 0.92 },
    { x: 0.08, y: 0.92 },
  ];
}

export function hasImage() {
  return state.baseCanvas.width > 0 && state.baseCanvas.height > 0;
}

export function hasActiveAdjustments() {
  return Object.entries(DEFAULT_ADJUSTMENTS).some(([key, defaultValue]) => {
    if (key === "toneCurve") return !isToneCurveIdentity(state.adjustments.toneCurve);
    return state.adjustments[key] !== defaultValue;
  });
}

export function resetEditState() {
  state.cropRect = null;
  state.cropAspectRatio = null;
  state.cropRotation = 0;
  state.perspectivePoints = defaultPerspectivePoints();
  state.drag = null;
  state.adjustments = { ...DEFAULT_ADJUSTMENTS, toneCurve: cloneToneCurve(DEFAULT_TONE_CURVE) };
}

export function drawToBaseCanvas(image) {
  state.baseCanvas.width = image.naturalWidth || image.width;
  state.baseCanvas.height = image.naturalHeight || image.height;
  state.baseCtx.clearRect(0, 0, state.baseCanvas.width, state.baseCanvas.height);
  state.baseCtx.drawImage(image, 0, 0);
}

export function clearBaseCanvas() {
  state.baseCanvas.width = 0;
  state.baseCanvas.height = 0;
}

export function replaceBaseCanvas(nextCanvas) {
  state.baseCanvas.width = nextCanvas.width;
  state.baseCanvas.height = nextCanvas.height;
  state.baseCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  state.baseCtx.drawImage(nextCanvas, 0, 0);
}

export function sanitizeBaseName(filename) {
  return (filename || "image")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "image";
}

// ─── Session helpers ──────────────────────────────────────────────────────────

export async function createSession(dataUrl) {
  state.sessionId = await api.postSession(dataUrl);
}

export async function deleteSession() {
  if (!state.sessionId) return;
  const id = state.sessionId;
  state.sessionId = null;
  await api.deleteSession(id);
}

// ─── History ──────────────────────────────────────────────────────────────────

export function snapshotBaseCanvas() {
  const snap = document.createElement("canvas");
  snap.width = state.baseCanvas.width;
  snap.height = state.baseCanvas.height;
  snap.getContext("2d").drawImage(state.baseCanvas, 0, 0);
  return snap;
}

export let lastCommittedEditState = {
  ...DEFAULT_ADJUSTMENTS,
  toneCurve: cloneToneCurve(DEFAULT_TONE_CURVE),
};

export function snapshotEditState() {
  return { ...state.adjustments, toneCurve: cloneToneCurve(state.adjustments.toneCurve) };
}

export function pushHistory(label, { baseChanged = false } = {}) {
  state.history = state.history.slice(0, state.historyIndex + 1);

  const prevSnapshot = state.history.length > 0
    ? state.history[state.history.length - 1].baseSnapshot
    : null;

  const baseSnapshot = baseChanged ? snapshotBaseCanvas() : prevSnapshot;

  state.history.push({ label, editState: snapshotEditState(), baseSnapshot });
  if (state.history.length > 5) {
    state.history.shift();
  }
  state.historyIndex = state.history.length - 1;
  lastCommittedEditState = snapshotEditState();
}

export function resetHistory() {
  state.history = [];
  state.historyIndex = -1;
}

export function canUndo() {
  return state.historyIndex > 0;
}

export function canRedo() {
  return state.historyIndex < state.history.length - 1;
}

export function jumpHistory(index) {
  if (index < 0 || index >= state.history.length) return null;
  state.historyIndex = index;
  const snapshot = state.history[index];
  if (snapshot.baseSnapshot) replaceBaseCanvas(snapshot.baseSnapshot);
  state.adjustments = { ...snapshot.editState, toneCurve: cloneToneCurve(snapshot.editState.toneCurve) };
  lastCommittedEditState = snapshotEditState();
  return snapshot;
}

export function stepHistory(direction) {
  if (direction === -1 && !canUndo()) return null;
  if (direction === 1 && !canRedo()) return null;
  state.historyIndex += direction;
  const snapshot = state.history[state.historyIndex];
  if (snapshot.baseSnapshot) replaceBaseCanvas(snapshot.baseSnapshot);
  state.adjustments = { ...snapshot.editState, toneCurve: cloneToneCurve(snapshot.editState.toneCurve) };
  lastCommittedEditState = snapshotEditState();
  return snapshot;
}

// ─── Adjustment diff helpers ──────────────────────────────────────────────────

function toneCurvesEqual(a, b) {
  const channels = ["rgb", "r", "g", "b"];
  return channels.every((ch) => {
    const pa = a[ch], pb = b[ch];
    if (!pa || !pb || pa.length !== pb.length) return false;
    return pa.every((pt, i) => pt[0] === pb[i][0] && pt[1] === pb[i][1]);
  });
}

export function slidersDiffer(a, b) {
  if (!a || !b) return false;
  const keys = ["brightness", "contrast", "saturation", "warmth", "grayscale"];
  return keys.some((k) => a[k] !== b[k]);
}

export function toneCurveDiffers(a, b) {
  if (!a || !b) return false;
  return !toneCurvesEqual(a.toneCurve, b.toneCurve);
}

export function adjustmentsDiffer(a, b) {
  return slidersDiffer(a, b) || toneCurveDiffers(a, b);
}
