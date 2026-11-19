// Photo-realistic product mockups.
//
// Each product has a real (AI-generated, one-off) photo of the blank white product plus a cut-out mask.
// The flat print is warped onto the product (mesh warp: cylinder for the mug, a pinched patch for the
// pillow, a rectangle for the t-shirt), then MULTIPLIED with the photo's own shading so the lighting,
// curvature, fabric texture and folds of the real product show through the print. The t-shirt is
// recoloured the same way (colour × shading), so every shirt colour keeps the real folds.
//
// Everything is plain Canvas 2D; it runs on every drag frame, so it's kept cheap (~200–300 triangles).

export type Pt = [number, number];

export type Warp =
  /** Mug: the print wraps a cylinder. `arc` = angle the print covers (radians); rim/base curves from perspective. */
  | { kind: 'cylinder'; cx: number; r: number; top: number; bottom: number; ryTop: number; ryBottom: number; arc: number }
  /** Pillow: Coons patch through 4 corners with one mid-point per edge (edges bow inwards). */
  | { kind: 'patch'; tl: Pt; tr: Pt; br: Pt; bl: Pt; top: Pt; right: Pt; bottom: Pt; left: Pt }
  /** T-shirt: flat print rectangle. */
  | { kind: 'rect'; x: number; y: number; w: number; h: number };

export interface PhotoMockupDef {
  photo: string;
  mask: string;
  /** Photo size in px (square). All geometry below is in photo px. */
  size: number;
  /** Part of the photo shown in the preview. */
  crop: { x: number; y: number; w: number; h: number };
  warp: Warp;
  /** Recolour the product (t-shirt colours). */
  recolor?: boolean;
}

export interface LoadedMockup {
  def: PhotoMockupDef;
  photo: HTMLImageElement;
  mask: HTMLImageElement;
  /** Grayscale shading (1 = brightest part of the product), alpha = product mask. */
  shade: HTMLCanvasElement;
}

/** Where one product photo is drawn on the stage (stage px). Mirrored views show the handle on the left. */
export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
  mirror: boolean;
}

const img = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

export async function loadMockup(def: PhotoMockupDef): Promise<LoadedMockup> {
  const [photo, mask] = await Promise.all([img(def.photo), img(def.mask)]);
  const S = def.size;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(mask, 0, 0, S, S);
  const m = ctx.getImageData(0, 0, S, S).data;
  ctx.clearRect(0, 0, S, S);
  ctx.drawImage(photo, 0, 0, S, S);
  const id = ctx.getImageData(0, 0, S, S);
  const d = id.data;
  // Reference brightness = 97th percentile inside the product, so the lit part of the product = 1.0.
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) if (m[i + 3] > 200) hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
  let total = 0;
  for (const h of hist) total += h;
  let acc = 0;
  let ref = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.97) {
      ref = Math.max(1, v);
      break;
    }
  }
  for (let i = 0; i < d.length; i += 4) {
    const l = Math.min(255, ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / ref) * 255);
    d[i] = d[i + 1] = d[i + 2] = l;
    d[i + 3] = m[i + 3];
  }
  ctx.putImageData(id, 0, 0);
  return { def, photo, mask, shade: c };
}

// ---------------------------------------------------------------- geometry

/** Photo px → stage px for a view. */
export function toStage(v: View, crop: PhotoMockupDef['crop'], p: Pt): Pt {
  const k = v.w / crop.w;
  return [v.mirror ? v.x + (crop.x + crop.w - p[0]) * k : v.x + (p[0] - crop.x) * k, v.y + (p[1] - crop.y) * k];
}

const quad = (a: Pt, mid: Pt, b: Pt, t: number): Pt => {
  // quadratic Bézier through `mid` at t = 0.5
  const c: Pt = [2 * mid[0] - (a[0] + b[0]) / 2, 2 * mid[1] - (a[1] + b[1]) / 2];
  const s = 1 - t;
  return [s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]];
};

/** Print (u, v) ∈ [0,1]² → photo px. */
export function warpPoint(w: Warp, u: number, v: number): Pt {
  if (w.kind === 'rect') return [w.x + u * w.w, w.y + v * w.h];
  if (w.kind === 'cylinder') {
    const th = (u - 0.5) * w.arc;
    const yT = w.top + w.ryTop * Math.cos(th);
    const yB = w.bottom + w.ryBottom * Math.cos(th);
    return [w.cx + w.r * Math.sin(th), yT + (yB - yT) * v];
  }
  // Coons patch
  const c0 = quad(w.tl, w.top, w.tr, u);
  const c1 = quad(w.bl, w.bottom, w.br, u);
  const d0 = quad(w.tl, w.left, w.bl, v);
  const d1 = quad(w.tr, w.right, w.br, v);
  const bil = (i: 0 | 1) => (1 - u) * (1 - v) * w.tl[i] + u * (1 - v) * w.tr[i] + (1 - u) * v * w.bl[i] + u * v * w.br[i];
  return [(1 - v) * c0[0] + v * c1[0] + (1 - u) * d0[0] + u * d1[0] - bil(0), (1 - v) * c0[1] + v * c1[1] + (1 - u) * d0[1] + u * d1[1] - bil(1)];
}

