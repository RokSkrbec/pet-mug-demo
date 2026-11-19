// Procedurally generated SVG artwork so the demo has zero external assets.
// In production these would be designer-made PNG/SVG files referenced by URL in the template JSON.
// Style: soft pastel, sparse patterns, no glossy effects.

const svgUrl = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function star(x: number, y: number, s: number, color: string, rot: number) {
  // 6-point star made of 3 thin rhombi (like printed festive confetti)
  let out = '';
  for (let a = 0; a < 3; a++) {
    out += `<path transform="rotate(${rot + a * 60} ${x} ${y})" d="M${x} ${y - s} L${x + s * 0.28} ${y} L${x} ${y + s} L${x - s * 0.28} ${y} Z" fill="${color}"/>`;
  }
  return out;
}

function crystal(x: number, y: number, s: number, color: string) {
  let arms = '';
  for (let a = 0; a < 6; a++) {
    arms += `<g transform="rotate(${a * 60})"><line x1="0" y1="0" x2="0" y2="${-s}"/><line x1="0" y1="${-s * 0.6}" x2="${s * 0.25}" y2="${-s * 0.85}"/><line x1="0" y1="${-s * 0.6}" x2="${-s * 0.25}" y2="${-s * 0.85}"/></g>`;
  }
  return `<g transform="translate(${x} ${y})" stroke="${color}" stroke-width="${s * 0.1}" stroke-linecap="round" fill="none">${arms}</g>`;
}

function dots(w: number, h: number, n: number, colors: string[], seed: number, maxR = 5) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(2 + r() * maxR).toFixed(1)}" fill="${colors[i % colors.length]}" opacity="${(0.5 + r() * 0.4).toFixed(2)}"/>`;
  }
  return out;
}

function tree(x: number, y: number, h: number, color: string) {
  const w = h * 0.6;
  return `<polygon points="${x},${y - h} ${x - w / 2},${y} ${x + w / 2},${y}" fill="${color}"/><rect x="${x - h * 0.05}" y="${y}" width="${h * 0.1}" height="${h * 0.15}" fill="#c9ad94"/>`;
}

/** Scatter n items over the canvas, avoiding a too-regular look via jittered grid. */
function scatter(w: number, h: number, cols: number, rows: number, seed: number, draw: (x: number, y: number, i: number, r: () => number) => string) {
  const r = rng(seed);
  let out = '';
  let i = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = ((cx + 0.15 + r() * 0.7) / cols) * w;
      const y = ((cy + 0.15 + r() * 0.7) / rows) * h;
      out += draw(x, y, i++, r);
    }
  }
  return out;
}

export function backgroundStars(w: number, h: number) {
  const colors = ['#d99a9a', '#9dbfa6', '#dcc38a', '#a9bfd6'];
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#fcfaf6"/>
${dots(w, h, 120, ['#c9c2b8', '#e2b4b4', '#b8cfbe'], 4, 3)}
${scatter(w, h, 12, 5, 9, (x, y, i, r) => star(x, y, 14 + r() * 12, colors[i % colors.length], r() * 60))}
</svg>`);
}

export function backgroundSnow(w: number, h: number) {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#f1f6f9"/>
${dots(w, h, 140, ['#ffffff', '#d6e4ee'], 12, 5)}
${scatter(w, h, 10, 4, 21, (x, y, _i, r) => crystal(x, y, 16 + r() * 16, '#b7cfe0'))}
</svg>`);
}

export function backgroundBlush(w: number, h: number) {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#faefec"/>
${dots(w, h, 110, ['#ffffff', '#efd3cd'], 33, 4)}
${scatter(w, h, 9, 3, 41, (x, y, i, r) => (i % 3 === 0 ? tree(x, y, 40 + r() * 20, '#a9c4ae') : star(x, y, 12 + r() * 8, '#e0b98a', r() * 60)))}
</svg>`);
}

export function backgroundPlain(w: number, h: number) {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#ffffff"/></svg>`);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
