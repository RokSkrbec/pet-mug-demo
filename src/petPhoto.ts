// Client-side image helpers:
//  - photoToJpegBase64: shrink the customer's photo before sending it to the AI (small upload)
//  - cutout: in-browser background removal (free) + trim, used on the AI illustration

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

const BG_CONFIG = {
  model: 'isnet_quint8' as const, // smallest model (~40 MB, cached by the browser after first use)
  output: { format: 'image/png' as const },
};

/** Start downloading the background-removal model early (e.g. while the AI is painting). */
export async function preloadBackgroundRemoval() {
  try {
    const { preload } = await import('@imgly/background-removal');
    await preload(BG_CONFIG);
  } catch (err) {
    console.warn('Background removal preload failed', err);
  }
}

/**
 * Drop faint leftovers (paper texture / halo the background remover keeps at low alpha) and re-stretch
 * the rest, so edges stay soft. Invisible on white products, but needed on coloured shirts.
 */
export function cleanAlpha(data: Uint8ClampedArray, cut = 80) {
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    data[i] = a <= cut ? 0 : Math.min(255, ((a - cut) * 255) / (255 - cut) * 1.15);
  }
}

/** Remove isolated specks: keep only connected blobs with at least `minShare` of the largest blob's area. */
export function removeSpecks(data: Uint8ClampedArray, w: number, h: number, minShare = 0.02) {
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
  const min = Math.max(...sizes, 0) * minShare;
  for (let p = 0; p < w * h; p++) if (label[p] >= 0 && sizes[label[p]] < min) data[p * 4 + 3] = 0;
}

function trim(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  cleanAlpha(img.data);
  removeSpecks(img.data, w, h);
  ctx.putImageData(img, 0, 0);
  const { data } = img;
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
  if (maxX < 0) return c;
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Remove the background (in the browser, free) and trim transparent edges. */
export async function cutout(image: Blob, onProgress: (msg: string) => void = () => {}): Promise<Cutout> {
  let result: Blob = image;
  let backgroundRemoved = true;
  try {
    const { removeBackground } = await import('@imgly/background-removal');
    result = await removeBackground(image, {
      ...BG_CONFIG,
      progress: (key, cur, total) => {
        if (key.startsWith('fetch')) onProgress(`Preparing… ${Math.round((cur / total) * 100)}%`);
        else onProgress('Finishing touches…');
      },
    });
  } catch (err) {
    console.error('Background removal failed, using image as-is', err);
    backgroundRemoved = false;
  }
  const bmp = await createImageBitmap(result);
  const canvas = trim(bmp, bmp.width, bmp.height);
  bmp.close();
  return { canvas, backgroundRemoved };
}
