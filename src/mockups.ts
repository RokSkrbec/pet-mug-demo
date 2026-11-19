// 2D product mockups (pillow, t-shirt) drawn with Konva shapes, no photo assets.
// Same pattern as mugMockup.ts: `back` is drawn under the print, `front` (shading) over it.
import Konva from 'konva';

type Ctx = { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; quadraticCurveTo(cx: number, cy: number, x: number, y: number): void; closePath(): void; beginPath?(): void };

// ---------------------------------------------------------------- pillow

/** Puffy square: every edge bows inwards by `bow` (corners stay pointy). Also used as the print clip. */
export function pillowPath(ctx: Ctx, x: number, y: number, size: number, bow: number) {
  ctx.beginPath?.();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + size / 2, y + bow * 2, x + size, y);
  ctx.quadraticCurveTo(x + size - bow * 2, y + size / 2, x + size, y + size);
  ctx.quadraticCurveTo(x + size / 2, y + size - bow * 2, x, y + size);
  ctx.quadraticCurveTo(x + bow * 2, y + size / 2, x, y);
  ctx.closePath();
}
export const PILLOW_BOW = 0.035;

export function drawPillow(back: Konva.Layer, front: Konva.Layer, g: { x0: number; y0: number; size: number }) {
  const { x0, y0, size } = g;
  const bow = size * PILLOW_BOW;
  const cx = x0 + size / 2;
  const cy = y0 + size / 2;

  back.add(new Konva.Ellipse({ x: cx + size * 0.03, y: y0 + size * 1.02, radiusX: size * 0.5, radiusY: size * 0.05, fill: 'rgba(120,96,70,0.13)' }));
  back.add(
    new Konva.Shape({
      sceneFunc(ctx, shape) {
        pillowPath(ctx, x0, y0, size, bow);
        ctx.fillShape(shape);
      },
      fill: '#f6f3ee',
    }),
  );

  // Soft cushion shading: light centre, darker towards the pinched edges; seam; corner creases.
  front.add(
    new Konva.Shape({
      sceneFunc(ctx, shape) {
        pillowPath(ctx, x0, y0, size, bow);
        ctx.fillShape(shape);
      },
      fillRadialGradientStartPoint: { x: cx - size * 0.08, y: cy - size * 0.1 },
      fillRadialGradientEndPoint: { x: cx, y: cy },
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndRadius: size * 0.78,
      fillRadialGradientColorStops: [0, 'rgba(255,255,255,0.10)', 0.55, 'rgba(110,92,74,0)', 0.85, 'rgba(110,92,74,0.14)', 1, 'rgba(110,92,74,0.30)'],
    }),
    new Konva.Shape({
      sceneFunc(ctx, shape) {
        pillowPath(ctx, x0, y0, size, bow);
        ctx.strokeShape(shape);
      },
      stroke: 'rgba(120,100,80,0.35)',
      strokeWidth: 1.5,
    }),
    new Konva.Shape({
      sceneFunc(ctx, shape) {
        const c = size * 0.09;
        ctx.beginPath();
        // a soft crease from each corner towards the middle
        for (const [sx, sy, dx, dy] of [[x0, y0, 1, 1], [x0 + size, y0, -1, 1], [x0 + size, y0 + size, -1, -1], [x0, y0 + size, 1, -1]]) {
          ctx.moveTo(sx + dx * size * 0.01, sy + dy * size * 0.01);
          ctx.quadraticCurveTo(sx + dx * c * 0.9, sy + dy * c * 0.4, sx + dx * c * 1.6, sy + dy * c * 1.3);
        }
        ctx.strokeShape(shape);
      },
      stroke: 'rgba(90,70,50,0.10)',
      strokeWidth: 2,
      lineCap: 'round',
    }),
  );
}

// ---------------------------------------------------------------- t-shirt

/** Tee outline in units of the shirt width (height ≈ 1.06). */
const TEE: [number, number][] = [
  [0.37, 0.03], [0.2, 0.075], [0.0, 0.27], [0.1, 0.37], [0.205, 0.31], [0.205, 1.06], [0.795, 1.06], [0.795, 0.31], [0.9, 0.37], [1.0, 0.27], [0.8, 0.075], [0.63, 0.03],
];
export const TEE_HEIGHT = 1.08;
/** Chest print area in shirt-width units (12" × 16" = 3:4). */
export const TEE_PRINT = { x: 0.28, y: 0.19, w: 0.44, h: 0.44 * (4 / 3) };

