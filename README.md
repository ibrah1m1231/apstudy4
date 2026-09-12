# AP Study Hub — Cloudflare deployment

This is the fast version. The tutor is answered by Cloudflare's own AI service,
so there is **nothing to download in the browser** and answers take about a second
on any device, phone included.

## There is no API key

Not in the page, not in this repo, not in an environment variable. The `ai` binding
in `wrangler.jsonc` is the credential — Cloudflare authorises your Worker itself.
There is nothing to store, rotate, or leak.

## Deploy

```
npx wrangler deploy
```

That's it. `wrangler.jsonc` already declares both bindings:

- `ai` → the AI service, available in the Worker as `env.AI`
- `assets` → `./public`, which holds `index.html` (the whole site is one file)

If you deploy from the Cloudflare dashboard's Git integration instead, set:

- **Deploy command:** `npx wrangler deploy`
- **Build command:** leave empty

## What the Worker does

| Route | Behaviour |
|---|---|
| `GET /api/health` | Tells the page the tutor is available. The page probes this once on load. |
| `POST /api/chat` | Streams an answer back as Server-Sent Events. |
| everything else | Served from `./public`. |

Requests from other websites are rejected, so nobody else can spend your allowance.

## Cost

Cloudflare gives **10,000 neurons per day free**, which is a few thousand tutor
answers. Past that the endpoint returns a clear "daily allowance used up" message
and the site keeps working on its notes lookup — it never breaks. Beyond the free
tier it is $0.011 per 1,000 neurons on a Workers Paid plan.

Models used, in order (the second is a fallback if the first is busy):

1. `@cf/meta/llama-3.1-8b-instruct-fast`
2. `@cf/meta/llama-3.2-3b-instruct`

## Updating the site

Rebuild or drop in a new `index.html` under `public/`, then `npx wrangler deploy`
again. Nothing else changes.

## If you also host on GitHub Pages

That copy has no Worker, so `/api/health` 404s and the page quietly falls back to
its offline paths. Same file, no configuration needed.
