// Embeddable customizer widget. Same bundle is used by the standalone demo
// and (later) by the Shopify theme app extension.
//
// Flow: before upload the mug shows an example illustration for the selected style. When the customer
// uploads a photo, the AI illustration for the selected style is generated automatically and used on the
// mug (the raw photo is never placed on the mug). Switching style generates that style once and caches it.
//
// Model: the print is split into `tpl.sides` faces (2 for a mug: one per side) and the SAME design is
// printed on every face. The design (pet + name) is one unit dragged/scaled/rotated directly on the mug.
import Konva from 'konva';
import type { Template } from './template';
import { loadImage } from './assets';
import { cutout, preloadBackgroundRemoval } from './petPhoto';
import { createMugPreview } from './mug3d';
import { drawMug } from './mugMockup';
import { aiEnabled, aiErrorMessage, illustrate, AiError } from './ai';

export interface Personalization {
  templateId: string;
  options: Record<string, string>;
  /** Small JPEG for the cart/order preview. */
  previewDataUrl: string;
  /** Full-resolution 300 DPI print file (PNG). */
  printBlob: Blob;
}

export interface CustomizerOptions {
  onAddToCart?: (p: Personalization) => void | Promise<void>;
}

const ICONS: Record<string, string> = {
  zoomIn: '<circle cx="10" cy="10" r="6.5"/><path d="M15 15l5 5M10 7v6M7 10h6"/>',
  zoomOut: '<circle cx="10" cy="10" r="6.5"/><path d="M15 15l5 5M7 10h6"/>',
  rotL: '<path d="M4.5 13a7.5 7.5 0 1 0 2.2-6.3"/><path d="M5 3.5V8h4.5"/>',
  rotR: '<path d="M19.5 13a7.5 7.5 0 1 1-2.2-6.3"/><path d="M19 3.5V8h-4.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M9 7L3.5 17H9zM15 7l5.5 10H15z"/>',
};
const icon = (k: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function mountCustomizer(root: HTMLElement, tpl: Template, opts: CustomizerOptions = {}) {
  const FW = tpl.print.width / tpl.sides;
  const FH = tpl.print.height;

  const state = {
    background: tpl.backgrounds[0].id,
    greeting: tpl.greeting.default,
    font: tpl.fonts[0],
    textColor: tpl.backgrounds[0].textColor,
    mirror: false,
    name: tpl.petName.default,
    style: tpl.defaultStyle,
    photo: undefined as File | undefined,
    photoThumb: '',
    /** Finished illustrations (background removed) per style id, for the current photo. */
    illustrations: {} as Record<string, HTMLCanvasElement>,
    /** Last illustration shown, kept on screen while another style is being painted. */
    lastShown: undefined as HTMLCanvasElement | undefined,
    busy: false,
    busyMsg: '',
    error: '',
    triesLeft: tpl.ai.triesPerPhoto,
  };
  const own = () => state.illustrations[state.style];

  root.classList.add('pc');
  root.innerHTML = `
    <div class="pc-preview">
      <div class="pc-tabs" role="tablist">
        <button type="button" class="pc-tab is-active" data-view="edit" role="tab">Edit on mug</button>
        <button type="button" class="pc-tab" data-view="3d" role="tab">3D view</button>
      </div>
      <div data-panel="edit">
        <div class="pc-stage" tabindex="0" aria-label="Mug preview. Drag the design. Arrow keys move it, plus and minus zoom."></div>
        <p class="pc-hint"><span class="pc-hint-mouse">Drag the design on the mug. Zoom with the mouse wheel, or use the buttons below and the arrow keys.</span><span class="pc-hint-touch">Drag the design with your finger. Pinch with two fingers to zoom, or use the buttons below.</span></p>
        <div class="pc-tools">
          <button type="button" data-tool="zoomIn" aria-label="Zoom in" title="Zoom in">${icon('zoomIn')}</button>
          <button type="button" data-tool="zoomOut" aria-label="Zoom out" title="Zoom out">${icon('zoomOut')}</button>
          <button type="button" data-tool="rotL" aria-label="Rotate left" title="Rotate left">${icon('rotL')}</button>
          <button type="button" data-tool="rotR" aria-label="Rotate right" title="Rotate right">${icon('rotR')}</button>
          <button type="button" data-tool="up" aria-label="Move up" title="Move up">${icon('up')}</button>
          <button type="button" data-tool="down" aria-label="Move down" title="Move down">${icon('down')}</button>
          <button type="button" data-tool="left" aria-label="Move left" title="Move left">${icon('left')}</button>
          <button type="button" data-tool="right" aria-label="Move right" title="Move right">${icon('right')}</button>
        </div>
        <div class="pc-tools pc-tools-wide">
          <button type="button" data-tool="mirror">${icon('mirror')}<span>Mirror pet</span></button>
          <button type="button" data-tool="reset"><span>Start over</span></button>
        </div>
      </div>
      <div class="pc-mug3d" data-panel="3d" hidden></div>
    </div>
    <form class="pc-panel" autocomplete="off">
      <fieldset><legend>Your pet</legend><div class="pc-pet"></div></fieldset>
      <fieldset><legend>Style</legend><div class="pc-styles"></div><div class="pc-ai"></div></fieldset>
      <fieldset><legend>Background</legend><div class="pc-swatches" data-field="background"></div></fieldset>
      <fieldset><legend>Text</legend>
        <input type="text" class="pc-input" data-field="greeting" maxlength="28" placeholder="Greeting (optional)">
        <select class="pc-input" data-field="font"></select>
        <div class="pc-colors" data-field="textColor"></div>
      </fieldset>
      <div class="pc-actions">
        <button type="button" class="pc-btn pc-btn-ghost" data-action="download">Download print file</button>
        <button type="button" class="pc-btn" data-action="cart">Add to cart</button>
      </div>
      <p class="pc-actions-msg" role="status"></p>
    </form>`;

  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;

  // ---------- assets ----------
  const bgImgs = Object.fromEntries(
    await Promise.all(tpl.backgrounds.map(async (b) => [b.id, await loadImage(b.src)])),
  ) as Record<string, HTMLImageElement>;
  const exampleImgs = Object.fromEntries(
    await Promise.all(tpl.styles.map(async (s) => [s.id, await loadImage(s.example)])),
  ) as Record<string, HTMLImageElement>;

  // ---------- Konva stage ----------
  const stageEl = $('.pc-stage');
  const stage = new Konva.Stage({ container: stageEl as HTMLDivElement, width: 10, height: 10 });
  const mugLayer = new Konva.Layer({ listening: false });
  const faceLayer = new Konva.Layer();
  const shadeLayer = new Konva.Layer({ listening: false });
  const uiLayer = new Konva.Layer();
  stage.add(mugLayer, faceLayer, shadeLayer, uiLayer);

  let exporting = false; // print export uses a plain rectangle instead of the curved mockup clip
  let sag = 0; // curvature of the print's top/bottom edge on the mockup, in face px

  const faces = Array.from({ length: tpl.sides }, (_, i) => {
    const face = new Konva.Group({
      clipFunc: (ctx) => {
        if (exporting || !sag) {
          ctx.rect(0, 0, FW, FH);
          return;
        }
        // Quadratic curves through (FW/2, sag): the print follows the cylinder's perspective.
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(FW / 2, 2 * sag, FW, 0);
        ctx.lineTo(FW, FH);
        ctx.quadraticCurveTo(FW / 2, FH + 2 * sag, 0, FH);
        ctx.closePath();
      },
    });
    const bg = new Konva.Image({ image: undefined, width: FW, height: FH, crop: { x: i * FW, y: 0, width: FW, height: FH }, listening: false });
    const greeting = new Konva.Text({ x: 0, y: tpl.greeting.y, width: FW, align: 'center', wrap: 'none', listening: false });
    const design = new Konva.Group({ name: 'design', draggable: true });
    face.add(bg, greeting, design);
    faceLayer.add(face);
    return { face, bg, greeting, design };
  });
  const designs = faces.map((f) => f.design);

  const tr = new Konva.Transformer({
    rotateEnabled: true,
    keepRatio: true,
    flipEnabled: false,
    enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    anchorSize: 14,
    anchorCornerRadius: 7,
    anchorFill: '#ffffff',
    anchorStroke: '#1d1d1f',
    anchorStrokeWidth: 2,
    borderStroke: '#1d1d1f',
    borderStrokeWidth: 1.5,
    rotateAnchorOffset: 26,
    ignoreStroke: true,
  });
  uiLayer.add(tr);

  // ---------- design content (identical on every face) ----------
  function buildDesign(g: Konva.Group) {
    g.destroyChildren();
    const slot = tpl.pet;
    const mine = own();
    // What to show: own illustration > previous illustration (while painting another style) > example.
    const img: CanvasImageSource = mine ?? (state.photo && state.lastShown ? state.lastShown : exampleImgs[state.style]);
    const iw = (img as HTMLCanvasElement).width;
    const ih = (img as HTMLCanvasElement).height;
    const pending = !!state.photo && !mine; // photo uploaded but this style isn't painted (yet)
    const scale = Math.min(slot.h / ih, (slot.h * 1.1) / iw);

    // Mirror flips the pet around its own centre; text is never mirrored.
    const flip = new Konva.Group({ x: slot.x, y: slot.y, scaleX: state.mirror ? -1 : 1 });
    flip.add(new Konva.Image({ image: img, width: iw * scale, height: ih * scale, offsetX: (iw * scale) / 2, offsetY: ih * scale, opacity: pending ? 0.3 : 1 }));
    g.add(flip);

    if (pending) {
      const msg = state.busy ? 'Painting your pet…' : state.error ? 'Not painted yet' : '';
      if (msg) {
        const t = new Konva.Text({ name: 'placeholder', text: msg, y: slot.y - slot.h / 2 - 40, fontSize: 70, fontFamily: 'Fredoka', fill: '#7d7067', align: 'center' });
        t.offsetX(t.width() / 2);
        t.x(slot.x);
        g.add(t);
      }
    }

    if (state.name.trim()) {
      const name = new Konva.Text({ text: state.name, y: slot.y + tpl.petName.gap, wrap: 'none', fontSize: tpl.petName.fontSize, fontFamily: state.font, fill: state.textColor });
      name.offsetX(name.width() / 2);
      name.x(slot.x);
      g.add(name);
    }

    // Invisible hit area so the whole design (incl. gaps) is draggable.
    const box = g.getClientRect({ relativeTo: g, skipShadow: true, skipStroke: true });
    const pad = 20;
    const hit = new Konva.Rect({ x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2, fill: 'rgba(0,0,0,0)' });
    g.add(hit);
    hit.moveToBottom();
  }

  function rebuildDesigns() {
    designs.forEach(buildDesign);
    tr.forceUpdate();
    changed();
  }

  function applyText() {
    faces.forEach(({ greeting }) => {
      greeting.text(state.greeting);
      greeting.fontFamily(state.font);
      greeting.fill(state.textColor);
      greeting.fontSize(tpl.greeting.fontSize);
      const w = greeting.measureSize(state.greeting).width;
      if (w > FW * 0.86) greeting.fontSize((tpl.greeting.fontSize * FW * 0.86) / w);
    });
  }

  function applyBackground() {
    faces.forEach(({ bg }) => bg.image(bgImgs[state.background]));
  }

  // ---------- transforms (always applied to every face) ----------
  const designDefaults = () => ({ x: tpl.design.x, y: tpl.design.y, scaleX: tpl.design.scale, scaleY: tpl.design.scale, rotation: 0 });
  designs.forEach((d) => d.setAttrs(designDefaults()));

  function applyAll(a: Partial<Konva.NodeConfig>) {
    designs.forEach((d) => d.setAttrs(a));
    tr.forceUpdate();
    changed();
  }
  const cur = () => designs[0];
  const zoomBy = (f: number) => {
    const s = clamp(cur().scaleX() * f, tpl.design.minScale, tpl.design.maxScale);
    applyAll({ scaleX: s, scaleY: s });
  };
  const rotateBy = (deg: number) => applyAll({ rotation: cur().rotation() + deg });
  const moveBy = (dx: number, dy: number) => applyAll({ x: cur().x() + dx, y: cur().y() + dy });

  designs.forEach((d) => {
    const sync = () => designs.forEach((o) => o !== d && o.setAttrs({ x: d.x(), y: d.y(), scaleX: d.scaleX(), scaleY: d.scaleY(), rotation: d.rotation() }));
    d.on('dragmove', sync);
    d.on('transform', () => {
      const s = clamp(d.scaleX(), tpl.design.minScale, tpl.design.maxScale);
      d.scale({ x: s, y: s });
      sync();
    });
    d.on('dragend transformend', () => changed());
  });

  function selectedFaceIndex() {
    const n = tr.nodes()[0];
    return n ? designs.indexOf(n as Konva.Group) : -1;
  }
  function select(i: number) {
    tr.nodes(i >= 0 && faces[i].face.visible() ? [designs[i]] : []);
  }
  const lastVisible = () => faces.map((f) => f.face.visible()).lastIndexOf(true);
  const openUpload = () => root.querySelector<HTMLInputElement>('input[type=file][data-photo]')?.click();

  stage.on('click tap', (e) => {
    const design = e.target.findAncestor('.design', true) as Konva.Group | undefined;
    if (!design) {
      tr.nodes([]);
      return;
    }
    select(designs.indexOf(design));
    if (!state.photo) openUpload(); // tapping the example invites the upload
  });
  // Pressing on a design selects it immediately (so you see handles while dragging).
  stage.on('mousedown touchstart', (e) => {
    const design = e.target.findAncestor('.design', true) as Konva.Group | undefined;
    if (design) select(designs.indexOf(design));
  });

  // Mouse wheel zoom (only while the design is selected, so the page still scrolls otherwise)
  stageEl.addEventListener(
    'wheel',
    (e) => {
      if (selectedFaceIndex() < 0) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.05 : 1 / 1.05);
    },
    { passive: false },
  );

  // Two-finger pinch zoom
  let lastDist = 0;
  stage.on('touchmove', (e) => {
    const t = e.evt.touches;
    if (t.length !== 2) return;
    e.evt.preventDefault();
    designs.forEach((d) => d.isDragging() && d.stopDrag());
    const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    if (lastDist) zoomBy(dist / lastDist);
    lastDist = dist;
  });
  stage.on('touchend', () => (lastDist = 0));

  // Keyboard
  stageEl.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 60 : 15;
    const actions: Record<string, () => void> = {
      ArrowUp: () => moveBy(0, -step),
      ArrowDown: () => moveBy(0, step),
      ArrowLeft: () => moveBy(-step, 0),
      ArrowRight: () => moveBy(step, 0),
      '+': () => zoomBy(1.1),
      '=': () => zoomBy(1.1),
      '-': () => zoomBy(1 / 1.1),
    };
    const fn = actions[e.key];
    if (!fn) return;
    e.preventDefault();
    if (selectedFaceIndex() < 0) select(lastVisible());
    fn();
  });

  // Toolbar
  const mirrorBtn = $('[data-tool=mirror]');
  root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      if (selectedFaceIndex() < 0) select(lastVisible());
      const step = 40;
      switch (b.dataset.tool) {
        case 'zoomIn': return zoomBy(1.1);
        case 'zoomOut': return zoomBy(1 / 1.1);
        case 'rotL': return rotateBy(-5);
        case 'rotR': return rotateBy(5);
        case 'up': return moveBy(0, -step);
        case 'down': return moveBy(0, step);
        case 'left': return moveBy(-step, 0);
        case 'right': return moveBy(step, 0);
        case 'mirror':
          state.mirror = !state.mirror;
          mirrorBtn.classList.toggle('is-active', state.mirror);
          return rebuildDesigns();
        case 'reset':
          state.mirror = false;
          mirrorBtn.classList.remove('is-active');
          designs.forEach(buildDesign);
          return applyAll(designDefaults());
      }
    }),
  );

  // ---------- mockup layout ----------
  function layout() {
    const cw = stageEl.clientWidth;
    if (!cw) return; // hidden (3D tab active)
    const single = cw < 520 || tpl.sides === 1;
    const n = single ? 1 : tpl.sides;
    const ch = Math.round(cw * (single ? 0.95 : 0.5));
    stage.size({ width: cw, height: ch });
    mugLayer.destroyChildren();
    shadeLayer.destroyChildren();

    const slotW = cw / n;
    // 0.76 of the slot is the most that fits incl. the handle; height-limited on very wide stages.
    const bw = Math.min(slotW * 0.76, ch * 0.82);
    const s = bw / FW;
    const ry = bw * 0.07; // perspective: how much of the rim ellipse we see
    sag = ry / s;
    const faceH = FH * s;
    const gapTop = bw * 0.03;
    const gapBottom = bw * 0.09;
    const mugH = 2 * ry + gapTop + faceH + gapBottom;
    const top = (ch - mugH) / 2 + ry;

    faces.forEach((f, i) => {
      const slot = single ? (i === faces.length - 1 ? 0 : -1) : i;
      f.face.scale({ x: s, y: s });
      if (slot < 0) {
        f.face.visible(false);
        return;
      }
      f.face.visible(true);
      const handleLeft = !single && i === 0;
      const cx = slotW * (slot + 0.5) + (handleLeft ? 1 : -1) * bw * 0.07;
      const x0 = cx - bw / 2;
      const faceY = top + gapTop; // print edges sit just under the rim; the centre sags with the rim
      drawMug(mugLayer, shadeLayer, { x0, bw, top, bottom: faceY + faceH + gapBottom, ry, handleLeft });
      f.face.position({ x: x0, y: faceY });
    });
    if (selectedFaceIndex() >= 0 && !faces[selectedFaceIndex()].face.visible()) select(lastVisible());
    tr.forceUpdate();
    stage.batchDraw();
  }
  new ResizeObserver(layout).observe(stageEl);

  // ---------- export ----------
  function renderPrint(ratio = 1): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = Math.round(tpl.print.width * ratio);
    out.height = Math.round(FH * ratio);
    const ctx = out.getContext('2d')!;
    exporting = true;
    const placeholders = faceLayer.find('.placeholder');
    placeholders.forEach((n) => n.visible(false));
    faces.forEach((f, i) => {
      const wasVisible = f.face.visible();
      f.face.visible(true);
      const s = f.face.scaleX();
      const c = f.face.toCanvas({ x: f.face.x(), y: f.face.y(), width: FW * s, height: FH * s, pixelRatio: ratio / s });
      ctx.drawImage(c, Math.round(i * FW * ratio), 0, Math.round(FW * ratio), out.height);
      f.face.visible(wasVisible);
    });
    placeholders.forEach((n) => n.visible(true));
    exporting = false;
    return out;
  }

  const mug3d = createMugPreview($('.pc-mug3d'), tpl.mug, {
    width: tpl.print.width / tpl.print.dpi,
    height: tpl.print.height / tpl.print.dpi,
  });
  let mug3dVisible = false;
  let mugTimer = 0;
  function changed() {
    faceLayer.batchDraw();
    if (!mug3dVisible) return;
    clearTimeout(mugTimer);
    mugTimer = window.setTimeout(() => mug3d.update(renderPrint(0.9)), 200);
  }

  async function exportPersonalization(): Promise<Personalization> {
    await document.fonts.ready;
    const print = renderPrint(1);
    const printBlob = await new Promise<Blob>((res) => print.toBlob((b) => res(b!), 'image/png'));
    const prev = document.createElement('canvas');
    prev.width = 800;
    prev.height = Math.round((800 * print.height) / print.width);
    prev.getContext('2d')!.drawImage(print, 0, 0, prev.width, prev.height);
    const options: Record<string, string> = {
      'Pet name': state.name,
      Style: tpl.styles.find((s) => s.id === state.style)!.label,
      Background: tpl.backgrounds.find((b) => b.id === state.background)!.label,
      Greeting: state.greeting,
      Font: state.font,
      'Text color': state.textColor,
      Mirrored: state.mirror ? 'Yes' : 'No',
    };
    return { templateId: tpl.id, options, previewDataUrl: prev.toDataURL('image/jpeg', 0.85), printBlob };
  }

  // ---------- panel ----------
  const petEl = $('.pc-pet');
  const stylesEl = $('.pc-styles');
  const aiEl = $('.pc-ai');
  const actionsMsg = $('.pc-actions-msg');

  function renderPetPanel() {
    const text = state.busy ? state.busyMsg : state.photo ? 'Change photo' : "Upload your pet's photo";
    petEl.innerHTML = `
      <label class="pc-upload ${state.busy ? 'processing' : state.photo ? 'ready' : ''}">
        <input type="file" accept="image/*" data-photo hidden ${state.busy ? 'disabled' : ''}>
        ${state.photoThumb ? `<img src="${state.photoThumb}" alt="">` : '<span class="pc-upload-icon">＋</span>'}
        <span class="pc-upload-text">${esc(text)}</span>
      </label>
      <input type="text" class="pc-input" data-field="name" maxlength="14" placeholder="Pet name" value="${esc(state.name)}">`;
  }

  function renderStyles() {
    stylesEl.innerHTML = tpl.styles
      .map((s) => {
        const done = !!state.illustrations[s.id];
        return `<button type="button" data-style="${s.id}" class="${s.id === state.style ? 'is-active' : ''}" aria-pressed="${s.id === state.style}">
          <img src="${s.example}" alt=""><span>${esc(s.label)}</span>${state.photo && done ? '<i aria-label="ready">✓</i>' : ''}
        </button>`;
      })
      .join('');
    const canReroll = !!state.photo && !!own() && !state.busy && aiEnabled && state.triesLeft > 0;
    const parts: string[] = [];
    if (!state.photo) parts.push('<p class="pc-ai-note">Shown with an example pet. Upload a photo to paint your own.</p>');
    if (state.busy) parts.push('<p class="pc-ai-note">Painting takes about 20–30 seconds.</p>');
    if (state.error) parts.push(`<p class="pc-ai-msg">${esc(state.error)}</p>`);
    if (state.photo && !state.busy && !own() && aiEnabled && state.triesLeft > 0)
      parts.push(`<button type="button" class="pc-ai-btn" data-ai="paint"><span>✨ Paint this style</span><small>${state.triesLeft} left</small></button>`);
    if (canReroll) parts.push(`<button type="button" class="pc-ai-btn pc-ai-btn-quiet" data-ai="paint"><span>↻ Paint again</span><small>${state.triesLeft} left</small></button>`);
    if (state.photo && aiEnabled && state.triesLeft <= 0 && !state.busy) parts.push('<p class="pc-ai-note">No more paintings left for this photo today.</p>');
    aiEl.innerHTML = parts.join('');
  }

  function renderAll() {
    renderPetPanel();
    renderStyles();
    rebuildDesigns();
  }

  function syncPanel() {
    root.querySelectorAll<HTMLButtonElement>('[data-field=background] button').forEach((b) => b.classList.toggle('is-active', b.dataset.v === state.background));
    root.querySelectorAll<HTMLButtonElement>('[data-field=textColor] button').forEach((b) => b.classList.toggle('is-active', b.dataset.v === state.textColor));
    $<HTMLSelectElement>('[data-field=font]').value = state.font;
  }

  $('[data-field=background]').innerHTML = tpl.backgrounds
    .map((b) => `<button type="button" data-v="${b.id}" title="${b.label}"><img src="${b.src}" alt=""><span>${b.label}</span></button>`)
    .join('');
  $<HTMLSelectElement>('[data-field=font]').innerHTML = tpl.fonts.map((f) => `<option value="${f}">${f}</option>`).join('');
  $('[data-field=textColor]').innerHTML = tpl.textColors
    .map((c) => `<button type="button" data-v="${c}" style="--c:${c}" aria-label="Text color ${c}"></button>`)
    .join('');
  $<HTMLInputElement>('[data-field=greeting]').value = state.greeting;

  const pick = (e: Event) => (e.target as HTMLElement).closest('button')?.dataset.v;
  $('[data-field=background]').addEventListener('click', (e) => {
    const v = pick(e);
    if (!v) return;
    state.background = v;
    state.textColor = tpl.backgrounds.find((b) => b.id === v)!.textColor;
    applyBackground();
    applyText();
    syncPanel();
    rebuildDesigns();
  });
  $('[data-field=textColor]').addEventListener('click', (e) => {
    const v = pick(e);
    if (!v) return;
    state.textColor = v;
    applyText();
    syncPanel();
    rebuildDesigns();
  });
  $('[data-field=greeting]').addEventListener('input', (e) => {
    state.greeting = (e.target as HTMLInputElement).value;
    applyText();
    changed();
  });
  $('[data-field=font]').addEventListener('change', async (e) => {
    state.font = (e.target as HTMLSelectElement).value;
    await document.fonts.load(`80px "${state.font}"`);
    applyText();
    rebuildDesigns();
  });

  petEl.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.field === 'name') {
      state.name = t.value;
      rebuildDesigns();
    }
  });
  petEl.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.photo !== undefined && t.files?.[0]) void onUpload(t.files[0]);
  });

  stylesEl.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest('button')?.dataset.style;
    if (!id || id === state.style) return;
    state.style = id;
    state.error = '';
    renderStyles();
    rebuildDesigns();
    // Paint the newly picked style automatically (once; cached afterwards).
    if (state.photo && !own() && !state.busy) void paint(id);
  });
  aiEl.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-ai=paint]')) void paint(state.style);
  });

  // ---------- upload + AI ----------
  async function onUpload(file: File) {
    if (state.photoThumb) URL.revokeObjectURL(state.photoThumb);
    state.photo = file;
    state.photoThumb = URL.createObjectURL(file);
    state.illustrations = {};
    state.lastShown = undefined;
    state.triesLeft = tpl.ai.triesPerPhoto;
    state.error = '';
    actionsMsg.textContent = '';
    await paint(state.style);
  }

  async function paint(style: string) {
    if (!state.photo || state.busy) return;
    if (aiEnabled && state.triesLeft <= 0) return;
    state.busy = true;
    state.error = '';
    state.busyMsg = 'Painting your pet…';
    renderAll();
    const setMsg = (m: string) => {
      state.busyMsg = m;
      const el = petEl.querySelector('.pc-upload-text');
      if (el) el.textContent = m;
    };
    void preloadBackgroundRemoval(); // download the cut-out model while the AI paints
    try {
      let image: Blob = state.photo;
      if (aiEnabled) {
        const { blob, remaining } = await illustrate(state.photo, style);
        state.triesLeft = Math.min(state.triesLeft - 1, remaining);
        image = blob;
      }
      setMsg('Finishing touches…');
      const { canvas } = await cutout(image, setMsg);
      state.illustrations[style] = canvas;
      state.lastShown = canvas;
    } catch (err) {
      console.error(err);
      // Overload/network problems don't cost the customer a try.
      if (err instanceof AiError && !['network', 'timeout', 'upstream_busy'].includes(err.code)) state.triesLeft--;
      if (err instanceof AiError && err.remaining !== undefined) state.triesLeft = Math.min(state.triesLeft, err.remaining);
      state.triesLeft = Math.max(0, state.triesLeft);
      state.error = aiErrorMessage(err);
    }
    state.busy = false;
    renderAll();
    select(lastVisible());
    // The customer may have picked another style while we were painting.
    if (state.style !== style && !own() && !state.error) void paint(state.style);
  }

  // Tabs
  root.querySelectorAll<HTMLButtonElement>('.pc-tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      root.querySelectorAll('.pc-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      root.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.view));
      mug3dVisible = tab.dataset.view === '3d';
      if (mug3dVisible) {
        mug3d.update(renderPrint(0.9));
        mug3d.show();
      } else {
        mug3d.hide();
        layout();
      }
    }),
  );

  // Actions (only with the customer's own illustration, never the example)
  function readyForExport() {
    if (own()) return true;
    actionsMsg.textContent = state.busy ? 'Please wait until your pet is painted.' : "Please upload your pet's photo first.";
    return false;
  }
  root.querySelector('[data-action=download]')!.addEventListener('click', async () => {
    if (!readyForExport()) return;
    const p = await exportPersonalization();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(p.printBlob);
    a.download = `${tpl.id}-print-${tpl.print.width}x${tpl.print.height}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  root.querySelector('[data-action=cart]')!.addEventListener('click', async () => {
    if (!readyForExport()) return;
    actionsMsg.textContent = '';
    const p = await exportPersonalization();
    await opts.onAddToCart?.(p);
  });

  // ---------- initial render ----------
  await Promise.all(tpl.fonts.map((f) => document.fonts.load(`80px "${f}"`).catch(() => undefined)));
  applyBackground();
  applyText();
  syncPanel();
  layout();
  renderAll();
  select(lastVisible());

  return { exportPersonalization };
}
