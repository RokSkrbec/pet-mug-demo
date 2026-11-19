# Pet gift customizer (demo)

Teeinblue-style product personalizer. Runs entirely in the browser, so it costs $0 per customer.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static files in dist/ → deploy to Cloudflare Pages / Vercel
```

## How it works

1. Before upload the mug shows an **example illustration** for the selected style (`public/examples/`).
2. When the customer uploads a photo, it goes (downscaled) to the AI worker, which returns a **watercolor
   illustration with the chosen accessories painted in**. The raw photo is never placed on the mug.
3. The browser removes the illustration's white background (free, in-browser) and places it on the mug.
4. Switching style paints that style once; already painted styles are cached, so switching back is free.

| File | What it does |
|---|---|
| `src/template.ts` | Template = pure data (print size, backgrounds, styles + example images, fonts, limits). |
| `src/assets.ts` | Background patterns generated as SVG. |
| `src/petPhoto.ts` | Photo downscale for upload; in-browser background removal (`@imgly/background-removal`) + trim. |
| `src/ai.ts` | Client for the AI worker. |
| `src/customizer.ts` | `mountCustomizer(el, template, { onAddToCart })`: the embeddable widget. One pet, product switcher. A print has `sides` faces (2 on a mug) with the same design on each; the design (pet + name) is one unit edited directly on the product mockup: drag, handles, wheel/pinch zoom, arrow keys, toolbar, mirror, start over. |
| `src/photoMockup.ts` | Photo-realistic preview: warps the print onto a real product photo and multiplies it with the photo's shading. |
| `src/mug3d.ts` | Three.js mug; the print canvas is wrapped around it as a texture. |

## Realistic preview

Each product has a photo of the blank white product (`public/mockups/*.jpg`) and a cut-out mask
(`*-mask.webp`). The flat print is warped onto the product with a triangle mesh (cylinder for the mug,
a pinched Coons patch for the pillow, a rectangle for the t-shirt), multiplied with the photo's own
shading so light, curvature, fabric texture and folds show through, and clipped to the mask. T-shirt
colours are applied the same way (colour × shading). The editable flat print stays underneath the
preview for dragging; the print files are unaffected. Geometry per photo lives in `template.products[].photo`.

The photos were generated once with Nano Banana (~$0.04 each) using the dev-only tool in
`worker/tools/` (`npx wrangler dev --remote -c tools/wrangler.tools.toml`, uses the worker's key, never
deployed). Replace them with real supplier photos any time: update the photo, mask and geometry.

## Products

The same illustration, name and text appear on every product; switching products never calls the AI again.
Each product has its own print file, mockup and design position (`template.products`):

| Product | Print file | Notes |
|---|---|---|
| Mug | 2475×1050 px (8.25"×3.5" @ 300 DPI) | 2 sides with the same design, background pattern, 3D view |
| Pillow | 2700×2700 px (18"×18" @ 150 DPI) | background pattern |
| T-shirt | 1800×2400 px (12"×16" @ 150 DPI) | transparent PNG, shirt colour choice, dashed print area while editing |

The AI illustration is 1K, so higher DPI on fabric would not add detail. Output per product: print PNG,
800 px JPEG preview and an options object (product, style, background or shirt colour, texts…).
Export is only possible with the customer's own illustration (never the example).

## AI illustration (Nano Banana)

The AI step turns the pet photo into a pastel watercolor with the chosen accessories painted in,
using Google's Nano Banana 2.1 (`gemini-nano-banana-2.1`). The browser never sees the API key: requests go
through a tiny Cloudflare Worker in [`worker/`](worker/) that holds the key and the prompts and enforces the limits.

| Limit | Where | Default |
|---|---|---|
| Paint on upload / style switch only, cached per style, max tries per photo | browser | 10 (`template.ai.triesPerPhoto`) |
| Per visitor (IP) per day | worker, KV counter | 10 (`PER_IP_DAILY`) |
| All visitors per day (budget cap) | worker, KV counter | 200 (`GLOBAL_DAILY`) |
| Allowed websites | worker, CORS | `ALLOWED_ORIGINS` |
| Fixed prompts (browser only sends an accessory id), input ≤ 2.5 MB, output 1K | worker | – |

Counters reset at 00:00 UTC. KV is eventually consistent, so limits are approximate (fine as a budget guard).

**Local test without a key:** `cd worker && npm run dev -- --var MOCK:1` (returns the input image, costs nothing).
**Local test with a key:** put `GEMINI_API_KEY=...` in `worker/.dev.vars` (git-ignored), then `npm run dev`.

**Deploy:**
```bash
cd worker
npx wrangler login                       # opens browser, free Cloudflare account
npx wrangler kv namespace create LIMITS  # paste the id into wrangler.toml
npx wrangler secret put GEMINI_API_KEY   # paste the key when prompted (never commit it)
npx wrangler deploy                      # prints https://pet-mug-ai.<subdomain>.workers.dev
gh variable set AI_ENDPOINT --body "https://pet-mug-ai.<subdomain>.workers.dev"
```
Then push to `main` (or re-run the Pages workflow) so the site is rebuilt with the AI button.

## Shopify custom app (next phase)

1. **App**: Shopify CLI Remix template, hosted cheaply (Fly.io / Render / Cloudflare), DB = SQLite/Postgres for templates.
2. **Theme app extension** (app embed block) loads this same bundle on product pages that have a template assigned (product metafield `personalizer.template_id`).
3. **Add to cart**: upload `printBlob` + preview to storage (Cloudflare R2 / Shopify Files via app proxy) → `POST /cart/add.js` with line item properties: visible options + hidden `_preview_url`, `_print_file_url`.
4. **orders/create webhook** → attach print files to the order / send to the print partner.
5. **Admin UI** to upload artwork and edit templates; assign templates to products.
6. Optional paid upgrade: AI "cartoon/painted" style via Replicate/fal.ai through a serverless proxy, charged as a product add-on.