function teePath(ctx: Ctx, x0: number, y0: number, w: number) {
  ctx.beginPath?.();
  const p = (i: number) => [x0 + TEE[i][0] * w, y0 + TEE[i][1] * w] as const;
  ctx.moveTo(...p(0));
  for (let i = 1; i < TEE.length; i++) {
    if (i === 6) ctx.quadraticCurveTo(x0 + 0.5 * w, y0 + 1.075 * w, ...p(6)); // slightly curved hem
    else ctx.lineTo(...p(i));
  }
  ctx.quadraticCurveTo(x0 + 0.5 * w, y0 + 0.15 * w, ...p(0)); // front neckline
  ctx.closePath();
}

/** Darken (amt < 0) or lighten (amt > 0) a hex colour. */
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function drawTshirt(back: Konva.Layer, front: Konva.Layer, g: { x0: number; y0: number; w: number; color: string }) {
  const { x0, y0, w, color } = g;
  back.add(new Konva.Ellipse({ x: x0 + w * 0.52, y: y0 + w * 1.075, radiusX: w * 0.36, radiusY: w * 0.03, fill: 'rgba(120,96,70,0.12)' }));
  // inside of the back neck, visible above the front neckline
  back.add(
    new Konva.Shape({
      sceneFunc(ctx, shape) {
        ctx.beginPath();
        ctx.moveTo(x0 + 0.37 * w, y0 + 0.03 * w);
        ctx.quadraticCurveTo(x0 + 0.5 * w, y0 + 0.0 * w, x0 + 0.63 * w, y0 + 0.03 * w);
        ctx.quadraticCurveTo(x0 + 0.5 * w, y0 + 0.15 * w, x0 + 0.37 * w, y0 + 0.03 * w);
        ctx.closePath();
        ctx.fillShape(shape);
      },
      fill: shade(color, -0.22),
    }),
    new Konva.Shape({
      sceneFunc(ctx, shape) {
        teePath(ctx, x0, y0, w);
        ctx.fillStrokeShape(shape);
      },
      fill: color,
      stroke: shade(color, -0.12),
      strokeWidth: 1,
      lineJoin: 'round',
    }),
  );

  front.add(
    // fabric shading: darker towards the sides of the body
    new Konva.Shape({
      sceneFunc(ctx, shape) {
        teePath(ctx, x0, y0, w);
        ctx.fillShape(shape);
      },
      fillLinearGradientStartPoint: { x: x0, y: 0 },
      fillLinearGradientEndPoint: { x: x0 + w, y: 0 },
      fillLinearGradientColorStops: [0, 'rgba(60,45,30,0.10)', 0.22, 'rgba(60,45,30,0.10)', 0.32, 'rgba(60,45,30,0)', 0.68, 'rgba(60,45,30,0)', 0.78, 'rgba(60,45,30,0.12)', 1, 'rgba(60,45,30,0.12)'],
    }),
    // collar rib, sleeve seams, a couple of soft folds
    new Konva.Shape({
      sceneFunc(ctx, shape) {
        ctx.beginPath();
        ctx.moveTo(x0 + 0.37 * w, y0 + 0.03 * w);
        ctx.quadraticCurveTo(x0 + 0.5 * w, y0 + 0.15 * w, x0 + 0.63 * w, y0 + 0.03 * w);
        ctx.strokeShape(shape);
      },
      stroke: shade(color, -0.18),
      strokeWidth: w * 0.016,
      lineCap: 'round',
    }),
    new Konva.Shape({
      sceneFunc(ctx, shape) {
        ctx.beginPath();
        ctx.moveTo(x0 + 0.2 * w, y0 + 0.075 * w);
        ctx.quadraticCurveTo(x0 + 0.225 * w, y0 + 0.2 * w, x0 + 0.205 * w, y0 + 0.31 * w);
        ctx.moveTo(x0 + 0.8 * w, y0 + 0.075 * w);
        ctx.quadraticCurveTo(x0 + 0.775 * w, y0 + 0.2 * w, x0 + 0.795 * w, y0 + 0.31 * w);
        ctx.moveTo(x0 + 0.27 * w, y0 + 0.98 * w);
        ctx.quadraticCurveTo(x0 + 0.3 * w, y0 + 0.86 * w, x0 + 0.26 * w, y0 + 0.74 * w);
        ctx.moveTo(x0 + 0.74 * w, y0 + 1.0 * w);
        ctx.quadraticCurveTo(x0 + 0.71 * w, y0 + 0.9 * w, x0 + 0.745 * w, y0 + 0.8 * w);
        ctx.strokeShape(shape);
      },
      stroke: 'rgba(40,30,20,0.10)',
      strokeWidth: 1.5,
      lineCap: 'round',
    }),
  );
}
