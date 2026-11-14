/* Convert images and drawing canvases into the small grids the shape and value analyses read.
   The RGBA conversions are pure so they can be tested; the canvas helpers need a browser. */
import { TONE } from './values.js';

/* Alpha at or above this means the cell holds paint. */
const PAINT_ALPHA = 96;
/* Painted cells darker than this luminance are the dark value; lighter painted cells are mid grey. */
const DARK_LUMINANCE = 0.45;

const lum = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

export function lumFromRGBA(data) {
  const out = new Float32Array(data.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }
  return out;
}

/* A transparent drawing pixel is the paper, which is the light value. */
export function tonesFromRGBA(data) {
  const out = new Uint8Array(data.length / 4);
  for (let i = 0; i < out.length; i++) {
    const a = data[i * 4 + 3];
    if (a < PAINT_ALPHA) {
      out[i] = TONE.light;
      continue;
    }
    // Canvas downscaling premultiplies, so undo alpha before reading the colour.
    const k = 255 / a;
    out[i] = lum(data[i * 4] * k, data[i * 4 + 1] * k, data[i * 4 + 2] * k) < DARK_LUMINANCE ? TONE.dark : TONE.mid;
  }
  return out;
}

export function maskFromRGBA(data) {
  const out = new Uint8Array(data.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = data[i * 4 + 3] >= PAINT_ALPHA ? 1 : 0;
  }
  return out;
}

function sample(source, gw, gh, background) {
  const c = document.createElement('canvas');
  c.width = gw;
  c.height = gh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  if (background) {
    g.fillStyle = background;
    g.fillRect(0, 0, gw, gh);
  }
  g.drawImage(source, 0, 0, gw, gh);
  return g.getImageData(0, 0, gw, gh).data;
}

export const luminanceGrid = (img, gw, gh) => lumFromRGBA(sample(img, gw, gh, '#ffffff'));
export const toneGrid = (drawing, gw, gh) => tonesFromRGBA(sample(drawing, gw, gh, null));
export const paintMask = (drawing, gw, gh) => maskFromRGBA(sample(drawing, gw, gh, null));

/* Grid size with the canvas aspect ratio, cols cells wide. */
export function gridSize(w, h, cols) {
  return { w: cols, h: Math.max(1, Math.round((cols * h) / w)) };
}
