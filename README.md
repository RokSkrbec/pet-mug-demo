# Pet mug customizer (demo)

Teeinblue-style product personalizer. Runs entirely in the browser, so it costs $0 per customer.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static files in dist/ → deploy to Cloudflare Pages / Vercel
```

## How it works

| File | What it does |
|---|---|
| `src/template.ts` | Template = pure data (print size, backgrounds, pet slots, accessories, fonts). New design = new template. |
| `src/assets.ts` | Placeholder artwork generated as SVG. Replace with designer PNG/SVG URLs. |
| `src/petPhoto.ts` | Downscale → in-browser background removal (`@imgly/background-removal`, ~40 MB model cached after first use) → trim → head/neck/body detection for auto-placing accessories. |
| `src/customizer.ts` | `mountCustomizer(el, template, { onAddToCart })`: the embeddable widget. The print is split into `sides` faces (2 on a mug) with the same design on each; the design (pets + accessories + names) is one unit edited directly on the mug mockup: drag, corner handles, rotate handle, mouse wheel / pinch zoom, arrow keys, toolbar, mirror, start over. |
| `src/mugMockup.ts` | 2D ceramic mug drawn with Konva shapes (body, rim, handle, matte shading). |
| `src/mug3d.ts` | Three.js mug; the print canvas is wrapped around it as a texture. |

Output: a 2475×1050 px (8.25"×3.5" @ 300 DPI) PNG print file, an 800 px JPEG preview and an options object.

## Shopify custom app (next phase)

1. **App**: Shopify CLI Remix template, hosted cheaply (Fly.io / Render / Cloudflare), DB = SQLite/Postgres for templates.
2. **Theme app extension** (app embed block) loads this same bundle on product pages that have a template assigned (product metafield `personalizer.template_id`).
3. **Add to cart**: upload `printBlob` + preview to storage (Cloudflare R2 / Shopify Files via app proxy) → `POST /cart/add.js` with line item properties: visible options + hidden `_preview_url`, `_print_file_url`.
4. **orders/create webhook** → attach print files to the order / send to the print partner.
5. **Admin UI** to upload artwork and edit templates; assign templates to products.
6. Optional paid upgrade: AI "cartoon/painted" style via Replicate/fal.ai through a serverless proxy, charged as a product add-on.
