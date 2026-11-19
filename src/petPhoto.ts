// Client-side image helpers:
//  - photoToJpegBase64: shrink the customer's photo before sending it to the AI (small upload)
//  - cutout: remove the AI illustration's green-screen background (chromaKey.ts, instant, no model) + trim
import { chromaKey } from './chromaKey';

export interface Cutout {
  canvas: HTMLCanvasElement;
  backgroundRemoved: boolean;
}

/** Downscale to max `max` px on the longest side and return base64 JPEG (no data: prefix). */
export async function photoToJpegBase64(file: Blob, max = 1024): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // transparent PNGs → white, not black
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}

/** Remove isolated specks: keep only connected blobs with at least `minShare` of the largest blob's area. */
export function removeSpecks(data: Uint8ClampedArray, w: number, h: number, minShare = 0.003) {
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] === 0) continue;
    const id = sizes.length;
    let n = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      n++;
      const x = p % w;
      const y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && label[q] === -1 && data[q * 4 + 3] !== 0) {
          label[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(n);
  }
  const min = sizes.reduce((m, s) => Math.max(m, s), 0) * minShare;
  for (let p = 0; p < w * h; p++) if (label[p] >= 0 && sizes[label[p]] < min) data[p * 4 + 3] = 0;
}

/** Cut the pet out of the AI illustration and trim the transparent edges. */
export async function cutout(image: Blob): Promise<Cutout> {
  const bmp = await createImageBitmap(image);
  const { width: w, height: h } = bmp;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  const backgroundRemoved = chromaKey(img.data, w, h) !== null;
  if (!backgroundRemoved) console.warn('No flat background found, using the illustration as-is');
  else removeSpecks(img.data, w, h);
  ctx.putImageData(img, 0, 0);
  return { canvas: trim(c, img.data, w, h), backgroundRemoved };
}

function trim(src: HTMLCanvasElement, data: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return src;
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
