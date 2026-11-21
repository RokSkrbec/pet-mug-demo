// Embeddable customizer widget. Same bundle is used by the standalone demo
// and (later) by the Shopify theme app extension.
//
// Flow: before upload the product shows an example illustration for the selected style. When the customer
// uploads a photo, the AI illustration for the selected style is generated automatically and used (the raw
// photo is never placed on a product). Switching style generates that style once and caches it.
//
// Products: the SAME illustration/text is shown on every product (mug, pillow, t-shirt), so switching
// products never costs another AI call. Each product has its own print size, mockup and design position.
// A product's print can have several faces (`sides`, 2 on a mug) that all carry the same design.
//
// Preview: the flat, editable print (Konva) sits underneath; on top, photoMockup.ts renders the real product
// photo with the print warped onto it and lit by the photo's own shading. Hits pass through to the flat print.
import Konva from 'konva';
import type { ProductDef, Template } from './template';
import { loadImage } from './assets';
import { cutout } from './petPhoto';
import { Compositor, flatRect, loadMockup, type LoadedMockup, type View } from './photoMockup';
import { aiEnabled, aiErrorMessage, illustrate, AiError } from './ai';
import { preloadTurnstile } from './turnstile';

export interface Personalization {
  templateId: string;
  productId: string;
  options: Record<string, string>;
  /** Small JPEG for the cart/order preview. */
  previewDataUrl: string;
  /** Full-resolution print file (PNG; transparent for the t-shirt). */
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
  mug: '<path d="M5 6h11v11a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/><path d="M16 9h1.5a2.5 2.5 0 0 1 0 5H16"/>',
  pillow: '<path d="M4 5q8 2 16 0q-2 7 0 14q-8-2-16 0q2-7 0-14z"/>',
  tshirt: '<path d="M9 4l-5 3 2 4 2-1v10h8V10l2 1 2-4-5-3a3 3 0 0 1-6 0z"/>',
};
const icon = (k: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The three things on a print that the customer can move, resize and rotate independently. */
type El = 'pet' | 'name' | 'greeting';
type TextEl = Exclude<El, 'pet'>;
const ELS: El[] = ['pet', 'name', 'greeting'];
const EL_LABEL: Record<El, string> = { pet: 'Pet', name: 'Name', greeting: 'Greeting' };

interface Face {
  face: Konva.Group;
  bg?: Konva.Image;
  els: { pet: Konva.Group; name: Konva.Text; greeting: Konva.Text };
}
/** Position of an element's centre (face px), its scale and rotation. */
type Transform = { x: number; y: number; scale: number; rotation: number };

export async function mountCustomizer(root: HTMLElement, tpl: Template, opts: CustomizerOptions = {}) {
  const product = (id: string) => tpl.products.find((p) => p.id === id)!;
  const tshirt = tpl.products.find((p) => p.colors);

  const state = {
    product: tpl.defaultProduct,
    background: tpl.backgrounds[0].id,
    shirtColor: tshirt?.colors?.[0].id ?? '',
    /** The two texts, each with its own font and colour. `picked`: the customer chose the colour (a new background
     *  then no longer resets it to the background's matching colour). */
    text: {
      name: { value: tpl.petName.default, font: tpl.fonts[0], color: tpl.backgrounds[0].textColor, picked: false },
      greeting: { value: tpl.greetingDefault, font: tpl.fonts[0], color: tpl.backgrounds[0].textColor, picked: false },
    } as Record<TextEl, { value: string; font: string; color: string; picked: boolean }>,
    /** Element the tool buttons act on (and that has handles when selected on the stage). */
    selected: 'pet' as El,
    mirror: false,
    style: tpl.defaultStyle,
    photo: undefined as File | undefined,
    photoThumb: '',
    /** Finished illustrations (background removed) per style id, for the current photo. Shared by all products. */
    illustrations: {} as Record<string, HTMLCanvasElement>,
    /** Last illustration shown, kept on screen while another style is being painted. */
    lastShown: undefined as HTMLCanvasElement | undefined,
    busy: false,
    busyMsg: '',
    error: '',
    triesLeft: tpl.ai.triesPerPhoto,
    /** Element positions per product (each product has its own print area); missing = product default. */
    transforms: {} as Record<string, Partial<Record<El, Transform>>>,
  };
  const own = () => state.illustrations[state.style];

  root.classList.add('pc');
  root.innerHTML = `
    <div class="pc-preview">
      <div class="pc-head">
        <div class="pc-products" role="tablist" aria-label="Product">
          ${tpl.products.map((p) => `<button type="button" role="tab" data-product="${p.id}"><canvas class="pc-thumb" aria-hidden="true"></canvas>${icon(p.mockup)}<span>${esc(p.label)}</span></button>`).join('')}
        </div>
      </div>
      <div data-panel="edit">
        <div class="pc-stage" tabindex="0" aria-label="Product preview. Drag the design. Arrow keys move it, plus and minus zoom."></div>
        <p class="pc-hint"><span class="pc-hint-mouse">Click the pet, the name or the greeting to select it. Drag to move it, drag a corner to resize, or use the buttons below.</span><span class="pc-hint-touch">Tap the pet, the name or the greeting to select it. Drag to move it, pinch to resize, or use the buttons below.</span></p>
        <div class="pc-els" role="radiogroup" aria-label="What to edit">
          <span>Edit:</span>
          ${ELS.map((el) => `<button type="button" role="radio" data-el="${el}">${EL_LABEL[el]}</button>`).join('')}
        </div>
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
          <button type="button" data-tool="reset"><span>Reset positions</span></button>
        </div>
      </div>
    </div>
    <form class="pc-panel" autocomplete="off">
      <fieldset><legend>Your pet</legend><div class="pc-pet"></div></fieldset>
      <fieldset><legend>Style</legend><div class="pc-styles"></div><div class="pc-ai"></div><div class="pc-botcheck"></div></fieldset>
      <fieldset data-section="background"><legend>Background</legend><div class="pc-swatches" data-field="background"></div></fieldset>
      <fieldset data-section="shirt" hidden><legend>Shirt color</legend><div class="pc-colors pc-shirt-colors" data-field="shirtColor"></div></fieldset>
      ${(['name', 'greeting'] as TextEl[])
        .map(
          (el) => `<fieldset class="pc-text" data-section="${el}"><legend>${el === 'name' ? 'Pet name' : 'Greeting'}</legend>
        <input type="text" class="pc-input" data-text="${el}" maxlength="${el === 'name' ? 14 : 28}" placeholder="${el === 'name' ? 'Pet name (optional)' : 'Greeting (optional)'}">
        <div class="pc-fonts" role="radiogroup" aria-label="Font">${tpl.fonts.map((f) => `<button type="button" role="radio" data-font="${esc(f)}" style="font-family:'${esc(f)}'">${esc(f)}</button>`).join('')}</div>
        <div class="pc-colors" role="radiogroup" aria-label="Text color">${tpl.textColors.map((c) => `<button type="button" role="radio" data-color="${c}" style="--c:${c}" aria-label="Color ${c}"></button>`).join('')}</div>
      </fieldset>`,
        )
        .join('')}
      <div class="pc-actions">
        <button type="button" class="pc-btn pc-btn-ghost" data-action="download">Download print file</button>
        <button type="button" class="pc-btn" data-action="cart">Add to cart</button>
      </div>
      <p class="pc-actions-msg" role="status"></p>
    </form>`;

  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;

  // ---------- assets ----------
  const exampleImgs = Object.fromEntries(
    await Promise.all(tpl.styles.map(async (s) => [s.id, await loadImage(s.example)])),
  ) as Record<string, HTMLImageElement>;
  // Background patterns are rendered per product size, on demand, and cached.
  const bgCache = new Map<string, Promise<HTMLImageElement>>();
  const bgImage = (bgId: string, p: ProductDef) => {
    const key = `${bgId}:${p.id}`;
    if (!bgCache.has(key)) bgCache.set(key, loadImage(tpl.backgrounds.find((b) => b.id === bgId)!.render(p.print.width, p.print.height, p.design.scale)));
    return bgCache.get(key)!;
  };

  // ---------- Konva stage ----------
  const stageEl = $('.pc-stage');
  const stage = new Konva.Stage({ container: stageEl as HTMLDivElement, width: 10, height: 10 });
  const faceLayer = new Konva.Layer(); // the flat print (interactive, hidden under the photo preview)
  const photoLayer = new Konva.Layer({ listening: false }); // photo-realistic preview (clicks pass through)
  const uiLayer = new Konva.Layer();
  stage.add(faceLayer, photoLayer, uiLayer);
  const compositor = new Compositor();
  const photoNode = new Konva.Image({ image: undefined, x: 0, y: 0 });
  photoLayer.add(photoNode);
  // Product photos are loaded on demand and cached.
  const mockups = new Map<string, Promise<LoadedMockup>>();
  const loaded = new Map<string, LoadedMockup>();
  const mockupFor = (p: ProductDef) => {
    if (!mockups.has(p.id)) mockups.set(p.id, loadMockup(p.photo).then((m) => (loaded.set(p.id, m), m)));
    return mockups.get(p.id)!;
  };

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
  // Dashed outline of the printable area (t-shirt), shown while the design is selected.
  const printArea = new Konva.Rect({ visible: false, listening: false, strokeWidth: 1.5, dash: [6, 5] });
  uiLayer.add(printArea, tr);

  let P = product(state.product);
  let FW = 0;
  let FH = 0;
  let faces: Face[] = [];
  /** Face that shows the selection handles (-1 = nothing selected). */
  let selFace = -1;
  /** Views (product photos on the stage) and which face is shown in each. */
  let views: View[] = [];
  let viewFaces: Face[] = [];

  /** Default layout: pet in the middle, name under it, greeting on top (from the template's design units). */
  function defaultTransform(p: ProductDef, el: El): Transform {
    const d = p.design;
    const s = tpl.pet;
    if (el === 'pet') return { x: d.x + s.x * d.scale, y: d.y + (s.y - s.h / 2) * d.scale, scale: d.scale, rotation: 0 };
    if (el === 'name') return { x: d.x + s.x * d.scale, y: d.y + (s.y + tpl.petName.gap + tpl.petName.fontSize / 2) * d.scale, scale: d.scale, rotation: 0 };
    return { x: p.print.width / p.sides / 2, y: p.greeting.y + p.greeting.fontSize / 2, scale: 1, rotation: 0 };
  }
  const transformOf = (p: ProductDef, el: El) => state.transforms[p.id]?.[el] ?? defaultTransform(p, el);
  const toAttrs = (t: Transform) => ({ x: t.x, y: t.y, scaleX: t.scale, scaleY: t.scale, rotation: t.rotation });
  const saveTransform = (el: El) => {
    const n = faces[0]?.els[el];
    if (n) (state.transforms[P.id] ??= {})[el] = { x: n.x(), y: n.y(), scale: n.scaleX(), rotation: n.rotation() };
  };
  const zoomRange = (el: El) => {
    const s = defaultTransform(P, el).scale;
    return [s * tpl.zoom.min, s * tpl.zoom.max] as const;
  };

  /** One print face of product `p` with all its elements. Used on stage and for thumbnails. */
  function makeFace(p: ProductDef, i: number, draggable: boolean): Face {
    const fw = p.print.width / p.sides;
    const fh = p.print.height;
    const face = new Konva.Group({ clipFunc: (ctx) => ctx.rect(0, 0, fw, fh) });
    const bg = p.background
      ? new Konva.Image({ image: undefined, width: fw, height: fh, crop: { x: i * fw, y: 0, width: fw, height: fh }, listening: false })
      : undefined;
    const common = { name: 'el', draggable };
    const els = {
      pet: new Konva.Group({ ...common, el: 'pet' }),
      name: new Konva.Text({ ...common, el: 'name', wrap: 'none' }),
      greeting: new Konva.Text({ ...common, el: 'greeting', wrap: 'none' }),
    };
    if (bg) face.add(bg);
    face.add(els.greeting, els.pet, els.name);
    buildPet(els.pet);
    styleText(els.name, 'name', p);
    styleText(els.greeting, 'greeting', p);
    ELS.forEach((el) => els[el].setAttrs(toAttrs(transformOf(p, el))));
    return { face, bg, els };
  }

  /** Text content, font and colour. Text is centred on its position, so editing it keeps it in place. */
  function styleText(t: Konva.Text, el: TextEl, p: ProductDef) {
    const { value, font, color } = state.text[el];
    const base = el === 'name' ? tpl.petName.fontSize : p.greeting.fontSize;
    t.setAttrs({ text: value, fontFamily: font, fill: color, fontSize: base });
    // Long texts shrink to fit the print at their default size (the customer can still resize them).
    const maxW = (p.print.width / p.sides) * 0.86 / defaultTransform(p, el).scale;
    if (t.width() > maxW) t.fontSize((base * maxW) / t.width());
    t.offset({ x: t.width() / 2, y: t.height() / 2 });
    t.visible(value.trim().length > 0);
  }

  /** (Re)build the print faces for the current product. */
  function setupProduct() {
    tr.nodes([]);
    selFace = -1;
    faceLayer.destroyChildren();
    P = product(state.product);
    FW = P.print.width / P.sides;
    FH = P.print.height;
    faces = Array.from({ length: P.sides }, (_, i) => makeFace(P, i, true));
    faces.forEach((f) => faceLayer.add(f.face));
    // Every element exists once per face (both sides of the mug) and always moves together.
    for (const el of ELS) {
      faces.forEach((f) => {
        const n = f.els[el];
        const sync = () => faces.forEach((o) => o !== f && o.els[el].setAttrs({ x: n.x(), y: n.y(), scaleX: n.scaleX(), scaleY: n.scaleY(), rotation: n.rotation() }));
        n.on('dragmove', () => {
          sync();
          scheduleCompose();
        });
        n.on('transform', () => {
          const [lo, hi] = zoomRange(el);
          const s = clamp(n.scaleX(), lo, hi);
          n.scale({ x: s, y: s });
          sync();
          scheduleCompose();
        });
        n.on('dragend transformend', () => {
          saveTransform(el);
          changed();
        });
      });
    }
    void applyBackground();
    // UI that depends on the product
    root.querySelectorAll<HTMLButtonElement>('[data-product]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.product === P.id);
      b.setAttribute('aria-selected', String(b.dataset.product === P.id));
    });
    $<HTMLElement>('[data-section=background]').hidden = !P.background;
    $<HTMLElement>('[data-section=shirt]').hidden = !P.colors;
    layout();
    select(state.selected);
  }

  // ---------- pet illustration (identical on every face) ----------
  function buildPet(g: Konva.Group) {
    g.destroyChildren();
    const slot = tpl.pet;
    const mine = own();
    // What to show: own illustration > previous illustration (while painting another style) > example.
    const img: CanvasImageSource = mine ?? (state.photo && state.lastShown ? state.lastShown : exampleImgs[state.style]);
    const iw = (img as HTMLCanvasElement).width;
    const ih = (img as HTMLCanvasElement).height;
    const pending = !!state.photo && !mine; // photo uploaded but this style isn't painted (yet)
    const scale = Math.min(slot.h / ih, (slot.h * 1.1) / iw);
    const w = iw * scale;
    const h = ih * scale;

    // The group's origin is the centre of the pet slot; the pet stands on the slot's bottom edge.
    // Mirror flips the pet around its own centre.
    const flip = new Konva.Group({ scaleX: state.mirror ? -1 : 1 });
    flip.add(new Konva.Image({ image: img, width: w, height: h, offsetX: w / 2, offsetY: h, y: slot.h / 2, opacity: pending ? 0.3 : 1 }));
    g.add(flip);

    if (pending) {
      const msg = state.busy ? 'Painting your pet…' : state.error ? 'Not painted yet' : '';
      if (msg) {
        const t = new Konva.Text({ name: 'placeholder', text: msg, fontSize: 70, fontFamily: 'Fredoka', fill: '#7d7067', align: 'center' });
        t.offset({ x: t.width() / 2, y: t.height() / 2 });
        g.add(t);
      }
    }

    // Invisible hit area so the whole pet (incl. transparent gaps) is draggable.
    const box = g.getClientRect({ relativeTo: g, skipShadow: true, skipStroke: true });
    const pad = 20;
    const hit = new Konva.Rect({ x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2, fill: 'rgba(0,0,0,0)' });
    g.add(hit);
    hit.moveToBottom();
  }

  function rebuildPets() {
    faces.forEach((f) => buildPet(f.els.pet));
    tr.forceUpdate();
    changed();
  }

  function applyText(el: TextEl) {
    faces.forEach((f) => styleText(f.els[el], el, P));
    if (state.selected === el) select(el, selFace >= 0 ? selFace : -1); // handles follow the new size (or hide when empty)
    changed();
  }

  async function applyBackground() {
    if (!P.background) return;
    const p = P;
    const img = await bgImage(state.background, p);
    if (p !== P) return; // product changed meanwhile
    faces.forEach(({ bg }) => bg?.image(img));
    changed();
  }

  // ---------- transforms (applied to the selected element, on every face) ----------
  function applyAll(el: El, a: Partial<Konva.NodeConfig>) {
    faces.forEach((f) => f.els[el].setAttrs(a));
    saveTransform(el);
    tr.forceUpdate();
    changed();
  }
  const cur = () => faces[0].els[state.selected];
  const zoomBy = (f: number) => {
    const [lo, hi] = zoomRange(state.selected);
    const s = clamp(cur().scaleX() * f, lo, hi);
    applyAll(state.selected, { scaleX: s, scaleY: s });
  };
  const rotateBy = (deg: number) => applyAll(state.selected, { rotation: cur().rotation() + deg });
  // Steps are in face px, so scale them with the product's design scale for a similar on-screen distance.
  const moveBy = (dx: number, dy: number) => applyAll(state.selected, { x: cur().x() + dx * P.design.scale, y: cur().y() + dy * P.design.scale });

  const lastVisible = () => faces.map((f) => f.face.visible()).lastIndexOf(true);
  /**
   * Make `el` the element being edited. Handles are shown on face `i` (default: the visible face) unless i = -1.
   * Also highlights it in the "Edit" switch and its section in the panel.
   */
  function select(el: El, i = lastVisible()) {
    state.selected = el;
    const n = i >= 0 && faces[i]?.face.visible() ? faces[i].els[el] : undefined;
    tr.nodes(n?.visible() ? [n] : []);
    selFace = tr.nodes().length ? i : -1;
    printArea.visible(P.mockup === 'tshirt' && selFace >= 0);
    root.querySelectorAll<HTMLButtonElement>('[data-el]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.el === el);
      b.setAttribute('aria-checked', String(b.dataset.el === el));
    });
    root.querySelectorAll<HTMLElement>('.pc-text').forEach((f) => f.classList.toggle('is-editing', f.dataset.section === el));
    mirrorBtn.hidden = el !== 'pet';
    uiLayer.batchDraw();
  }
  const deselect = () => select(state.selected, -1);
  /** The element (and face) under a stage event target, if any. */
  function hitEl(target: Konva.Node): [El, number] | undefined {
    const n = target.findAncestor('.el', true);
    if (!n) return;
    const el = n.getAttr('el') as El;
    return [el, faces.findIndex((f) => f.els[el] === n)];
  }
  const openUpload = () => root.querySelector<HTMLInputElement>('input[type=file][data-photo]')?.click();

  stage.on('click tap', (e) => {
    const hit = hitEl(e.target);
    if (!hit) return deselect();
    select(...hit);
    if (hit[0] === 'pet' && !state.photo) openUpload(); // tapping the example pet invites the upload
  });
  // Pressing on an element selects it immediately (so you see handles while dragging).
  stage.on('mousedown touchstart', (e) => {
    const hit = hitEl(e.target);
    if (hit) select(...hit);
  });
  // Double-click a text to type in it.
  stage.on('dblclick dbltap', (e) => {
    const el = hitEl(e.target)?.[0];
    if (el && el !== 'pet') $<HTMLInputElement>(`[data-text=${el}]`).focus();
  });
  stage.on('mouseover', (e) => (stageEl.style.cursor = hitEl(e.target) ? 'move' : ''));
  stage.on('mouseout', () => (stageEl.style.cursor = ''));

  // Mouse wheel zoom (only while something is selected, so the page still scrolls otherwise)
  stageEl.addEventListener(
    'wheel',
    (e) => {
      if (selFace < 0) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.05 : 1 / 1.05);
    },
    { passive: false },
  );

  // Two-finger pinch zoom
  let lastDist = 0;
  stage.on('touchmove', (e) => {
    const t = e.evt.touches;
    if (t.length !== 2 || selFace < 0) return;
    e.evt.preventDefault();
    faces.forEach((f) => ELS.forEach((el) => f.els[el].isDragging() && f.els[el].stopDrag()));
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
    if (selFace < 0) select(state.selected);
    fn();
  });

  // "Edit:" switch (the easy way to pick a small text on a phone)
  root.querySelectorAll<HTMLButtonElement>('[data-el]').forEach((b) => b.addEventListener('click', () => select(b.dataset.el as El)));

  // Toolbar
  const mirrorBtn = $('[data-tool=mirror]');
  root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      if (selFace < 0) select(state.selected);
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
          return rebuildPets();
        case 'reset':
          state.mirror = false;
          mirrorBtn.classList.remove('is-active');
          delete state.transforms[P.id];
          faces.forEach((f) => buildPet(f.els.pet));
          ELS.forEach((el) => faces.forEach((f) => f.els[el].setAttrs(toAttrs(defaultTransform(P, el)))));
          tr.forceUpdate();
          return changed();
      }
    }),
  );

  // ---------- preview layout + photo compositing ----------
  function layout() {
    const cw = stageEl.clientWidth;
    if (!cw) return; // not visible yet
    const single = cw < 520;
    const ch = Math.round(cw * (single ? 0.95 : 0.6));
    stage.size({ width: cw, height: ch });
    if (!faces.length) return; // product not set up yet
    const m = loaded.get(P.id);
    if (!m) {
      const p = P;
      void mockupFor(p).then(() => p === P && layout());
      return;
    }
    // One photo per visible face: the mug shows both sides (mirrored photo = handle on the left).
    const n = P.sides > 1 && !single ? P.sides : 1;
    const { crop } = m.def;
    const aspect = crop.w / crop.h;
    const vh = Math.min(ch, cw / n / aspect);
    const vw = vh * aspect;
    const x0 = (cw - n * vw) / 2;
    const y0 = (ch - vh) / 2;
    views = Array.from({ length: n }, (_, i) => ({ x: x0 + i * vw, y: y0, w: vw, h: vh, mirror: n > 1 && i === 0 }));
    viewFaces = n === faces.length ? faces : [faces[faces.length - 1]];
    faces.forEach((f) => f.face.visible(viewFaces.includes(f)));
    viewFaces.forEach((f, i) => {
      const r = flatRect(m.def, views[i], FW, FH);
      f.face.setAttrs({ x: r.x, y: r.y, scaleX: r.scale, scaleY: r.scale });
    });
    if (P.photo.warp.kind === 'rect') {
      const f = viewFaces[0].face;
      const shirtHex = P.colors?.find((c) => c.id === state.shirtColor)?.hex ?? '#ffffff';
      const dark = parseInt(shirtHex.slice(1), 16) < 0x808080;
      printArea.setAttrs({ x: f.x(), y: f.y(), width: FW * f.scaleX(), height: FH * f.scaleY(), stroke: dark ? 'rgba(255,255,255,0.6)' : 'rgba(40,30,20,0.4)' });
    }
    photoNode.setAttrs({ width: cw, height: ch });
    if (selFace >= 0 && !faces[selFace].face.visible()) select(state.selected);
    tr.forceUpdate();
    compose();
  }
  new ResizeObserver(layout).observe(stageEl);

  /** Render the photo-realistic preview from the current flat print. */
  function compose() {
    const m = loaded.get(P.id);
    if (!m || !views.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const prints = viewFaces.map((f) => {
      const s = f.face.scaleX();
      return f.face.toCanvas({ x: f.face.x(), y: f.face.y(), width: FW * s, height: FH * s, pixelRatio: dpr * 1.25 });
    });
    const shirt = P.colors?.find((c) => c.id === state.shirtColor);
    const color = shirt && shirt.id !== 'white' ? shirt.hex : undefined;
    photoNode.image(compositor.render(m, views, prints, stage.width(), stage.height(), dpr, color));
    photoLayer.batchDraw();
  }
  let composeQueued = false;
  function scheduleCompose() {
    if (composeQueued) return;
    composeQueued = true;
    requestAnimationFrame(() => {
      composeQueued = false;
      compose();
    });
  }

  // ---------- export ----------
  function renderPrint(ratio = 1): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = Math.round(P.print.width * ratio);
    out.height = Math.round(FH * ratio);
    const ctx = out.getContext('2d')!;
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
    return out;
  }

  function changed() {
    faceLayer.batchDraw();
    scheduleCompose();
    scheduleThumbs();
  }

  // ---------- "your pet on every product" thumbnails (in the product switcher, once the pet is painted) ----------
  // Rendered offscreen with the same faces + compositor as the main preview, so they always match it.
  const thumbLayer = new Konva.Layer();
  new Konva.Stage({ container: document.createElement('div'), width: 1, height: 1 }).add(thumbLayer);
  const thumbCompositor = new Compositor();
  const productsEl = $('.pc-products');
  const THUMB = 120; // css px (square)
  let thumbTimer = 0;
  let thumbRun = 0;
  const showThumbs = () => !!state.photo && !!(own() ?? state.lastShown);

  function scheduleThumbs() {
    clearTimeout(thumbTimer);
    thumbTimer = window.setTimeout(() => void renderThumbs(), 250);
  }

  async function renderThumbs() {
    const on = showThumbs();
    productsEl.classList.toggle('has-thumbs', on);
    if (!on) return;
    const run = ++thumbRun;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const p of tpl.products) {
      const [m, bgImg] = await Promise.all([mockupFor(p), p.background ? bgImage(state.background, p) : undefined]);
      if (run !== thumbRun) return; // something changed meanwhile; a newer run takes over
      // One view, showing the last face (on the mug: handle on the right), like the main preview on a phone.
      const { crop } = m.def;
      const vh = Math.min(THUMB, THUMB / (crop.w / crop.h));
      const vw = vh * (crop.w / crop.h);
      const view: View = { x: (THUMB - vw) / 2, y: (THUMB - vh) / 2, w: vw, h: vh, mirror: false };
      const f = makeFace(p, p.sides - 1, false);
      thumbLayer.add(f.face);
      f.bg?.image(bgImg);
      f.face.find('.placeholder').forEach((n) => n.visible(false));
      const fw = p.print.width / p.sides;
      const r = flatRect(m.def, view, fw, p.print.height);
      f.face.setAttrs({ x: r.x, y: r.y, scaleX: r.scale, scaleY: r.scale });
      const print = f.face.toCanvas({ x: r.x, y: r.y, width: fw * r.scale, height: p.print.height * r.scale, pixelRatio: dpr * 1.25 });
      f.face.destroy();
      const shirt = p.colors?.find((c) => c.id === state.shirtColor);
      const out = thumbCompositor.render(m, [view], [print], THUMB, THUMB, dpr, shirt && shirt.id !== 'white' ? shirt.hex : undefined);
      const c = productsEl.querySelector<HTMLCanvasElement>(`[data-product="${p.id}"] .pc-thumb`)!;
      c.width = out.width;
      c.height = out.height;
      c.getContext('2d')!.drawImage(out, 0, 0);
    }
  }

  async function exportPersonalization(): Promise<Personalization> {
    await document.fonts.ready;
    const print = renderPrint(1);
    const printBlob = await new Promise<Blob>((res) => print.toBlob((b) => res(b!), 'image/png'));
    const shirt = P.colors?.find((c) => c.id === state.shirtColor);
    const prev = document.createElement('canvas');
    prev.width = 800;
    prev.height = Math.round((800 * print.height) / print.width);
    const pctx = prev.getContext('2d')!;
    pctx.fillStyle = shirt?.hex ?? '#ffffff'; // transparent prints (t-shirt) previewed on the shirt colour
    pctx.fillRect(0, 0, prev.width, prev.height);
    pctx.drawImage(print, 0, 0, prev.width, prev.height);
    const options: Record<string, string> = {
      Product: P.label,
      'Pet name': state.text.name.value,
      Style: tpl.styles.find((s) => s.id === state.style)!.label,
      ...(P.background ? { Background: tpl.backgrounds.find((b) => b.id === state.background)!.label } : {}),
      ...(shirt ? { 'Shirt color': shirt.label } : {}),
      'Name font': state.text.name.font,
      'Name color': state.text.name.color,
      Greeting: state.text.greeting.value,
      'Greeting font': state.text.greeting.font,
      'Greeting color': state.text.greeting.color,
      Mirrored: state.mirror ? 'Yes' : 'No',
    };
    return { templateId: tpl.id, productId: P.id, options, previewDataUrl: prev.toDataURL('image/jpeg', 0.85), printBlob };
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
        <span class="pc-upload-body">
          <span class="pc-upload-text">${esc(text)}</span>
          ${state.busy ? '' : '<small class="pc-upload-tip">Tip: a sharp photo showing your whole pet works best. Ears, paws or tail cut off in the photo stay cut off.</small>'}
        </span>
      </label>`;
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
    rebuildPets();
  }

  function syncPanel() {
    root.querySelectorAll<HTMLButtonElement>('[data-field=background] button').forEach((b) => b.classList.toggle('is-active', b.dataset.v === state.background));
    root.querySelectorAll<HTMLButtonElement>('[data-field=shirtColor] button').forEach((b) => b.classList.toggle('is-active', b.dataset.v === state.shirtColor));
    root.querySelectorAll<HTMLElement>('.pc-text').forEach((fs) => {
      const t = state.text[fs.dataset.section as TextEl];
      fs.querySelectorAll<HTMLButtonElement>('[data-font]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.font === t.font);
        b.setAttribute('aria-checked', String(b.dataset.font === t.font));
      });
      fs.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.color === t.color);
        b.setAttribute('aria-checked', String(b.dataset.color === t.color));
      });
    });
  }

  $('[data-field=background]').innerHTML = tpl.backgrounds
    .map((b) => `<button type="button" data-v="${b.id}" title="${b.label}"><img src="${b.render(240, 200, 0.22)}" alt=""><span>${b.label}</span></button>`)
    .join('');
  $('[data-field=shirtColor]').innerHTML = (tshirt?.colors ?? [])
    .map((c) => `<button type="button" data-v="${c.id}" style="--c:${c.hex}" aria-label="${c.label}" title="${c.label}"></button>`)
    .join('');
  root.querySelectorAll<HTMLInputElement>('[data-text]').forEach((i) => (i.value = state.text[i.dataset.text as TextEl].value));

  const pick = (e: Event) => (e.target as HTMLElement).closest('button')?.dataset.v;
  root.querySelectorAll<HTMLButtonElement>('[data-product]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.product === state.product) return;
      state.product = b.dataset.product!;
      setupProduct();
      scheduleThumbs();
    }),
  );
  $('[data-field=background]').addEventListener('click', (e) => {
    const v = pick(e);
    if (!v) return;
    state.background = v;
    // Texts follow the background's matching colour, unless the customer picked one themselves.
    const color = tpl.backgrounds.find((b) => b.id === v)!.textColor;
    for (const el of ['name', 'greeting'] as TextEl[]) {
      if (state.text[el].picked) continue;
      state.text[el].color = color;
      applyText(el);
    }
    void applyBackground();
    syncPanel();
  });
  $('[data-field=shirtColor]').addEventListener('click', (e) => {
    const v = pick(e);
    if (!v) return;
    state.shirtColor = v;
    syncPanel();
    layout();
    scheduleThumbs();
  });
  // Text sections: anything you do in one selects that text on the product, so you see what you're changing.
  root.querySelectorAll<HTMLElement>('.pc-text').forEach((fs) => {
    const el = fs.dataset.section as TextEl;
    const t = state.text[el];
    fs.addEventListener('focusin', () => state.selected !== el && select(el));
    fs.addEventListener('pointerdown', () => state.selected !== el && select(el));
    fs.addEventListener('input', (e) => {
      t.value = (e.target as HTMLInputElement).value;
      applyText(el);
    });
    fs.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.color) {
        t.color = b.dataset.color;
        t.picked = true;
      } else if (b?.dataset.font) {
        t.font = b.dataset.font;
        await document.fonts.load(`80px "${t.font}"`);
      } else return;
      syncPanel();
      applyText(el);
    });
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
    rebuildPets();
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
    try {
      let image: Blob = state.photo;
      if (aiEnabled) {
        // Already painted = "Paint again": ask for a new picture, not the cached one.
        const fresh = !!state.illustrations[style];
        const { blob, remaining, cached } = await illustrate(state.photo, style, { fresh, botCheck: $('.pc-botcheck') });
        state.triesLeft = Math.min(state.triesLeft - (cached ? 0 : 1), remaining);
        image = blob;
      }
      const { canvas } = await cutout(image);
      state.illustrations[style] = canvas;
      state.lastShown = canvas;
    } catch (err) {
      console.error(err);
      // Overload/network problems don't cost the customer a try.
      if (err instanceof AiError && !['network', 'timeout', 'upstream_busy', 'bot_check'].includes(err.code)) state.triesLeft--;
      if (err instanceof AiError && err.remaining !== undefined) state.triesLeft = Math.min(state.triesLeft, err.remaining);
      state.triesLeft = Math.max(0, state.triesLeft);
      state.error = aiErrorMessage(err);
    }
    state.busy = false;
    renderAll();
    select('pet');
    // The customer may have picked another style while we were painting.
    if (state.style !== style && !own() && !state.error) void paint(state.style);
  }

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
    a.download = `${tpl.id}-${P.id}-print-${P.print.width}x${P.print.height}.png`;
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
  await mockupFor(P);
  syncPanel();
  renderPetPanel();
  renderStyles();
  setupProduct();
  tpl.products.forEach((p) => void mockupFor(p)); // warm the other product photos
  if (aiEnabled) void preloadTurnstile();

  return { exportPersonalization };
}
