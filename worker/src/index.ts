// Cloudflare Worker: tiny proxy between the customizer and Google's Nano Banana (Gemini image) API.
//
// Why it exists:
//  - keeps the Gemini API key secret (GitHub Pages can't hide secrets)
//  - enforces limits so nobody can run up the bill:
//      * only allowed websites (CORS origin allowlist)
//      * per-visitor daily limit (by IP)          -> PER_IP_DAILY
//      * global daily limit across all visitors   -> GLOBAL_DAILY (hard budget cap)
//      * input size/type validation, output fixed at 1K
//  - prompts live HERE, the browser only sends an accessory id, so the endpoint
//    can't be abused as a general-purpose image generator.

export interface Env {
  LIMITS: KVNamespace;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  /** Used when GEMINI_MODEL is overloaded. Empty = no fallback. */
  GEMINI_FALLBACK_MODEL?: string;
  ALLOWED_ORIGINS: string;
  PER_IP_DAILY: string;
  GLOBAL_DAILY: string;
  /** "1" = don't call Google, return the input image (for testing without a key / without cost). */
  MOCK?: string;
}

const STYLE =
  'Turn the animal in this photo into a soft, hand-painted watercolor illustration in gentle pastel colors, ' +
  'like a cute Christmas greeting card. Keep the exact same animal: same breed, fur colors, markings, eye color, ' +
  'ear shape and pose, so the owner instantly recognizes their own pet. Show only the animal, complete and not cropped. ' +
  // Green screen: the browser keys it out (src/chromaKey.ts). White would eat into white fur.
  'Place it on a perfectly flat, solid pure green background (#00FF00), like a chroma-key green screen: one uniform ' +
  'color from edge to edge, with no gradient, no texture, no paper grain, no vignette, no shadow, no ground and no ' +
  'scenery. Paint the animal with clean edges against the green. Do not use this bright green anywhere on the animal ' +
  'or its accessories, and do not let green light reflect onto the fur. No text and no frame.';

const ACCESSORIES: Record<string, string> = {
  none: '',
  'hat-scarf':
    'Give the animal a red Santa hat that sits naturally on its head, fitted around the ears, and a cozy knitted scarf ' +
    'with soft red, sage-green and cream stripes wrapped around its neck.',
  'hat-lights':
    'Give the animal a red Santa hat that sits naturally on its head, fitted around the ears, and wrap a string of small ' +
    'pastel-colored Christmas lights loosely around its body.',
};

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const MIME_OK = new Set(['image/png', 'image/jpeg', 'image/webp']);

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const ok = origin && allowed.some((a) => a === origin || (a.endsWith(':*') && origin.startsWith(a.slice(0, -1))));
  return ok
    ? {
        'Access-Control-Allow-Origin': origin!,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : {};
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/** Find the first generated image anywhere in the Interactions API response. */
function findImage(node: unknown): { data: string; mime: string } | null {
  if (!node || typeof node !== 'object') return null;
  const o = node as Record<string, unknown>;
  if (typeof o.data === 'string' && (o.type === 'image' || String(o.mime_type ?? o.mimeType ?? '').startsWith('image/'))) {
    return { data: o.data, mime: String(o.mime_type ?? o.mimeType ?? 'image/png') };
  }
  for (const v of Object.values(o)) {
    const found = Array.isArray(v) ? v.map(findImage).find(Boolean) : findImage(v);
    if (found) return found;
  }
  return null;
}

/** Google overloaded / rate limited / hiccup: worth retrying, and not the customer's fault. */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

async function callNanoBanana(env: Env, prompt: string, image: string, mime: string) {
  // Main model: up to 2 attempts, then the fallback model: up to 2 attempts.
  const plan = [
    { model: env.GEMINI_MODEL, delay: 0 },
    { model: env.GEMINI_MODEL, delay: 2500 },
    ...(env.GEMINI_FALLBACK_MODEL
      ? [
          { model: env.GEMINI_FALLBACK_MODEL, delay: 0 },
          { model: env.GEMINI_FALLBACK_MODEL, delay: 3000 },
        ]
      : []),
  ];
  let lastStatus = 0;
  for (const { model, delay } of plan) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      return await callOnce(env, model, prompt, image, mime);
    } catch (err) {
      lastStatus = err instanceof UpstreamError ? err.status : 0;
      if (!TRANSIENT.has(lastStatus)) throw err;
    }
  }
  throw new UpstreamError(lastStatus);
}

