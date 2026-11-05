// The capsule's voice animation: a dithered pixel mist underneath, with the
// voice drawn on top as tiny ASCII glyphs (. : - = + * #) that scroll from
// right to left. Everything is drawn into one small canvas at 1 px per cell,
// so it stays crisp when the window scales it up.
const WIDTH = 120;
const HEIGHT = 20;
const MIST_CELL = 2;
const GLYPH_W = 4;
const GLYPH_H = 6;
const HISTORY_STEP_MS = 50;
const SUCCESS_MS = 440;

const PALETTES = {
  blue: ["#050a1f", "#0d1d52", "#1f4499", "#3f80dc", "#8ccaff", "#e8f5ff"],
  // The last seconds before the duration limit.
  amber: ["#050a1f", "#3a2306", "#7a4a0c", "#c27a16", "#f6b94a", "#fff1d6"],
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
  .map((value) => (value + 0.5) / 16);

// 3x5 glyphs from faintest to brightest.
const GLYPHS = [
  null,
  ["...", "...", "...", "...", ".#."],
  ["...", ".#.", "...", ".#.", "..."],
  ["...", "...", "###", "...", "..."],
  ["...", "###", "...", "###", "..."],
  ["...", ".#.", "###", ".#.", "..."],
  ["#.#", ".#.", "###", ".#.", "#.#"],
  [".#.", "###", ".#.", "###", ".#."],
].map((rows) => rows && rows.flatMap((row, y) =>
  [...row].flatMap((cell, x) => (cell === "#" ? [[x, y]] : []))));

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

// How bright each column is, per state. `voice` is the scrolled level at that
// column; t is in seconds.
function columnEnergy(mode, u, voice, t, successProgress) {
  if (mode === "processing") return crest(u, ((t * 0.9) % 1.3) - 0.15);
  if (mode === "revising") {
    // Two crests closing in on the centre: the local AI consolidating.
    const p = (t * 0.8) % 1;
    return Math.max(crest(u, p * 0.5), crest(u, 1 - p * 0.5));
  }
  if (mode === "success") return Math.sin(Math.PI * successProgress) * 0.95;
  return voice;
}

export function createCapsuleField(canvas) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  const image = context.createImageData(WIDTH, HEIGHT);
  const columns = Math.floor(WIDTH / GLYPH_W);
  const rows = Math.floor(HEIGHT / GLYPH_H);
  const glyphTop = Math.floor((HEIGHT - rows * GLYPH_H) / 2) + 1;
  const history = new Array(columns).fill(0);

  let mode = "idle";
  let palette = "blue";
  let target = 0;
  let level = 0;
  let frame = null;
  let lastStep = 0;
  let successAt = 0;

  function draw(now) {
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

    // Mist layer, one value per 2x2 cell.
    const data = image.data;
    for (let cy = 0; cy < HEIGHT / MIST_CELL; cy++) {
      const dy = Math.abs(cy - (HEIGHT / MIST_CELL - 1) / 2) / (HEIGHT / MIST_CELL / 2);
      for (let cx = 0; cx < WIDTH / MIST_CELL; cx++) {
        const u = cx / (WIDTH / MIST_CELL);
        const dx = Math.abs(u - 0.5) * 2;
        const n = fbm(cx * 0.11 - t * 0.9, cy * 0.28 + t * 0.15);
        const voice = history[Math.floor(u * columns)];
        const energy = mode === "recording"
          ? 0.22 + level * 0.55 + voice * 0.45
          : 0.2 + columnEnergy(mode, u, voice, t, successProgress) * 0.75;
        const value = n * energy * (1.15 - dy * 0.75) * (1.1 - dx * 0.45);
        const color = colors[Math.min(steps - 2, dither(value, cx, cy, steps))];
        for (let py = 0; py < MIST_CELL; py++) {
          for (let px = 0; px < MIST_CELL; px++) {
            const offset = ((cy * MIST_CELL + py) * WIDTH + cx * MIST_CELL + px) * 4;
            data[offset] = color[0];
            data[offset + 1] = color[1];
            data[offset + 2] = color[2];
            data[offset + 3] = 255;
          }
        }
      }
    }

    // ASCII layer on top: the wave itself, brightest in the middle row.
    for (let column = 0; column < columns; column++) {
      const u = column / columns;
      const voice = history[column] * (0.75 + 0.25 * noise(column * 0.5, t * 3));
      const amplitude = columnEnergy(mode, u, voice, t, successProgress);
      for (let row = 0; row < rows; row++) {
        const dy = Math.abs(row - (rows - 1) / 2) / (rows / 2);
        const value = amplitude * 1.2 - dy * 0.55 +
          (noise(column * 0.7, row + t * 2) - 0.5) * 0.15;
        const glyph = GLYPHS[Math.max(0, Math.min(GLYPHS.length - 1,
          Math.floor(value * GLYPHS.length)))];
        if (!glyph) continue;
        const color = colors[Math.min(steps - 1, 2 + Math.floor(value * (steps - 2)))];
        for (const [gx, gy] of glyph) {
          const offset = ((glyphTop + row * GLYPH_H + gy) * WIDTH + column * GLYPH_W + gx) * 4;
          data[offset] = color[0];
          data[offset + 1] = color[1];
          data[offset + 2] = color[2];
        }
      }
    }
    context.putImageData(image, 0, 0);
    frame = window.requestAnimationFrame(draw);
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
      palette = hint === "countdown" ? "amber" : "blue";
      target = Math.max(0, Math.min(1, Number(nextLevel) || 0));
      if (["recording", "processing", "revising", "success"].includes(mode)) start();
      else stop();
    },
  };
}
