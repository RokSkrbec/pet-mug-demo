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

function trim(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);
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