class UpstreamError extends Error {
  status: number;
  constructor(status: number) {
    super(TRANSIENT.has(status) ? 'upstream_busy' : `upstream_${status}`);
    this.status = status;
  }
}

async function callOnce(env: Env, model: string, prompt: string, image: string, mime: string) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! },
    body: JSON.stringify({
      model,
      input: [
        { type: 'text', text: prompt },
        { type: 'image', mime_type: mime, data: image },
      ],
      // Nano Banana 2.1 only returns JPEG; the browser keys out the green background afterwards.
      response_format: { type: 'image', image_size: '1K', mime_type: 'image/jpeg' },
    }),
  });
  const body = await res.json<unknown>().catch(() => null);
  if (!res.ok) {
    console.error('Gemini error', model, res.status, JSON.stringify(body).slice(0, 2000));
    throw new UpstreamError(res.status);
  }
  const img = findImage(body);
  if (!img) {
    console.error('Gemini returned no image', JSON.stringify(body).slice(0, 2000));
    throw new Error('no_image');
  }
  return img;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin');
    const cors = corsHeaders(origin, env);
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
    if (url.pathname !== '/generate' || req.method !== 'POST') return json({ error: 'not_found' }, 404, cors);
    if (!cors['Access-Control-Allow-Origin']) return json({ error: 'origin_not_allowed' }, 403, cors);

    // ---- validate input ----
    let payload: { accessory?: string; image?: string; mime?: string };
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'bad_json' }, 400, cors);
    }
    const { accessory = 'none', image, mime = 'image/jpeg' } = payload;
    if (!(accessory in ACCESSORIES)) return json({ error: 'bad_accessory' }, 400, cors);
    if (!MIME_OK.has(mime)) return json({ error: 'bad_mime' }, 400, cors);
    if (typeof image !== 'string' || !image.length || (image.length * 3) / 4 > MAX_IMAGE_BYTES) return json({ error: 'bad_image' }, 400, cors);

    // ---- limits (KV counters, reset daily at 00:00 UTC) ----
    const day = new Date().toISOString().slice(0, 10);
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const ipKey = `ip:${day}:${ip}`;
    const globalKey = `global:${day}`;
    const perIp = Number(env.PER_IP_DAILY);
    const global = Number(env.GLOBAL_DAILY);
    const [ipCount, globalCount] = await Promise.all([env.LIMITS.get(ipKey), env.LIMITS.get(globalKey)]).then((v) => v.map((x) => Number(x ?? 0)));
    if (ipCount >= perIp) return json({ error: 'daily_limit', remaining: 0 }, 429, cors);
    if (globalCount >= global) return json({ error: 'busy' }, 429, cors);
    // Count the attempt up-front (a failed upstream call still costs a try; keeps abuse bounded).
    const ttl = { expirationTtl: 60 * 60 * 48 };
    await Promise.all([env.LIMITS.put(ipKey, String(ipCount + 1), ttl), env.LIMITS.put(globalKey, String(globalCount + 1), ttl)]);
    const remaining = perIp - ipCount - 1;

    // ---- generate ----
    try {
      if (env.MOCK === '1') {
        await new Promise((r) => setTimeout(r, 1200));
        return json({ image, mime, remaining, mock: true }, 200, cors);
      }
      if (!env.GEMINI_API_KEY) return json({ error: 'not_configured' }, 500, cors);
      const prompt = `${STYLE} ${ACCESSORIES[accessory]}`.trim();
      const out = await callNanoBanana(env, prompt, image, mime);
      return json({ image: out.data, mime: out.mime, remaining }, 200, cors);
    } catch (err) {
      // Google was overloaded: give the try back so the customer isn't charged for it.
      if (err instanceof UpstreamError && TRANSIENT.has(err.status)) {
        await Promise.all([env.LIMITS.put(ipKey, String(ipCount), ttl), env.LIMITS.put(globalKey, String(globalCount), ttl)]);
        return json({ error: 'upstream_busy', remaining: remaining + 1 }, 503, cors);
      }
      return json({ error: err instanceof Error ? err.message : 'failed', remaining }, 502, cors);
    }
  },
} satisfies ExportedHandler<Env>;
