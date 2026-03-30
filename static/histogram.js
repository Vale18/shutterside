export function computeHistogramBins(imageData) {
  const px = imageData.data;
  const total = px.length / 4;

  const rB = new Uint32Array(256);
  const gB = new Uint32Array(256);
  const bB = new Uint32Array(256);

  for (let i = 0; i < px.length; i += 4) {
    rB[px[i]]++;
    gB[px[i + 1]]++;
    bB[px[i + 2]]++;
  }

  return { rB, gB, bB, total };
}

export function detectClipping(bins, total) {
  const clipThresh = total * 0.003;
  return {
    shadow: (bins.rB[0] + bins.gB[0] + bins.bB[0]) / 3 > clipThresh,
    highlight: (bins.rB[255] + bins.gB[255] + bins.bB[255]) / 3 > clipThresh,
  };
}

export function drawHistogram(canvas, bins) {
  const hCtx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  hCtx.fillStyle = "#1c1612";
  hCtx.fillRect(0, 0, W, H);

  const { rB, gB, bB } = bins;

  let peak = 1;
  for (let i = 1; i < 255; i++) {
    if (rB[i] > peak) peak = rB[i];
    if (gB[i] > peak) peak = gB[i];
    if (bB[i] > peak) peak = bB[i];
  }

  const channels = [
    { b: rB, fill: "rgba(210, 55, 35, 0.62)" },
    { b: gB, fill: "rgba(50, 175, 65, 0.52)" },
    { b: bB, fill: "rgba(55, 115, 220, 0.60)" },
  ];

  for (const { b, fill } of channels) {
    hCtx.fillStyle = fill;
    hCtx.beginPath();
    hCtx.moveTo(0, H);
    for (let i = 0; i < 256; i++) {
      hCtx.lineTo((i / 255) * W, H - Math.min(b[i] / peak, 1) * H);
    }
    hCtx.lineTo(W, H);
    hCtx.closePath();
    hCtx.fill();
  }

  let lumPeak = 1;
  const lum = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    lum[i] = 0.2126 * rB[i] + 0.7152 * gB[i] + 0.0722 * bB[i];
    if (i > 0 && i < 255 && lum[i] > lumPeak) lumPeak = lum[i];
  }

  hCtx.strokeStyle = "rgba(255, 245, 228, 0.45)";
  hCtx.lineWidth = 1;
  hCtx.beginPath();
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * W;
    const y = H - Math.min(lum[i] / lumPeak, 1) * H;
    i === 0 ? hCtx.moveTo(x, y) : hCtx.lineTo(x, y);
  }
  hCtx.stroke();
}
