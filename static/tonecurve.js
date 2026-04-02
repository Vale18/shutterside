// ─── Catmull-Rom spline tone curve utilities ──────────────────────────────────
// Pure math module — no DOM, no imports from other project modules.

/**
 * Evaluate one Catmull-Rom segment at parameter t ∈ [0,1].
 * Uses standard Catmull-Rom matrix form.
 */
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * Build a 256-entry Uint8Array LUT from an array of [x, y] control points.
 * Points must be sorted by x and have x ∈ [0, 255].
 * Edge segments use phantom points (reflection) for natural boundary behavior.
 */
export function buildLUT(points) {
  const lut = new Uint8Array(256);

  if (points.length < 2) {
    // Degenerate: fill with identity
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }

  // Sorted copy
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;

  for (let x = 0; x < 256; x++) {
    // Find segment index: pts[seg].x <= x < pts[seg+1].x
    let seg = 0;
    for (let i = 0; i < n - 1; i++) {
      if (x <= pts[i + 1][0]) { seg = i; break; }
      seg = i;
    }

    const x1 = pts[seg][0];
    const x2 = pts[seg + 1][0];
    const t = x2 > x1 ? (x - x1) / (x2 - x1) : 0;

    // Get the four y control values with phantom endpoints
    const y0 = seg > 0          ? pts[seg - 1][1] : 2 * pts[0][1]       - pts[1][1];
    const y1 = pts[seg][1];
    const y2 = pts[seg + 1][1];
    const y3 = seg + 2 < n      ? pts[seg + 2][1] : 2 * pts[n - 1][1]   - pts[n - 2][1];

    const value = catmullRom(y0, y1, y2, y3, t);
    lut[x] = Math.min(255, Math.max(0, Math.round(value)));
  }

  return lut;
}

/**
 * Compose master RGB curve with per-channel curves.
 * Pipeline: pixel → masterRGB LUT → per-channel LUT
 * Returns { lutR, lutG, lutB } each a Uint8Array(256).
 */
export function buildCompositeLUTs(rgb, r, g, b) {
  const master = buildLUT(rgb);
  const chanR  = buildLUT(r);
  const chanG  = buildLUT(g);
  const chanB  = buildLUT(b);

  const lutR = new Uint8Array(256);
  const lutG = new Uint8Array(256);
  const lutB = new Uint8Array(256);

  for (let i = 0; i < 256; i++) {
    lutR[i] = chanR[master[i]];
    lutG[i] = chanG[master[i]];
    lutB[i] = chanB[master[i]];
  }

  return { lutR, lutG, lutB };
}

/** Returns true if points array is exactly the identity [[0,0],[255,255]]. */
export function isIdentityCurve(points) {
  if (points.length !== 2) return false;
  return (
    points[0][0] === 0   && points[0][1] === 0 &&
    points[1][0] === 255 && points[1][1] === 255
  );
}

/** Returns true if all four channels in a toneCurve object are identity. */
export function isToneCurveIdentity(toneCurve) {
  return (
    isIdentityCurve(toneCurve.rgb) &&
    isIdentityCurve(toneCurve.r)   &&
    isIdentityCurve(toneCurve.g)   &&
    isIdentityCurve(toneCurve.b)
  );
}

/** Deep-clone a toneCurve object { rgb, r, g, b }. */
export function cloneToneCurve(tc) {
  return {
    rgb: tc.rgb.map((p) => [...p]),
    r:   tc.r.map((p)   => [...p]),
    g:   tc.g.map((p)   => [...p]),
    b:   tc.b.map((p)   => [...p]),
  };
}

/** Deep-compare two tone curve objects. */
export function toneCurvesEqual(a, b) {
  const chans = ["rgb", "r", "g", "b"];
  for (const ch of chans) {
    if (a[ch].length !== b[ch].length) return false;
    for (let i = 0; i < a[ch].length; i++) {
      if (a[ch][i][0] !== b[ch][i][0] || a[ch][i][1] !== b[ch][i][1]) return false;
    }
  }
  return true;
}

/** Preset curve point sets. */
export const TONE_CURVE_PRESETS = {
  linear: {
    rgb: [[0, 0], [255, 255]],
    r:   [[0, 0], [255, 255]],
    g:   [[0, 0], [255, 255]],
    b:   [[0, 0], [255, 255]],
  },
  mediumContrast: {
    rgb: [[0, 0], [64, 48], [192, 208], [255, 255]],
    r:   [[0, 0], [255, 255]],
    g:   [[0, 0], [255, 255]],
    b:   [[0, 0], [255, 255]],
  },
  strongContrast: {
    rgb: [[0, 0], [48, 28], [96, 72], [160, 184], [208, 228], [255, 255]],
    r:   [[0, 0], [255, 255]],
    g:   [[0, 0], [255, 255]],
    b:   [[0, 0], [255, 255]],
  },
};
