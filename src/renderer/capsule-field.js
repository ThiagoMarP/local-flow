// The capsule's voice animation: a dithered pixel mist that fills the whole
// pill and lights up with the voice. The canvas matches the pill's size at
// 1 px per CSS px and the mist is drawn in 2x2 cells, so the grain stays crisp
// however wide the pill grows (lock icon, hints).
const MIST_CELL = 2;
const HISTORY_LENGTH = 40;
const HISTORY_STEP_MS = 50;
const SUCCESS_MS = 440;

const PALETTES = {
  white: ["#0a0a0c", "#1b1b20", "#3a3a41", "#74747c", "#bdbdc3", "#f7f7f8"],
  // The last seconds before the duration limit.
  amber: ["#0a0a0c", "#3a2306", "#7a4a0c", "#c27a16", "#f6b94a", "#fff1d6"],
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
  .map((value) => (value + 0.5) / 16);

function toRgb(hex) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}
const RGB = Object.fromEntries(
  Object.entries(PALETTES).map(([name, colors]) => [name, colors.map(toRgb)]),
);

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function noise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y) {
  return noise(x, y) * 0.6 + noise(x * 2.1, y * 2.1) * 0.3 +
    noise(x * 4.3, y * 4.3) * 0.1;
}

// Ordered dithering: a value between two palette steps becomes a fixed
// pattern of both, which is what gives the mist its pixel grain.
function dither(value, x, y, steps) {
  const scaled = Math.max(0, Math.min(1, value)) * (steps - 1);
  const base = Math.floor(scaled);
  const up = scaled - base > BAYER[(y % 4) * 4 + (x % 4)] ? 1 : 0;
  return Math.min(steps - 1, base + up);
}

// Brightness of a travelling crest at horizontal position u (0..1).
function crest(u, center, width = 0.012) {
  return Math.exp(-((u - center) ** 2) / width);
}

// How bright each column is outside recording; t is in seconds.
function columnEnergy(mode, u, t, successProgress) {
  if (mode === "processing") return crest(u, ((t * 0.9) % 1.3) - 0.15);
  if (mode === "revising") {
    // Two crests closing in on the centre: the local AI consolidating.
    const p = (t * 0.8) % 1;
    return Math.max(crest(u, p * 0.5), crest(u, 1 - p * 0.5));
  }
  if (mode === "success") return Math.sin(Math.PI * successProgress) * 0.95;
  return 0;
}

export function createCapsuleField(canvas) {
  const context = canvas.getContext("2d");
  const history = new Array(HISTORY_LENGTH).fill(0);
  let image = null;

  let mode = "idle";
  let palette = "white";
  let target = 0;
  let level = 0;
  let frame = null;
  let lastStep = 0;
  let successAt = 0;

  // Follows the pill as it grows or shrinks.
  function fit() {
    const width = Math.max(MIST_CELL, Math.round(canvas.clientWidth));
    const height = Math.max(MIST_CELL, Math.round(canvas.clientHeight));
    if (image && canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    image = context.createImageData(width, height);
  }

  function draw(now) {
    frame = window.requestAnimationFrame(draw);
    fit();
    const t = now / 1000;
    level += (target - level) * 0.25;
    if (now - lastStep >= HISTORY_STEP_MS) {
      lastStep = now;
      history.shift();
      history.push(mode === "recording" ? level : 0);
    }
    const successProgress = Math.min(1, (now - successAt) / SUCCESS_MS);
    const colors = RGB[palette];
    const steps = colors.length;
    const width = canvas.width;
    const cellsX = Math.ceil(width / MIST_CELL);
    const cellsY = Math.ceil(canvas.height / MIST_CELL);
    const data = image.data;

    for (let cy = 0; cy < cellsY; cy++) {
      const dy = Math.abs(cy - (cellsY - 1) / 2) / (cellsY / 2);
      for (let cx = 0; cx < cellsX; cx++) {
        const u = cx / cellsX;
        const dx = Math.abs(u - 0.5) * 2;
        const n = fbm(cx * 0.11 - t * 0.9, cy * 0.28 + t * 0.15);
        let value;
        if (mode === "recording") {
          // The voice scrolls from right to left across the pill.
          const voice = history[Math.floor(u * HISTORY_LENGTH)];
          const energy = 0.25 + level * 0.6 + voice * 0.65;
          value = n * energy * (1.2 - dy * 0.7) * (1.1 - dx * 0.4);
        } else {
          const band = columnEnergy(mode, u, t, successProgress);
          value = n * 0.32 + band * (1 - dy * 0.6) * 0.8;
        }
        const color = colors[dither(value, cx, cy, steps)];
        for (let py = 0; py < MIST_CELL; py++) {
          const y = cy * MIST_CELL + py;
          if (y >= canvas.height) break;
          for (let px = 0; px < MIST_CELL; px++) {
            const x = cx * MIST_CELL + px;
            if (x >= width) break;
            const offset = (y * width + x) * 4;
            data[offset] = color[0];
            data[offset + 1] = color[1];
            data[offset + 2] = color[2];
            data[offset + 3] = 255;
          }
        }
      }
    }
    context.putImageData(image, 0, 0);
  }

  function start() {
    if (frame === null) frame = window.requestAnimationFrame(draw);
  }

  function stop() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    history.fill(0);
    level = 0;
  }

  return {
    // Called on every capsule state. Only animating states keep the loop on,
    // so the hidden capsule costs nothing.
    update({ state, level: nextLevel = 0, hint = "" }) {
      const nextMode = state === "meeting" ? "recording" : state;
      if (nextMode === "success" && mode !== "success") successAt = performance.now();
      mode = nextMode;
      palette = hint === "countdown" ? "amber" : "white";
      target = Math.max(0, Math.min(1, Number(nextLevel) || 0));
      if (["recording", "processing", "revising", "success"].includes(mode)) start();
      else stop();
    },
  };
}
