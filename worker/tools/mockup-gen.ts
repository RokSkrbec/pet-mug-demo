// DEV TOOL — never deployed. Generates product base photos for the mockups with the worker's own key.
// Run: npx wrangler dev --remote -c tools/wrangler.tools.toml   then POST a prompt to /.
export default {
  async fetch(req: Request, env: { GEMINI_API_KEY: string; GEMINI_MODEL: string }) {
    if (req.method !== 'POST') return new Response('POST a prompt', { status: 405 });
    const { prompt, aspect = '1:1' } = (await req.json()) as { prompt: string; aspect?: string };
    for (const model of [env.GEMINI_MODEL, 'gemini-3.1-flash-image']) {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          model,
          input: [{ type: 'text', text: prompt }],
          response_format: { type: 'image', image_size: '2K', aspect_ratio: aspect, mime_type: 'image/jpeg' },
        }),
      });
      const text = await res.text();
      if (res.status === 503 || res.status === 429) continue;
      if (!res.ok) return new Response(text, { status: res.status });
      const m = text.match(/"data"\s*:\s*"([A-Za-z0-9+/=]{1000,})"/);
      if (!m) return new Response('no image: ' + text.slice(0, 500), { status: 502 });
      return new Response(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)), { headers: { 'Content-Type': 'image/jpeg', 'X-Model': model } });
    }
    return new Response('busy', { status: 503 });
  },
};
