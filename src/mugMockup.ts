// 2D ceramic mug mockup drawn with Konva shapes (no photo assets needed).
// The printed face is drawn by the caller between `back` (body) and `front` (shading) layers.
import Konva from 'konva';

export interface MugGeometry {
  /** left edge of the body */
  x0: number;
  /** body width */
  bw: number;
  /** y of the rim ellipse centre */
  top: number;
  /** y of the bottom ellipse centre */
  bottom: number;
  /** vertical radius of rim/bottom ellipses (perspective) */
  ry: number;
  handleLeft: boolean;
}

function bodyPath(ctx: Konva.Context, g: MugGeometry) {
  const cx = g.x0 + g.bw / 2;
  ctx.beginPath();
  ctx.moveTo(g.x0, g.top);
  ctx.lineTo(g.x0, g.bottom);
  ctx.ellipse(cx, g.bottom, g.bw / 2, g.ry, 0, Math.PI, 0, true);
  ctx.lineTo(g.x0 + g.bw, g.top);
  ctx.ellipse(cx, g.top, g.bw / 2, g.ry, 0, 0, Math.PI, false);
  ctx.closePath();
}

const horizontal = (g: MugGeometry) => ({
  fillLinearGradientStartPoint: { x: g.x0, y: 0 },
  fillLinearGradientEndPoint: { x: g.x0 + g.bw, y: 0 },
});

export function drawMug(back: Konva.Layer, front: Konva.Layer, g: MugGeometry) {
  const cx = g.x0 + g.bw / 2;

  // soft floor shadow
  back.add(new Konva.Ellipse({ x: cx + (g.handleLeft ? -1 : 1) * g.bw * 0.06, y: g.bottom + g.ry * 0.35, radiusX: g.bw * 0.62, radiusY: g.ry * 1.1, fill: 'rgba(120,96,70,0.10)' }));

  // handle: two strokes of a half-ellipse for a little depth
  const hx = g.handleLeft ? g.x0 + g.bw * 0.02 : g.x0 + g.bw * 0.98;
  const hy = (g.top + g.bottom) / 2 - g.bw * 0.04;
  const [a0, a1] = g.handleLeft ? [Math.PI / 2, (Math.PI * 3) / 2] : [-Math.PI / 2, Math.PI / 2];
  const handle = (w: number, color: string, shrink: number) =>
    new Konva.Shape({
      stroke: color,
      strokeWidth: w,
      lineCap: 'round',
      sceneFunc(ctx, shape) {
        ctx.beginPath();
        ctx.ellipse(hx, hy, g.bw * 0.2 - shrink, g.bw * 0.28 - shrink, 0, a0, a1, false);
        ctx.strokeShape(shape);
      },
    });
  back.add(handle(g.bw * 0.085, '#e4dfd7', 0), handle(g.bw * 0.045, '#f6f4f0', g.bw * 0.008));

  // body with cylindrical shading
  back.add(
    new Konva.Shape({
      sceneFunc(ctx, shape) {
        bodyPath(ctx, g);
        ctx.fillStrokeShape(shape);
      },
      ...horizontal(g),
      fillLinearGradientColorStops: [0, '#ddd8d0', 0.16, '#efece7', 0.42, '#fbfaf8', 0.7, '#f4f2ee', 1, '#d9d4cc'],
    }),
  );

  // rim + opening
  back.add(
    new Konva.Ellipse({ x: cx, y: g.top, radiusX: g.bw / 2, radiusY: g.ry, fill: '#f3f0eb', stroke: '#e3ded6', strokeWidth: 1 }),
    new Konva.Ellipse({
      x: cx,
      y: g.top + g.ry * 0.05,
      radiusX: g.bw / 2 - g.bw * 0.035,
      radiusY: g.ry * 0.8,
      fillLinearGradientStartPoint: { x: 0, y: -g.ry },
      fillLinearGradientEndPoint: { x: 0, y: g.ry },
      fillLinearGradientColorStops: [0, '#d8d2c9', 1, '#efebe5'],
    }),
  );

  // shading over the print so it reads as wrapped around a cylinder (matte, no gloss)
  front.add(
    new Konva.Shape({
      sceneFunc(ctx, shape) {
        bodyPath(ctx, g);
        ctx.fillShape(shape);
      },
      ...horizontal(g),
      fillLinearGradientColorStops: [
        0, 'rgba(110,92,74,0.28)',
        0.2, 'rgba(110,92,74,0.04)',
        0.34, 'rgba(255,255,255,0.10)',
        0.5, 'rgba(255,255,255,0)',
        0.78, 'rgba(110,92,74,0.04)',
        1, 'rgba(110,92,74,0.30)',
      ],
    }),
  );
}