/**
 * Flat stand-in rectangle (stage px) for the interactive editor: matches the warped print at its centre,
 * so dragging/handles line up where the design usually sits.
 */
export function flatRect(def: PhotoMockupDef, v: View, printW: number, printH: number) {
  const f = (u: number, vv: number) => toStage(v, def.crop, warpPoint(def.warp, v.mirror ? 1 - u : u, vv));
  const c = f(0.5, 0.5);
  let width: number;
  if (def.warp.kind === 'cylinder') width = def.warp.r * def.warp.arc * (v.w / def.crop.w); // centre-matched
  else width = Math.abs(f(1, 0.5)[0] - f(0, 0.5)[0]);
  const scale = width / printW;
  return { x: c[0] - width / 2, y: c[1] - (printH * scale) / 2, scale };
}

// ---------------------------------------------------------------- drawing

/** Affine-textured triangle: maps src triangle (image px) onto dst triangle (current ctx coords). */
function tri(ctx: CanvasRenderingContext2D, im: CanvasImageSource, s: [Pt, Pt, Pt], d: [Pt, Pt, Pt]) {
  const [[sx0, sy0], [sx1, sy1], [sx2, sy2]] = s;
  const det = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (!det) return;
  const solve = (p0: number, p1: number, p2: number) => [
    (p0 * (sy1 - sy2) + p1 * (sy2 - sy0) + p2 * (sy0 - sy1)) / det,
    (p0 * (sx2 - sx1) + p1 * (sx0 - sx2) + p2 * (sx1 - sx0)) / det,
    (p0 * (sx1 * sy2 - sx2 * sy1) + p1 * (sx2 * sy0 - sx0 * sy2) + p2 * (sx0 * sy1 - sx1 * sy0)) / det,
  ];
  const [a, c, e] = solve(d[0][0], d[1][0], d[2][0]);
  const [b, dd, f] = solve(d[0][1], d[1][1], d[2][1]);
  // grow the clip triangle a little so neighbouring triangles overlap (no hairline seams)
  const cx = (d[0][0] + d[1][0] + d[2][0]) / 3;
  const cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
  const g = (p: Pt): Pt => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / l) * 0.6, p[1] + (dy / l) * 0.6];
  };
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(...g(d[0]));
  ctx.lineTo(...g(d[1]));
  ctx.lineTo(...g(d[2]));
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, dd, e, f);
  ctx.drawImage(im, 0, 0);
  ctx.restore();
}

/** Draw `src` (the flat print) warped onto the product in a view. */
function drawWarped(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, m: LoadedMockup, v: View) {
  const w = m.def.warp;
  const [nx, ny] = w.kind === 'rect' ? [1, 1] : w.kind === 'cylinder' ? [28, 2] : [14, 14];
  const sw = src.width;
  const sh = src.height;
  const f = (u: number, vv: number) => toStage(v, m.def.crop, warpPoint(w, v.mirror ? 1 - u : u, vv));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const u0 = i / nx, u1 = (i + 1) / nx, v0 = j / ny, v1 = (j + 1) / ny;
      const s00: Pt = [u0 * sw, v0 * sh], s10: Pt = [u1 * sw, v0 * sh], s01: Pt = [u0 * sw, v1 * sh], s11: Pt = [u1 * sw, v1 * sh];
      const d00 = f(u0, v0), d10 = f(u1, v0), d01 = f(u0, v1), d11 = f(u1, v1);
      tri(ctx, src, [s00, s10, s11], [d00, d10, d11]);
      tri(ctx, src, [s00, s11, s01], [d00, d11, d01]);
    }
  }
}

/** Draw a full-photo-sized image (photo, mask, shade) into a view, honouring crop + mirror. */
function drawInView(ctx: CanvasRenderingContext2D, im: CanvasImageSource, crop: PhotoMockupDef['crop'], v: View, s: number) {
  // `s` = image px per photo px (mask/shade may be stored at another size than the photo)
  ctx.save();
  if (v.mirror) {
    ctx.translate(v.x + v.w, v.y);
    ctx.scale(-1, 1);
    ctx.drawImage(im, crop.x * s, crop.y * s, crop.w * s, crop.h * s, 0, 0, v.w, v.h);
  } else ctx.drawImage(im, crop.x * s, crop.y * s, crop.w * s, crop.h * s, v.x, v.y, v.w, v.h);
  ctx.restore();
}

