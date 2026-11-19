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

/** Santa hat. Anchor: centre of white band is at (0.5, 0.82) of the image. */
export const santaHat = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="400" viewBox="0 0 240 200">
<path d="M28 158 C40 92 92 30 170 26 C202 24 216 46 208 72 C196 60 178 60 168 72 C158 86 190 128 214 158 Z" fill="#df7f7c"/>
<path d="M120 158 C150 120 160 90 168 72 C158 86 190 128 214 158 Z" fill="#c86a68" opacity="0.45"/>
<circle cx="208" cy="74" r="21" fill="#fffaf3" stroke="#ebe1d4" stroke-width="2"/>
<rect x="12" y="140" width="216" height="46" rx="23" fill="#fffaf3" stroke="#ebe1d4" stroke-width="2"/>
<path d="M32 170 Q120 161 210 170" stroke="#f0e7da" stroke-width="5" fill="none" stroke-linecap="round"/>
</svg>`);

/** Striped scarf. Anchor: band centre at (0.5, 0.36). */
export const scarf = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 300 170">
<defs><pattern id="s" width="36" height="200" patternUnits="userSpaceOnUse"><rect width="36" height="200" fill="#e39f9c"/><rect x="18" width="9" height="200" fill="#9fc4a9"/><rect x="29" width="4" height="200" fill="#fff8ee"/></pattern></defs>
<path d="M190 70 L238 66 L250 152 L204 156 Z" fill="url(#s)" stroke="#c98886" stroke-width="1.5"/>
<path d="M206 156 l2 11 M214 156 l2 11 M222 155 l2 11 M230 154 l2 11 M238 154 l2 11 M246 153 l2 11" stroke="#e39f9c" stroke-width="4" stroke-linecap="round"/>
<path d="M8 32 Q150 96 292 32 L292 80 Q150 142 8 80 Z" fill="url(#s)" stroke="#c98886" stroke-width="1.5"/>
<path d="M8 80 Q150 142 292 80 L292 72 Q150 132 8 72 Z" fill="#000" opacity="0.07"/>
</svg>`);

/** String of Christmas lights. Anchor: wire mid-point at (0.5, 0.4). */
export const lights = (() => {
  const colors = ['#f2a3a3', '#f3d68c', '#a6d5bd', '#a9c4ea', '#e6b3d6'];
  const p = (t: number) => {
    const x = 2 * (1 - t) * t * 200 + t * t * 400;
    const y = (1 - t) * (1 - t) * 20 + 2 * (1 - t) * t * 110 + t * t * 20;
    return [x, y];
  };
  let bulbs = '';
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = 0.06 + (i / (n - 1)) * 0.88;
    const [x, y] = p(t);
    const c = colors[i % colors.length];
    const rot = (t - 0.5) * 40;
    bulbs += `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-5" y="0" width="10" height="7" rx="2" fill="#8d958f"/><ellipse cx="0" cy="18" rx="8" ry="13" fill="${c}"/><ellipse cx="-3" cy="13" rx="2.2" ry="4.5" fill="#fff" opacity="0.5"/></g>`;
  }
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="280" viewBox="0 0 400 140">
<path d="M0 20 Q200 110 400 20" stroke="#8aa592" stroke-width="3.5" fill="none"/>${bulbs}</svg>`);
})();

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
