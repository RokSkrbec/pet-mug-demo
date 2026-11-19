// A template is pure data. In the Shopify app this JSON lives in the DB / a metafield
// and is assigned to products from the admin. Adding a new design = new JSON + images.
import { backgroundStars, backgroundSnow, backgroundBlush, backgroundPlain } from './assets';

const examples = `${import.meta.env.BASE_URL}examples/`;

export interface Template {
  id: string;
  name: string;
  /** Full wrap print area in px at 300 DPI. 11oz mug = 8.25" x 3.5". */
  print: { width: number; height: number; dpi: number };
  /** The print is split into `sides` equal faces; the same design is printed on each face. */
  sides: number;
  /** Physical mug, used for the 3D preview (inches). */
  mug: { circumference: number; height: number };
  backgrounds: { id: string; label: string; src: string; textColor: string }[];
  fonts: string[];
  textColors: string[];
  /** Where the movable design sits by default, in face px (centre point) and its default scale. */
  design: { x: number; y: number; scale: number; minScale: number; maxScale: number };
  /** Pet relative to the design centre: x = centre, y = bottom of pet, h = max pet height. */
  pet: { x: number; y: number; h: number };
  /** AI illustration styles. `id` must match a prompt in worker/src/index.ts. `example` is shown before upload. */
  styles: { id: string; label: string; example: string }[];
  defaultStyle: string;
  /** Fixed greeting text (not movable), face px. */
  greeting: { default: string; x: number; y: number; fontSize: number };
  petName: { default: string; fontSize: number; gap: number };
  /** AI tries per uploaded photo (the worker also enforces per-visitor/day limits). */
  ai: { triesPerPhoto: number };
}

const W = 2475;
const H = 1050;
const FW = W / 2;

export const christmasPetMug: Template = {
  id: 'christmas-pet-mug',
  name: 'Christmas pet mug',
  print: { width: W, height: H, dpi: 300 },
  sides: 2,
  mug: { circumference: 10.2, height: 3.8 },
  backgrounds: [
    { id: 'stars', label: 'Festive stars', src: backgroundStars(W, H), textColor: '#3f3f46' },
    { id: 'snow', label: 'Soft snow', src: backgroundSnow(W, H), textColor: '#5f7a96' },
    { id: 'blush', label: 'Blush', src: backgroundBlush(W, H), textColor: '#a8646c' },
    { id: 'plain', label: 'Plain white', src: backgroundPlain(W, H), textColor: '#3f3f46' },
  ],
  fonts: ['Great Vibes', 'Dancing Script', 'Pacifico', 'Mountains of Christmas', 'Fredoka'],
  textColors: ['#3f3f46', '#a8646c', '#6f8f76', '#5f7a96', '#b8953f'],
  design: { x: FW / 2, y: H * 0.6, scale: 1, minScale: 0.3, maxScale: 2.5 },
  pet: { x: 0, y: 220, h: 560 },
  styles: [
    { id: 'hat-scarf', label: 'Santa hat + scarf', example: `${examples}example-hat-scarf.webp` },
    { id: 'hat-lights', label: 'Santa hat + lights', example: `${examples}example-hat-lights.webp` },
    { id: 'none', label: 'No accessories', example: `${examples}example-none.webp` },
  ],
  defaultStyle: 'hat-scarf',
  greeting: { default: 'Vesel božič', x: FW / 2, y: 105, fontSize: 130 },
  petName: { default: 'Luna', fontSize: 96, gap: 0 },
  ai: { triesPerPhoto: 10 },
};
