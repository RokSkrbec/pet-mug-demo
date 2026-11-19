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

## AI illustration (Nano Banana)

"✨ Make illustration" turns the pet into a pastel watercolor with the chosen accessories painted in,
using Google's Nano Banana 2.1 (`gemini-nano-banana-2.1`). The browser never sees the API key: requests go
through a tiny Cloudflare Worker in [`worker/`](worker/) that holds the key and the prompts and enforces the limits.

| Limit | Where | Default |
|---|---|---|
| Only on button press, max tries per uploaded photo | browser | 3 (`template.ai.triesPerPet`) |
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
