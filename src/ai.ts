// Client for the AI illustration worker (worker/). The worker holds the API key, the prompts and the limits;
// the browser only sends the photo and which style was chosen.
import { photoToJpegBase64 } from './petPhoto';

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

/** Send the customer's photo + chosen style id; returns the illustration (white background). */
export async function illustrate(photo: Blob, style: string): Promise<{ blob: Blob; remaining: number }> {
  const image = await photoToJpegBase64(photo, 1024);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessory: style, image, mime: 'image/jpeg' }),
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
