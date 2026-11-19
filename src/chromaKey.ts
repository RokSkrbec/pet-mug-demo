// Green-screen background removal for the AI illustration.
//
// The worker asks Nano Banana to paint the pet on a flat chroma-key green background, so we don't need an ML
// model to cut it out: we measure how "green-screen-like" every pixel is, turn that into transparency, and
// subtract the green from semi-transparent edge pixels (soft watercolour edges, whiskers) so no green halo stays.
// Pure function on RGBA pixels: no DOM, runs in a browser, a worker or Node.

export interface KeyResult {
  /** Fraction of the image that became (mostly) transparent. */
  removed: number;
  /** The background colour that was keyed out. */
  key: [number, number, number];
}

/** "Green excess": how much greener than red/blue a pixel is. */
const excess = (r: number, g: number, b: number) => g - Math.max(r, b);

/**
 * Key out the background in place. Returns null (pixels untouched) when the image has no flat background
 * at all, so the caller can fall back to using it as-is.
 *
 * Normal case: the green screen the worker asks for. If the model ignored that and painted another flat colour
 * (usually white), we key that colour instead: still fine on most pets, but it can eat into fur of the same colour.
 */
export function chromaKey(data: Uint8ClampedArray, w: number, h: number): KeyResult | null {
  // 1) Find the real key colour from the image border (the model doesn't always paint exactly #00FF00).
  const border: number[] = [];
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.004));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y < ring || y >= h - ring || x < ring || x >= w - ring) border.push((y * w + x) * 4);
    }
  }
  const median = (px: number[], c: number) => {
    const v = px.map((i) => data[i + c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const medianColor = (px: number[]): [number, number, number] => [median(px, 0), median(px, 1), median(px, 2)];
  const green = border.filter((i) => excess(data[i], data[i + 1], data[i + 2]) > 50);
  const isGreen = green.length >= border.length * 0.4;
  const key = medianColor(isGreen ? green : border);
  const dist = (i: number) => Math.hypot(data[i] - key[0], data[i + 1] - key[1], data[i + 2] - key[2]);
  if (!isGreen && border.filter((i) => dist(i) < 30).length < border.length * 0.6) return null; // no flat background

  // 2) e = 1 on the background, ~0 on the pet; an edge pixel that is a% pet has e ≈ 1 − a.
  const n = w * h;
  const e = new Float32Array(n);
  const keyExcess = excess(...key);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    e[p] = isGreen ? excess(data[i], data[i + 1], data[i + 2]) / keyExcess : 1 - Math.min(1, dist(i) / 100);
  }

  // 3) Background region: flood-fill from the border and from any clearly-green pixel (also catches closed gaps,
  //    e.g. between tail and body), spreading only through pixels with some green in them. Green details inside
  //    the pet (eyes, a sage scarf) are surrounded by fur, so they are never reached.
  const SOLID = 0.15; // e below this = fully pet
  const SEED = 0.7; // e above this = background even if not connected to the border
  const bg = new Uint8Array(n);
  const stack: number[] = [];
  const seed = (p: number) => {
    if (!bg[p] && e[p] > SOLID) {
      bg[p] = 1;
      stack.push(p);
    }
  };
  for (const i of border) seed(i / 4);
  if (isGreen) for (let p = 0; p < n; p++) if (e[p] > SEED) seed(p); // never for white: white fur would match
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }

  // 4) Alpha + un-mix the key colour from edge pixels: pixel = a·pet + (1 − a)·key  →  pet = (pixel − (1 − a)·key) / a
  const CLEAR = 0.85; // e above this = fully transparent
  let removed = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (!bg[p]) continue;
    const a = Math.min(1, Math.max(0, (CLEAR - e[p]) / (CLEAR - SOLID)));
    if (a < 0.04) {
      data[i + 3] = 0;
      removed++;
      continue;
    }
    for (let c = 0; c < 3; c++) data[i + c] = (data[i + c] - (1 - a) * key[c]) / a;
    // Un-mixing can overshoot into pink when alpha is slightly underestimated: keep green between red and blue.
    if (isGreen) data[i + 1] = Math.max(Math.min(data[i], data[i + 2]), data[i + 1]);
    data[i + 3] = Math.round(a * 255);
    if (a < 0.5) removed++;
  }

  // 5) Spill: the model sometimes outlines the pet with a thin dark-green line (too dark to key out). In a 3 px band
  //    around the background, cap green at the brighter of red/blue (dark green → neutral dark outline).
  if (!isGreen) return { removed: removed / n, key };
  const near = new Uint8Array(bg);
  for (let pass = 0; pass < 3; pass++) {
    const prev = near.slice();
    for (let p = 0; p < n; p++) {
      if (prev[p]) continue;
      const x = p % w;
      if ((x > 0 && prev[p - 1]) || (x < w - 1 && prev[p + 1]) || (p >= w && prev[p - w]) || (p < n - w && prev[p + w])) near[p] = 1;
    }
  }
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (near[p] && data[i + 3]) data[i + 1] = Math.min(data[i + 1], Math.max(data[i], data[i + 2]));
  }
  return { removed: removed / n, key };
}
