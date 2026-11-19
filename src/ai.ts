// Client for the AI illustration worker (worker/). The worker holds the API key, the prompts and the limits;
// the browser only sends the pet cut-out and which accessory set was chosen.

const ENDPOINT = (import.meta.env.VITE_AI_ENDPOINT ?? '').replace(/\/$/, '');
export const aiEnabled = ENDPOINT.length > 0;

export class AiError extends Error {
  code: string;
  remaining?: number;
  constructor(code: string, remaining?: number) {
    super(code);
    this.code = code;
    this.remaining = remaining;
  }
}

const MESSAGES: Record<string, string> = {
  daily_limit: "You've used today's illustrations. Please try again tomorrow.",
  busy: 'Our illustrator is very busy today. Please try again later.',
  upstream_busy: 'The AI is very busy right now. Please try again in a minute. This did not use up a try.',
  no_image: "The AI couldn't draw this photo. Try again or use a different photo.",
  timeout: 'This took too long. Please try again.',
  network: 'Could not reach the illustration service. Check your connection and try again.',
  not_configured: 'Illustrations are not set up yet.',
  origin_not_allowed: 'Illustrations are not enabled for this website.',
};
export const aiErrorMessage = (e: unknown) =>
  MESSAGES[e instanceof AiError ? e.code : 'network'] ?? 'Something went wrong. Please try again.';

/** Pet cut-out on white, max 1024 px, as base64 JPEG (small upload, and 1K is all we need for print). */
function toInput(cutout: HTMLCanvasElement): string {
  const MAX = 1024;
  const pad = 0.08;
  const s = Math.min(1, (MAX * (1 - 2 * pad)) / Math.max(cutout.width, cutout.height));
  const w = Math.round(cutout.width * s);
  const h = Math.round(cutout.height * s);
  const c = document.createElement('canvas');
  c.width = Math.round(w / (1 - 2 * pad));
  c.height = Math.round(h / (1 - 2 * pad));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(cutout, (c.width - w) / 2, (c.height - h) / 2, w, h);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}

export async function illustrate(cutout: HTMLCanvasElement, accessory: string): Promise<{ blob: Blob; remaining: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessory, image: toInput(cutout), mime: 'image/jpeg' }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new AiError((e as Error).name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => ({}))) as { image?: string; mime?: string; error?: string; remaining?: number };
  if (!res.ok || !body.image) throw new AiError(body.error ?? `http_${res.status}`, body.remaining);
  const bytes = Uint8Array.from(atob(body.image), (ch) => ch.charCodeAt(0));
  return { blob: new Blob([bytes], { type: body.mime ?? 'image/png' }), remaining: body.remaining ?? 0 };
}