/** Fill the stage outside the views by stretching the photo's border pixels (seamless backdrop). */
function fillBackdrop(ctx: CanvasRenderingContext2D, m: LoadedMockup, views: View[], cw: number, ch: number) {
  const { crop } = m.def;
  const s = m.photo.naturalWidth / m.def.size;
  const e = 2; // source strip thickness, photo px
  const part = (v: View, nx: number, ny: number, nw: number, nh: number, dx: number, dy: number, dw: number, dh: number) => {
    if (dw <= 0 || dh <= 0) return;
    const sx = v.mirror ? crop.x + crop.w - (nx + nw) : crop.x + nx;
    ctx.save();
    if (v.mirror) {
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(m.photo, sx * s, (crop.y + ny) * s, nw * s, nh * s, 0, 0, dw, dh);
    } else ctx.drawImage(m.photo, sx * s, (crop.y + ny) * s, nw * s, nh * s, dx, dy, dw, dh);
    ctx.restore();
  };
  const first = views[0];
  const last = views[views.length - 1];
  const W = crop.w;
  const H = crop.h;
  for (const v of views) {
    part(v, 0, 0, W, e, v.x, 0, v.w, v.y + 1); // above
    part(v, 0, H - e, W, e, v.x, v.y + v.h - 1, v.w, ch - (v.y + v.h) + 1); // below
  }
  part(first, 0, 0, e, H, 0, first.y, first.x + 1, first.h); // left
  part(last, W - e, 0, e, H, last.x + last.w - 1, last.y, cw - (last.x + last.w) + 1, last.h); // right
  part(first, 0, 0, e, e, 0, 0, first.x + 1, first.y + 1); // corners
  part(first, 0, H - e, e, e, 0, first.y + first.h - 1, first.x + 1, ch - (first.y + first.h) + 1);
  part(last, W - e, 0, e, e, last.x + last.w - 1, 0, cw - (last.x + last.w) + 1, last.y + 1);
  part(last, W - e, H - e, e, e, last.x + last.w - 1, last.y + last.h - 1, cw - (last.x + last.w) + 1, ch - (last.y + last.h) + 1);
}

export class Compositor {
  readonly canvas = document.createElement('canvas');
  private tmp = document.createElement('canvas');
  private alpha = document.createElement('canvas');
  private maskAll = document.createElement('canvas');

  /**
   * Render the whole preview: backdrop, product photo(s), (recoloured product), warped + shaded print.
   * `prints[i]` is the flat print for `views[i]`.
   */
  render(m: LoadedMockup, views: View[], prints: HTMLCanvasElement[], cw: number, ch: number, dpr: number, color?: string) {
    const W = Math.round(cw * dpr);
    const H = Math.round(ch * dpr);
    for (const c of [this.canvas, this.tmp, this.alpha, this.maskAll]) {
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
    }
    const out = this.canvas.getContext('2d')!;
    const t = this.tmp.getContext('2d')!;
    const a = this.alpha.getContext('2d')!;
    const { crop } = m.def;
    const ps = m.photo.naturalWidth / m.def.size;
    const ms = m.mask.naturalWidth / m.def.size;
    out.setTransform(dpr, 0, 0, dpr, 0, 0);
    out.imageSmoothingQuality = 'high';
    fillBackdrop(out, m, views, cw, ch);
    views.forEach((v) => drawInView(out, m.photo, crop, v, ps));
    // Union of all views' product masks (applied once; per-view destination-in would erase the other views).
    const mk = this.maskAll.getContext('2d')!;
    mk.setTransform(1, 0, 0, 1, 0, 0);
    mk.clearRect(0, 0, W, H);
    mk.setTransform(dpr, 0, 0, dpr, 0, 0);
    views.forEach((v) => drawInView(mk, m.mask, crop, v, ms));

    const layer = (paint: (ctx: CanvasRenderingContext2D) => void, keepAlphaOfPaint: boolean) => {
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, W, H);
      t.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(t);
      if (keepAlphaOfPaint) {
        a.setTransform(1, 0, 0, 1, 0, 0);
        a.clearRect(0, 0, W, H);
        a.drawImage(this.tmp, 0, 0);
      }
      // × product shading (lighting, curvature, folds, fabric texture)
      t.globalCompositeOperation = 'multiply';
      views.forEach((v) => drawInView(t, m.shade, crop, v, 1));
      t.setTransform(1, 0, 0, 1, 0, 0);
      if (keepAlphaOfPaint) {
        t.globalCompositeOperation = 'destination-in';
        t.drawImage(this.alpha, 0, 0);
      }
      // only on the product itself
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(this.maskAll, 0, 0);
      out.setTransform(1, 0, 0, 1, 0, 0);
      out.drawImage(this.tmp, 0, 0);
      out.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    if (m.def.recolor && color) {
      layer((ctx) => {
        ctx.fillStyle = color;
        views.forEach((v) => ctx.fillRect(v.x, v.y, v.w, v.h));
      }, false);
    }
    layer((ctx) => views.forEach((v, i) => prints[i] && drawWarped(ctx, prints[i], m, v)), true);
    return this.canvas;
  }
}
