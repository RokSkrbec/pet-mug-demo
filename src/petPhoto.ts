// Client-side pet photo pipeline: downscale -> remove background (in-browser AI, free)
// -> trim transparent edges -> estimate head/neck/body geometry for auto-placing accessories.

export interface PetFit {
  /** All values are in pixels of the trimmed cutout. */
  headTop: number;
  headCx: number;
  headW: number;
  neckY: number;
  neckCx: number;
  neckW: number;
  bodyY: number;
  bodyCx: number;
  bodyW: number;
}

export interface ProcessedPet {
  canvas: HTMLCanvasElement;
  /** Unfiltered cut-out (before the pastel filter), used as input for the AI illustration. */
  raw: HTMLCanvasElement;
  fit: PetFit;
  backgroundRemoved: boolean;
}

const MAX_INPUT = 1600;

async function downscale(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, MAX_INPUT / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
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
  if (maxX < 0) return c; // fully transparent: give back as-is
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Heuristic silhouette analysis on the alpha mask. Good enough as a starting point;
 *  the customer can always drag/resize the accessory afterwards. */
export function analyse(canvas: HTMLCanvasElement): PetFit {
  const A = 200; // analysis width
  const s = A / canvas.width;
  const w = A;
  const h = Math.max(1, Math.round(canvas.height * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  // Per-row opaque pixel count and mean x. Counting pixels (instead of leftmost/rightmost)
  // makes this robust to stray specks the background remover sometimes leaves behind.
  const count: number[] = [];
  const meanX: number[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0, sx = 0;
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 100) {
        n++;
        sx += x;
      }
    }
    count.push(n);
    meanX.push(n ? sx / n : w / 2);
  }
  const minSolid = Math.max(3, w * 0.06);
  const valid = (y: number) => count[y] >= minSolid;
  let top = 0;
  while (top < h - 1 && !valid(top)) top++;
  const H = h - top;
  const row = (f: number) => Math.min(h - 1, Math.round(top + f * H));
  const width = (y: number) => (valid(y) ? count[y] : 0);
  const centre = (y: number) => (valid(y) ? meanX[y] : w / 2);

  // Head: rows 8%–24% from the top of the silhouette.
  const headRows: number[] = [];
  for (let y = row(0.08); y <= row(0.24); y++) if (valid(y)) headRows.push(y);
  const median = (arr: number[]) => {
    const a = [...arr].sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : 0;
  };
  const headW = Math.max(w * 0.25, median(headRows.map(width)));
  const headCx = median(headRows.map(centre)) || w / 2;

  // Neck: narrowest row between 26% and 55%, but never narrower than 45% of head width.
  let neckY = row(0.38);
  let best = Infinity;
  for (let y = row(0.26); y <= row(0.55); y++) {
    const wd = width(y);
    if (wd > headW * 0.45 && wd < best) {
      best = wd;
      neckY = y;
    }
  }
  const neckW = Math.min(width(neckY) || headW, headW * 1.6);
  const bodyY = Math.min(h - 1, Math.round(neckY + H * 0.16));

  const k = 1 / s;
  return {
    headTop: top * k,
    headCx: headCx * k,
    headW: headW * k,
    neckY: neckY * k,
    neckCx: centre(neckY) * k,
    neckW: neckW * k,
    bodyY: bodyY * k,
    bodyCx: centre(bodyY) * k,
    bodyW: Math.min(width(bodyY) || neckW, headW * 2) * k,
  };
}

/** Gentle pastel look: less saturation, lifted shadows, slightly lower contrast, a touch warm. */
export function soften(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    for (let c = 0; c < 3; c++) {
      let v = l + (d[i + c] - l) * 0.8; // saturation 80%
      v = 128 + (v - 128) * 0.86 + 14; // softer contrast, lifted
      d[i + c] = v;
    }
    d[i] += 3;
    d[i + 2] -= 3;
  }
  ctx.putImageData(img, 0, 0);
}

export async function processPetPhoto(
  file: Blob,
  onProgress: (msg: string) => void,
  opts: { soft?: boolean } = {},
): Promise<ProcessedPet> {
  onProgress('Preparing photo…');
  const small = await downscale(file);
  let cutout: Blob = small;
  let backgroundRemoved = true;
  try {
    // Lazy-load the ~1 MB library (plus model) only when a photo is first uploaded.
    const { removeBackground } = await import('@imgly/background-removal');
    cutout = await removeBackground(small, {
      model: 'isnet_quint8', // smallest model (~40 MB, cached by the browser after first use)
      output: { format: 'image/png' },
      progress: (key, cur, total) => {
        if (key.startsWith('fetch')) onProgress(`Downloading AI model… ${Math.round((cur / total) * 100)}%`);
        else onProgress('Removing background…');
      },
    });
  } catch (err) {
    console.error('Background removal failed, using original photo', err);
    backgroundRemoved = false;
  }
  onProgress('Placing pet…');
  const bmp = await createImageBitmap(cutout);
  const canvas = trim(bmp, bmp.width, bmp.height);
  bmp.close();
  const raw = document.createElement('canvas');
  raw.width = canvas.width;
  raw.height = canvas.height;
  raw.getContext('2d')!.drawImage(canvas, 0, 0);
  if (opts.soft) soften(canvas);
  return { canvas, raw, fit: analyse(canvas), backgroundRemoved };
}
