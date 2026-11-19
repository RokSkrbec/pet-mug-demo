// A template is pure data. In the Shopify app this JSON lives in the DB / a metafield
// and is assigned to products from the admin. Adding a new design = new JSON + images.
import { backgroundStars, backgroundSnow, backgroundBlush, backgroundPlain, santaHat, scarf, lights } from './assets';

export type AccessoryKind = 'hat' | 'scarf' | 'lights';

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
  /** Soft pastel treatment applied to the cut-out pet photo. */
  photoFilter: 'soft' | 'none';
  maxPets: number;
  /** Where the movable design sits by default, in face px (centre point) and its default scale. */
  design: { x: number; y: number; scale: number; minScale: number; maxScale: number };
  /** Pet slots relative to the design centre: x = centre, y = bottom of pet, h = max pet height. */
  petLayouts: Record<number, { x: number; y: number; h: number }[]>;
  accessoryOptions: { id: string; label: string; items: AccessoryKind[] }[];
  accessoryArt: Record<AccessoryKind, string>;
  /** Fixed greeting text (not movable), face px. */
  greeting: { default: string; x: number; y: number; fontSize: number };
  petName: { fontSize: number; gap: number };
  /** AI illustration: tries per uploaded pet photo (the worker also enforces per-visitor/day limits). */
  ai: { triesPerPet: number };
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
  photoFilter: 'soft',
  maxPets: 3,
  design: { x: FW / 2, y: H * 0.6, scale: 1, minScale: 0.3, maxScale: 2.5 },
  petLayouts: {
    1: [{ x: 0, y: 220, h: 540 }],
    2: [
      { x: -250, y: 220, h: 480 },
      { x: 250, y: 220, h: 480 },
    ],
    3: [
      { x: -350, y: 220, h: 410 },
      { x: 0, y: 220, h: 430 },
      { x: 350, y: 220, h: 410 },
    ],
  },
  accessoryOptions: [
    { id: 'none', label: 'No accessories', items: [] },
    { id: 'hat-scarf', label: 'Santa hat + scarf', items: ['hat', 'scarf'] },
    { id: 'hat-lights', label: 'Santa hat + lights', items: ['hat', 'lights'] },
  ],
  accessoryArt: { hat: santaHat, scarf, lights },
  greeting: { default: 'Vesel božič', x: FW / 2, y: 105, fontSize: 130 },
  petName: { fontSize: 96, gap: 0 },
  ai: { triesPerPet: 3 },
};
