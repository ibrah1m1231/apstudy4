/* ============================================================
   AP Study Hub — Cloudflare Worker

   Serves the site, and answers tutor questions using Cloudflare's
   own AI service.

   There is no API key anywhere in this file, and none in the page.
   The `AI` binding declared in wrangler.jsonc is granted to this
   Worker by the platform itself: Cloudflare knows the request came
   from your Worker, so there is no secret to store, rotate, or leak.
   The browser only ever talks to your own domain.
   ============================================================ */

/* First choice, then a smaller one if the first is busy or unavailable.
   Both are chat models with streaming support. */
const MODELS = [
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.2-3b-instruct"
];

const MAX_CHARS = 24000;    /* whole conversation */
const MAX_TOKENS = 800;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

/* Only this site's own pages may call the tutor. Blocks other sites
   from quietly spending your daily allowance. */
function sameOrigin(req, url) {
  const o = req.headers.get("origin");
  if (!o) return true;                       /* same-origin fetch sends none */
  try { return new URL(o).host === url.host; } catch (e) { return false; }
}

function clean(turns) {
  if (!Array.isArray(turns)) return [];
  let budget = MAX_CHARS;
  const out = [];
  /* keep the most recent turns; they matter most */
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (!t || typeof t.content !== "string") continue;
    const role = t.role === "assistant" ? "assistant" : t.role === "system" ? "system" : "user";
    const content = t.content.slice(0, 8000);
    if (budget - content.length < 0) break;
    budget -= content.length;
    out.unshift({ role, content });
  }
  return out;
}

async function chat(req, env, url) {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!sameOrigin(req, url)) return json({ error: "cross-origin requests are not accepted" }, 403);
  if (!env.AI) return json({ error: "This Worker has no AI binding. Add it to wrangler.jsonc and redeploy." }, 501);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "bad JSON" }, 400); }

  const messages = clean(body.messages);
  if (!messages.length) return json({ error: "no messages" }, 400);
  if (body.system) messages.unshift({ role: "system", content: String(body.system).slice(0, 8000) });

  const stream = body.stream !== false;
  const input = {
    messages,
    max_tokens: Math.min(MAX_TOKENS, body.max_tokens || MAX_TOKENS),
    temperature: body.json ? 0.15 : 0.6,
    stream
  };

  let lastErr = null;
  for (const model of MODELS) {
    try {
      const res = await env.AI.run(model, input);
      if (stream) {
        return new Response(res, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            "x-model": model
          }
        });
      }
      return json({ response: res.response != null ? res.response : res, model });
    } catch (e) {
      lastErr = e;
      /* out of daily allowance, or this model is unavailable — try the next */
    }
  }
  const msg = (lastErr && lastErr.message) || "the AI service did not respond";
  const outOfCredit = /neuron|quota|limit|exceed|billing|capacity/i.test(msg);
  return json({
    error: outOfCredit
      ? "The site's daily AI allowance is used up. It resets at midnight UTC."
      : "The AI service could not answer: " + msg,
    retryable: !outOfCredit
  }, 503);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, ai: !!env.AI, models: MODELS });
    }
    if (url.pathname === "/api/chat") {
      return chat(req, env, url);
    }
    /* everything else is the site itself */
    return env.ASSETS.fetch(req);
  }
};
