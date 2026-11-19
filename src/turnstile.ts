// Cloudflare Turnstile (free, privacy-friendly captcha). Invisible for almost everyone: the browser solves a
// background challenge and gets a one-time token that the worker verifies. Only suspicious visitors see a
// checkbox (in `container`). Off when no site key is configured.

const SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY ?? '';
export const turnstileEnabled = SITEKEY.length > 0;

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
    onTurnstileLoad?: () => void;
  }
}

let api: Promise<TurnstileApi> | undefined;
function load(): Promise<TurnstileApi> {
  api ??= new Promise((resolve, reject) => {
    window.onTurnstileLoad = () => resolve(window.turnstile!);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
    s.async = true;
    s.onerror = () => {
      api = undefined; // allow a retry later
      reject(new Error('turnstile_load'));
    };
    document.head.appendChild(s);
  });
  return api;
}

/** Start loading the script early (e.g. on page load) so the first request isn't slowed down. */
export const preloadTurnstile = () => turnstileEnabled && load().catch(() => undefined);

/** Get a fresh one-time token (undefined when Turnstile is off). Throws 'bot_check' if it can't be solved. */
export async function turnstileToken(container: HTMLElement): Promise<string | undefined> {
  if (!turnstileEnabled) return undefined;
  const ts = await load().catch(() => {
    throw new Error('bot_check');
  });
  return new Promise((resolve, reject) => {
    let id = '';
    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
      setTimeout(() => id && ts.remove(id)); // a token is single-use: new widget per request
    };
    // Generous: an interactive challenge needs a human click.
    const timer = setTimeout(() => done(() => reject(new Error('bot_check'))), 90_000);
    id = ts.render(container, {
      sitekey: SITEKEY,
      appearance: 'interaction-only',
      action: 'paint',
      callback: (token: string) => done(() => resolve(token)),
      'error-callback': () => done(() => reject(new Error('bot_check'))),
      'unsupported-callback': () => done(() => reject(new Error('bot_check'))),
    });
  });
}
