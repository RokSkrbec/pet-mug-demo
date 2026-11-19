// Embeddable customizer widget. Same bundle is used by the standalone demo
// and (later) by the Shopify theme app extension.
//
// Model: the print is split into `tpl.sides` faces (2 for a mug: one per side) and the SAME
// design is printed on every face. The editor shows one mug per face; the design is a single
// unit (pets + accessories + names) that is dragged/scaled/rotated directly on the mug.
import Konva from 'konva';
import type { AccessoryKind, Template } from './template';
import { loadImage } from './assets';
import { processPetPhoto, type ProcessedPet } from './petPhoto';
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

interface PetState {
  name: string;
  accessory: string;
  status: 'empty' | 'processing' | 'ready' | 'error';
  message: string;
  photo?: ProcessedPet;
  /** AI illustration (accessories are painted in), and the accessory set it was generated with. */
  ai?: { photo: ProcessedPet; accessory: string };
  useAi: boolean;
  aiBusy: boolean;
  aiMsg: string;
  aiTriesLeft: number;
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

export async function mountCustomizer(root: HTMLElement, tpl: Template, opts: CustomizerOptions = {}) {
  const FW = tpl.print.width / tpl.sides;
  const FH = tpl.print.height;

  const state = {
    petCount: 1,
    background: tpl.backgrounds[0].id,
    greeting: tpl.greeting.default,
    font: tpl.fonts[0],
    textColor: tpl.backgrounds[0].textColor,
    mirror: false,
    pets: Array.from({ length: tpl.maxPets }, (_, i): PetState => ({
      name: ['Luna', 'Max', 'Bella'][i] ?? '',
      accessory: tpl.accessoryOptions[1]?.id ?? 'none',
      status: 'empty',
      message: '',
      useAi: false,
      aiBusy: false,
      aiMsg: '',
      aiTriesLeft: tpl.ai.triesPerPet,
    })),
  };

  root.classList.add('pc');
  root.innerHTML = `
    <div class="pc-preview">
      <div class="pc-tabs" role="tablist">
        <button type="button" class="pc-tab is-active" data-view="edit" role="tab">Edit on mug</button>
        <button type="button" class="pc-tab" data-view="3d" role="tab">3D view</button>
      </div>
      <div data-panel="edit">
        <div class="pc-stage" tabindex="0" aria-label="Mug preview. Drag the design. Arrow keys move it, plus and minus zoom."></div>
        <p class="pc-hint">Drag the design on the mug. Zoom with the mouse wheel or two fingers, or use the buttons below and the arrow keys.</p>
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
          <button type="button" data-tool="mirror">${icon('mirror')}<span>Mirror photo</span></button>
          <button type="button" data-tool="reset"><span>Start over</span></button>
        </div>
      </div>
      <div class="pc-mug3d" data-panel="3d" hidden></div>
    </div>
    <form class="pc-panel" autocomplete="off">
      <fieldset><legend>Number of pets</legend><div class="pc-seg" data-field="petCount"></div></fieldset>
      <div class="pc-pets"></div>
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
    </form>`;

  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;

  // ---------- assets ----------
  const accessoryImgs = Object.fromEntries(
    await Promise.all(Object.entries(tpl.accessoryArt).map(async ([k, src]) => [k, await loadImage(src)])),
  ) as Record<AccessoryKind, HTMLImageElement>;
  const bgImgs = Object.fromEntries(
    await Promise.all(tpl.backgrounds.map(async (b) => [b.id, await loadImage(b.src)])),
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
  function makeAccessory(kind: AccessoryKind, fit: ProcessedPet['fit']) {
    const img = accessoryImgs[kind];
    const ar = img.height / img.width;
    let w: number, cx: number, cy: number, ay: number, rot = 0;
    if (kind === 'hat') {
      w = fit.headW * 1.15;
      cx = fit.headCx + fit.headW * 0.05;
      cy = fit.headTop + fit.headW * 0.2;
      ay = 0.82;
      rot = -10;
    } else if (kind === 'scarf') {
      w = fit.neckW * 1.25;
      cx = fit.neckCx;
      cy = fit.neckY;
      ay = 0.36;
    } else {
      w = fit.bodyW * 1.15;
      cx = fit.bodyCx;
      cy = fit.bodyY;
      ay = 0.4;
    }
    const h = w * ar;
    return new Konva.Image({ image: img, width: w, height: h, offsetX: w / 2, offsetY: h * ay, x: cx, y: cy, rotation: rot });
  }

  function buildDesign(g: Konva.Group) {
    g.destroyChildren();
    const layout = tpl.petLayouts[state.petCount];
    state.pets.slice(0, state.petCount).forEach((pet, i) => {
      const slot = layout[i];
      const usingAi = pet.useAi && !!pet.ai;
      const source = usingAi ? pet.ai!.photo : pet.photo;
      if (source) {
        const { canvas, fit } = source;
        const scale = Math.min(slot.h / canvas.height, (slot.h * 1.1) / canvas.width);
        // Mirror flips the pet (and its accessories) around its own centre; text is never mirrored.
        const flip = new Konva.Group({ x: slot.x, y: slot.y, scaleX: state.mirror ? -1 : 1 });
        const inner = new Konva.Group({ scaleX: scale, scaleY: scale, offsetX: canvas.width / 2, offsetY: canvas.height });
        inner.add(new Konva.Image({ image: canvas }));
        // AI illustrations already have the accessories painted in.
        const items = usingAi ? [] : (tpl.accessoryOptions.find((a) => a.id === pet.accessory)?.items ?? []);
        const ordered = [...items.filter((k) => k !== 'hat'), ...items.filter((k) => k === 'hat')];
        for (const kind of ordered) inner.add(makeAccessory(kind, fit));
        flip.add(inner);
        g.add(flip);
      } else {
        const w = slot.h * 0.72;
        const ph = new Konva.Group({ name: 'placeholder' });
        ph.setAttr('petIndex', i);
        ph.add(
          new Konva.Rect({ x: slot.x - w / 2, y: slot.y - slot.h, width: w, height: slot.h, cornerRadius: 40, stroke: '#b9b0a5', strokeWidth: 5, dash: [22, 16], fill: 'rgba(255,255,255,0.55)' }),
          new Konva.Text({ text: `+\nPet ${i + 1}`, x: slot.x - w / 2, y: slot.y - slot.h / 2 - 90, width: w, align: 'center', fontSize: 76, lineHeight: 1.1, fontFamily: 'Fredoka', fill: '#9a9086' }),
        );
        g.add(ph);
      }
      if (pet.name.trim()) {
        const tw = slot.h * 1.5;
        g.add(
          new Konva.Text({
            text: pet.name,
            x: slot.x - tw / 2,
            y: slot.y + tpl.petName.gap,
            width: tw,
            align: 'center',
            wrap: 'none',
            fontSize: tpl.petName.fontSize,
            fontFamily: state.font,
            fill: state.textColor,
          }),
        );
      }
    });
    // Invisible hit area so the gaps between pets are draggable too.
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

  stage.on('click tap', (e) => {
    const t = e.target;
    const design = t.findAncestor('.design', true) as Konva.Group | undefined;
    if (!design) {
      tr.nodes([]);
      return;
    }
    select(designs.indexOf(design));
    const ph = t.findAncestor('.placeholder', true);
    if (ph) root.querySelector<HTMLInputElement>(`input[type=file][data-pet="${ph.getAttr('petIndex')}"]`)?.click();
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
    const bw = Math.min(slotW * 0.72, ch * 0.8);
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
      Pets: String(state.petCount),
      Background: tpl.backgrounds.find((b) => b.id === state.background)!.label,
      Greeting: state.greeting,
      Font: state.font,
      'Text color': state.textColor,
      Mirrored: state.mirror ? 'Yes' : 'No',
    };
    state.pets.slice(0, state.petCount).forEach((p, i) => {
      options[`Pet ${i + 1} name`] = p.name;
      const acc = p.useAi && p.ai ? p.ai.accessory : p.accessory;
      options[`Pet ${i + 1} accessories`] = tpl.accessoryOptions.find((a) => a.id === acc)!.label;
      options[`Pet ${i + 1} style`] = p.useAi && p.ai ? 'AI illustration' : 'Photo';
    });
    return { templateId: tpl.id, options, previewDataUrl: prev.toDataURL('image/jpeg', 0.85), printBlob };
  }

  // ---------- panel ----------
  const segEl = $('[data-field=petCount]');
  segEl.innerHTML = Array.from({ length: tpl.maxPets }, (_, i) => `<button type="button" data-v="${i + 1}">${i + 1}</button>`).join('');
  $('[data-field=background]').innerHTML = tpl.backgrounds
    .map((b) => `<button type="button" data-v="${b.id}" title="${b.label}"><img src="${b.src}" alt=""><span>${b.label}</span></button>`)
    .join('');
  $<HTMLSelectElement>('[data-field=font]').innerHTML = tpl.fonts.map((f) => `<option value="${f}">${f}</option>`).join('');
  $('[data-field=textColor]').innerHTML = tpl.textColors
    .map((c) => `<button type="button" data-v="${c}" style="--c:${c}" aria-label="Text color ${c}"></button>`)
    .join('');
  $<HTMLInputElement>('[data-field=greeting]').value = state.greeting;

  const petsEl = $('.pc-pets');
  function renderPetsPanel() {
    petsEl.innerHTML = state.pets
      .slice(0, state.petCount)
      .map(
        (p, i) => `
      <fieldset class="pc-pet" data-i="${i}"><legend>Pet ${i + 1}</legend>
        <label class="pc-upload ${p.status}">
          <input type="file" accept="image/*" data-pet="${i}" hidden>
          ${p.photo ? `<img src="${p.photo.canvas.toDataURL()}" alt="">` : '<span class="pc-upload-icon">＋</span>'}
          <span class="pc-upload-text">${
            p.status === 'processing' ? p.message : p.status === 'ready' ? 'Change photo' : p.status === 'error' ? p.message : 'Upload photo'
          }</span>
        </label>
        <input type="text" class="pc-input" data-pet-name="${i}" maxlength="14" placeholder="Pet name" value="${p.name.replace(/"/g, '&quot;')}">
        <select class="pc-input" data-pet-acc="${i}">
          ${tpl.accessoryOptions.map((a) => `<option value="${a.id}" ${a.id === p.accessory ? 'selected' : ''}>${a.label}</option>`).join('')}
        </select>
        ${aiBlock(p, i)}
      </fieldset>`,
      )
      .join('');
  }

  function aiBlock(p: PetState, i: number) {
    if (!aiEnabled || !p.photo) return '';
    const label = p.aiBusy ? p.aiMsg || 'Painting…' : p.ai ? 'Paint again' : 'Make illustration';
    const disabled = p.aiBusy || p.aiTriesLeft <= 0;
    return `<div class="pc-ai">
      <button type="button" class="pc-ai-btn ${p.aiBusy ? 'is-busy' : ''}" data-ai-gen="${i}" ${disabled ? 'disabled' : ''}>
        <span>✨ ${label}</span>${p.aiBusy ? '' : `<small>${p.aiTriesLeft} of ${tpl.ai.triesPerPet} left</small>`}
      </button>
      ${p.aiBusy ? '<p class="pc-ai-note">This takes about 10–30 seconds.</p>' : ''}
      ${
        p.ai && !p.aiBusy
          ? `<div class="pc-ai-toggle" role="group" aria-label="Pet ${i + 1} style">
               <button type="button" data-ai-use="${i}" data-v="1" class="${p.useAi ? 'is-active' : ''}">Illustration</button>
               <button type="button" data-ai-use="${i}" data-v="0" class="${p.useAi ? '' : 'is-active'}">Photo</button>
             </div>`
          : ''
      }
      ${p.useAi && p.ai && p.ai.accessory !== p.accessory && !p.aiBusy ? '<p class="pc-ai-note">Accessories changed. Paint again to apply them.</p>' : ''}
      ${!p.aiBusy && p.aiMsg ? `<p class="pc-ai-msg">${p.aiMsg}</p>` : ''}
      ${!p.aiBusy && !p.aiMsg && p.aiTriesLeft <= 0 ? '<p class="pc-ai-note">No illustrations left for this photo today.</p>' : ''}
    </div>`;
  }

  function syncPanel() {
    segEl.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.v === String(state.petCount)));
    root.querySelectorAll<HTMLButtonElement>('[data-field=background] button').forEach((b) => b.classList.toggle('is-active', b.dataset.v === state.background));
    root.querySelectorAll<HTMLButtonElement>('[data-field=textColor] button').forEach((b) => b.classList.toggle('is-active', b.dataset.v === state.textColor));
    $<HTMLSelectElement>('[data-field=font]').value = state.font;
  }

  const pick = (e: Event) => (e.target as HTMLElement).closest('button')?.dataset.v;
  segEl.addEventListener('click', (e) => {
    const v = pick(e);
    if (!v) return;
    state.petCount = Number(v);
    renderPetsPanel();
    syncPanel();
    rebuildDesigns();
  });
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

  petsEl.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.petName !== undefined) {
      state.pets[Number(t.dataset.petName)].name = t.value;
      rebuildDesigns();
    }
  });
  petsEl.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.petAcc !== undefined) {
      state.pets[Number(t.dataset.petAcc)].accessory = t.value;
      renderPetsPanel();
      rebuildDesigns();
    }
    if (t.dataset.pet !== undefined && t.files?.[0]) await handleUpload(Number(t.dataset.pet), t.files[0]);
  });

  async function handleUpload(i: number, file: File) {
    const pet = state.pets[i];
    pet.status = 'processing';
    pet.message = 'Preparing photo…';
    pet.ai = undefined;
    pet.useAi = false;
    pet.aiMsg = '';
    pet.aiTriesLeft = tpl.ai.triesPerPet;
    renderPetsPanel();
    const setMsg = (m: string) => {
      pet.message = m;
      const el = petsEl.querySelector(`.pc-pet[data-i="${i}"] .pc-upload-text`);
      if (el) el.textContent = m;
    };
    try {
      pet.photo = await processPetPhoto(file, setMsg, { soft: tpl.photoFilter === 'soft' });
      pet.status = 'ready';
      if (!pet.photo.backgroundRemoved) alert('Background removal failed for this photo, so the original is used.');
    } catch (err) {
      console.error(err);
      pet.status = 'error';
      pet.message = 'Could not read photo, try another';
    }
    renderPetsPanel();
    rebuildDesigns();
    select(lastVisible());
  }

  // ---------- AI illustration ----------
  petsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.aiGen !== undefined) void handleAi(Number(b.dataset.aiGen));
    if (b.dataset.aiUse !== undefined) {
      state.pets[Number(b.dataset.aiUse)].useAi = b.dataset.v === '1';
      renderPetsPanel();
      rebuildDesigns();
    }
  });

  async function handleAi(i: number) {
    const pet = state.pets[i];
    if (!pet.photo || pet.aiBusy || pet.aiTriesLeft <= 0) return;
    pet.aiBusy = true;
    pet.aiMsg = 'Painting…';
    renderPetsPanel();
    const setMsg = (m: string) => {
      pet.aiMsg = m;
      const el = petsEl.querySelector(`[data-ai-gen="${i}"] span`);
      if (el) el.textContent = `✨ ${m}`;
    };
    try {
      const accessory = pet.accessory;
      const { blob, remaining } = await illustrate(pet.photo.raw, accessory);
      pet.aiTriesLeft--;
      // The visitor's daily allowance is shared across pets.
      state.pets.forEach((p) => (p.aiTriesLeft = Math.min(p.aiTriesLeft, remaining)));
      const photo = await processPetPhoto(blob, setMsg, { soft: false });
      pet.ai = { photo, accessory };
      pet.useAi = true;
      pet.aiMsg = '';
    } catch (err) {
      console.error(err);
      if (err instanceof AiError && !['network', 'timeout', 'upstream_busy'].includes(err.code)) pet.aiTriesLeft--;
      if (err instanceof AiError && err.remaining !== undefined) {
        state.pets.forEach((p) => (p.aiTriesLeft = Math.min(p.aiTriesLeft, err.remaining!)));
      }
      pet.aiTriesLeft = Math.max(0, pet.aiTriesLeft);
      pet.aiMsg = aiErrorMessage(err);
    }
    pet.aiBusy = false;
    renderPetsPanel();
    rebuildDesigns();
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

  // Actions
  root.querySelector('[data-action=download]')!.addEventListener('click', async () => {
    const p = await exportPersonalization();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(p.printBlob);
    a.download = `${tpl.id}-print-${tpl.print.width}x${tpl.print.height}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  root.querySelector('[data-action=cart]')!.addEventListener('click', async () => {
    const p = await exportPersonalization();
    await opts.onAddToCart?.(p);
  });

  // ---------- initial render ----------
  await Promise.all(tpl.fonts.map((f) => document.fonts.load(`80px "${f}"`).catch(() => undefined)));
  applyBackground();
  applyText();
  renderPetsPanel();
  syncPanel();
  layout();
  designs.forEach(buildDesign);
  select(lastVisible());
  changed();

  return { exportPersonalization };
}
