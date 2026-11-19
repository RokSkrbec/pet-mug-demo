// A template is pure data. In the Shopify app this JSON lives in the DB / a metafield
// and is assigned to products from the admin. Adding a new design = new JSON + images.
//
// One template = one design (pet illustration + name + greeting) that can be shown on several products.
// The AI illustration is generated once and reused on every product (no extra cost per product).
import { backgroundStars, backgroundSnow, backgroundBlush, backgroundPlain } from './assets';

const examples = `${import.meta.env.BASE_URL}examples/`;

export type MockupKind = 'mug' | 'pillow' | 'tshirt';

export interface ProductDef {
  id: string;
  label: string;
  mockup: MockupKind;
  /** Print file in px. `sides` equal faces side by side; the same design is printed on each face. */
  print: { width: number; height: number; dpi: number };
  sides: number;
  /** Full-bleed background pattern (mug, pillow) or none (t-shirt: transparent print on fabric). */
  background: boolean;
  /** Garment colors (t-shirt). */
  colors?: { id: string; label: string; hex: string }[];
  /** Default position (face px, centre of the design) and scale (design units → face px). */
  design: { x: number; y: number; scale: number };
  /** Fixed greeting text on this product, face px. */
  greeting: { y: number; fontSize: number };
  /** Physical mug for the 3D preview (inches). Only products with this get the 3D view. */
  mug3d?: { circumference: number; height: number };
}

export interface Template {
  id: string;
  name: string;
  products: ProductDef[];
  defaultProduct: string;
  /** `render(w, h, unit)` draws the pattern for a print of w×h px; unit scales the pattern's elements. */
  backgrounds: { id: string; label: string; render: (w: number, h: number, unit?: number) => string; textColor: string }[];
  fonts: string[];
  textColors: string[];
  /** Pet in design units, relative to the design centre: x = centre, y = bottom of pet, h = max height. */
  pet: { x: number; y: number; h: number };
  petName: { default: string; fontSize: number; gap: number };
  greetingDefault: string;
  /** Allowed zoom, relative to each product's default scale. */
  zoom: { min: number; max: number };
  /** AI illustration styles. `id` must match a prompt in worker/src/index.ts. `example` is shown before upload. */
  styles: { id: string; label: string; example: string }[];
  defaultStyle: string;
  /** AI tries per uploaded photo (the worker also enforces per-visitor/day limits). */
  ai: { triesPerPhoto: number };
}

export const christmasPet: Template = {
  id: 'christmas-pet',
  name: 'Christmas pet',
  products: [
    {
      id: 'mug',
      label: 'Mug',
      mockup: 'mug',
      print: { width: 2475, height: 1050, dpi: 300 }, // 11oz wrap, 8.25" × 3.5"
      sides: 2,
      background: true,
      design: { x: 2475 / 4, y: 630, scale: 1 },
      greeting: { y: 105, fontSize: 130 },
      mug3d: { circumference: 10.2, height: 3.8 },
    },
    {
      id: 'pillow',
      label: 'Pillow',
      mockup: 'pillow',
      print: { width: 2700, height: 2700, dpi: 150 }, // 18" × 18" front
      sides: 1,
      background: true,
      design: { x: 1350, y: 1520, scale: 2.4 },
      greeting: { y: 330, fontSize: 300 },
    },
    {
      id: 'tshirt',
      label: 'T-shirt',
      mockup: 'tshirt',
      print: { width: 1800, height: 2400, dpi: 150 }, // 12" × 16" chest print, transparent
      sides: 1,
      background: false,
      colors: [
        { id: 'white', label: 'White', hex: '#f8f7f4' },
        { id: 'cream', label: 'Cream', hex: '#f1e7d3' },
        { id: 'grey', label: 'Heather grey', hex: '#cfcfd1' },
        { id: 'sage', label: 'Sage', hex: '#bccbb4' },
        { id: 'blush', label: 'Blush', hex: '#eed5d0' },
        { id: 'navy', label: 'Navy', hex: '#2f3a52' },
      ],
      design: { x: 900, y: 1300, scale: 2.2 },
      greeting: { y: 120, fontSize: 250 },
    },
  ],
  defaultProduct: 'mug',
  backgrounds: [
    { id: 'stars', label: 'Festive stars', render: backgroundStars, textColor: '#3f3f46' },
    { id: 'snow', label: 'Soft snow', render: backgroundSnow, textColor: '#5f7a96' },
    { id: 'blush', label: 'Blush', render: backgroundBlush, textColor: '#a8646c' },
    { id: 'plain', label: 'Plain white', render: backgroundPlain, textColor: '#3f3f46' },
  ],
  fonts: ['Great Vibes', 'Dancing Script', 'Pacifico', 'Mountains of Christmas', 'Fredoka'],
  textColors: ['#3f3f46', '#a8646c', '#6f8f76', '#5f7a96', '#b8953f', '#ffffff'],
  pet: { x: 0, y: 220, h: 560 },
  petName: { default: 'Luna', fontSize: 96, gap: 0 },
  greetingDefault: 'Vesel božič',
  zoom: { min: 0.3, max: 2.5 },
  styles: [
    { id: 'hat-scarf', label: 'Santa hat + scarf', example: `${examples}example-hat-scarf.webp` },
    { id: 'hat-lights', label: 'Santa hat + lights', example: `${examples}example-hat-lights.webp` },
    { id: 'none', label: 'No accessories', example: `${examples}example-none.webp` },
  ],
  defaultStyle: 'hat-scarf',
  ai: { triesPerPhoto: 10 },
};
