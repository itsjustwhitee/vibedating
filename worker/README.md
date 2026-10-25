# vibedating link store (Cloudflare Worker)

Optional. It turns a compact invite link (`#y=…`, a few hundred characters) into a short one (`#i=<id>`, about 45). Without it every page keeps working with the long link.

| Request | Answer |
|---|---|
| `POST /links` with a `text/plain` JSON body `{ "p": "<compact payload>" }` | `{ "ok": true, "id": "<10 characters>" }` |
| `GET /links/<id>` | `{ "ok": true, "p": "<compact payload>" }`, or `404 { "ok": false, "error": "not_found" }` when unknown or expired |

The payload must match `^[A-Za-z0-9_-]{1,8000}$` (otherwise `400 bad_request`). Ids are 10 random base62 characters. Entries expire after `LINK_TTL_DAYS` (default 365). Anonymous writes are limited per client IP (`429 limit`); a request with `Authorization: Bearer <WRITE_SECRET>` (the Apps Script back end, which shares Google's IP addresses with everyone else) skips that limit.

## Setup

Free plan limits: 100,000 requests, 100,000 KV reads and 1,000 KV writes a day. When writes run out, builders fall back to the long link.

1. Create a Cloudflare account and log in with `npx wrangler login` (no global install needed).
2. From this folder create the namespace: `npx wrangler kv namespace create LINKS`.
3. Copy `wrangler.example.toml` to `wrangler.toml` (keep it out of the repo), put the namespace id in it and set `ALLOWED_ORIGINS` to the site's origin (comma separated; unset means `*`).
4. Set the write secret: `openssl rand -base64 32`, then `npx wrangler secret put WRITE_SECRET`.
5. Deploy: `npx wrangler deploy`. The store URL is `https://vibedating-links.<account>.workers.dev/links`.
6. Site: set the repository variable `SITE_LINKS` to the store URL; the Pages workflow writes it into the `vibedating-links` meta of both pages.
7. Multi-user back end (optional): in the Apps Script Script Properties set `LINKS_URL` to the store URL and `LINKS_SECRET` to the write secret, then re-authorise the script once (it now asks to connect to external services).

## Privacy

Stored payloads are not encrypted: anyone with an id can read the invite, exactly like anyone with the long link. Ids are random and not guessable, and entries expire.

## Tests

`npm test` runs `src/index.js` in Node with an in-memory KV (`dev/memory-kv.js`); `npm run dev` mounts the same handler at `/links`.
