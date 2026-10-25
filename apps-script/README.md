# vibedating back end (Google Apps Script)

One web app, two modes:

- **Personal**: the invite link carries a shared key `k`. When the guest accepts, the script creates an event in the deployer's default calendar and invites the guest.
- **Multi-user**: anyone can build an invite with `create.html`. The script signs the config and emails the share link to the owner (never to the browser). When the guest accepts, the owner gets an email with the choice, a Google Calendar link and an `.ics` attachment. Nothing is written to the deployer's calendar.

Without an `api` field in the config the invite page works client-side only (calendar link and `.ics`, no email).

## Setup

1. Go to <https://script.google.com>, create a new project (or `clasp create --type webapp` and `clasp push` from this folder).
2. Replace the default file with `Code.gs`. In *Project Settings* enable "Show appsscript.json manifest file" and paste `appsscript.json`.
3. In *Project Settings -> Script Properties* add the properties you need (below).
4. *Deploy -> New deployment -> Web app*: Execute as **Me**, Who has access **Anyone**. Authorise the requested scopes (Calendar, send email, connect to external services). The last one is used only to shorten emailed links through the optional link store; a deployment made before it was added must be re-authorised once (run any function from the editor, or open the web app as the owner).
5. Copy the web app URL (`https://script.google.com/macros/s/.../exec`). Opening it should return `{"ok":true,"service":"vibedating"}`.

To update the code **keep the URL**: *Deploy -> Manage deployments -> edit (pencil) -> Version: New version -> Deploy*. A new deployment gets a new URL and breaks every link already shared.

## Script Properties

| Property | Mode | Default | Meaning |
|---|---|---|---|
| `SHARED_KEY` | personal (required) | - | Long random secret, also put in the link as `k` |
| `ALLOWED_GUESTS` | personal (required) | - | Comma-separated guest emails (case-insensitive) |
| `OWNER_EMAIL` | personal | - | Also invited to every personal event (useful when the script runs on a separate account) |
| `SENDER_NAME` | both | Vibe Dating | Display name of the emails |
| `DAILY_LIMIT` | personal | 20 | Personal accepts per day, whole script |
| `SIGNING_SECRET` | multi (required) | - | Long random secret for the link signature |
| `SITE_URL` | multi (required) | - | `https://` URL of the invite page, e.g. `https://example.com/vibedating/` |
| `MULTI_DAILY_LIMIT` | multi | 30 | Multi-user accepts per day, whole script |
| `CREATE_DAILY_LIMIT` | multi | 30 | Links created per day, whole script |
| `OWNER_DAILY_LIMIT` | multi | 3 | Links created per owner per day |
| `OWNER_ACCEPT_LIMIT` | multi | 10 | Accepts mailed per owner per day |
| `LINK_DAYS` | multi | 60 | Days a signed link stays valid |
| `LINKS_URL` | multi | - | Link store URL ending in `/links` (see [worker/README.md](../worker/README.md)); with `LINKS_SECRET` the emailed link becomes a short `#i=` one |
| `LINKS_SECRET` | multi | - | The store's `WRITE_SECRET`, sent as a bearer token so the store's per-IP limit does not apply |

A mode whose required properties are missing answers `not_configured`. Generate secrets with e.g. `openssl rand -base64 32`. Secrets live only in Script Properties, never in the site or the repo.

Daily caps (each has its own counter, so strangers using multi-user links cannot exhaust the personal one):

| Counter | Limit | Applies to |
|---|---|---|
| `accept:personal` | `DAILY_LIMIT` | personal accepts |
| `accept:multi` | `MULTI_DAILY_LIMIT` | multi-user accepts |
| `accept:<owner>` | `OWNER_ACCEPT_LIMIT` | multi-user accepts per owner |
| `create` | `CREATE_DAILY_LIMIT` | links created |
| `create:<owner>` | `OWNER_DAILY_LIMIT` | links created per owner (email trimmed, lower-cased) |

Counters are stored as `count:<scope>:<yyyy-MM-dd>` properties (script time zone) and pruned after three days.

## Personal link

Build the invite config with your web app URL as `api` and the `SHARED_KEY` value as `k`, for example:

```json
{ "v": 1, "to": "Alex", "from": "Sam", "places": [{ "name": "Trattoria Example", "address": "Main St 1" }],
  "slots": ["20:00", "20:30"], "tz": "Europe/Rome",
  "api": "https://script.google.com/macros/s/.../exec", "k": "<SHARED_KEY>" }
```

Use `create.html` (personal mode) or encode it yourself as base64url of the UTF-8 JSON and share `https://example.com/vibedating/#c=<encoded>` (the builder produces the much shorter compact form `#y=`, or `#i=` with a link store). The accept payload is `{ action, id, k, guest, place: {name, address}, date, time, duration, tz, lang, to, from, note }`; the event title is "Cena con <from>" / "Dinner with <from>" (or "Cena insieme" / "Dinner together" without `from`). Add the guest's email to `ALLOWED_GUESTS`, otherwise the accept is refused (the page still offers the calendar fallback).

## API

`POST` with a `text/plain` JSON body; every answer is JSON `{ "ok": true }` or `{ "ok": false, "error": "<code>" }`. Every request carries an `id` (letters, digits, `-`, `_`, up to 64): a repeated id within 6 hours answers `{ "ok": true, "duplicate": true }` without side effects.

Past start times are refused with `bad_time`. `create` accepts only what the invite page's validator accepts (unknown keys are refused), canonicalises `tz`, spells out the defaults (`lang`, `duration`, `days`, `tz`) and drops `api`: the emailed link relies on the site's own back-end meta. The link uses the compact `#y=` form (the same positional array as `js/config.js`, raw deflate taken from `Utilities.gzip` by stripping the gzip header and trailer); the signature covers the expanded config, which is exactly what the invite page decodes. With `LINKS_URL` and `LINKS_SECRET` set, the script stores the payload and emails the short `#i=` link instead; if the store fails, it logs the error and emails the `#y=` link.

Error codes: `bad_request`, `bad_key`, `guest_not_allowed`, `bad_email`, `bad_date`, `bad_time`, `bad_place`, `bad_signature`, `expired`, `limit`, `not_configured`, `server`.

## Quotas and recommendations

- Consumer Google accounts can email about **100 recipients per day** from Apps Script (Workspace accounts more); calendar invites count too. Keep the limits above well under that.
- For a public multi-user deployment use a **dedicated Google account**, not your personal one: emails come from it and its quota is shared by all users.
- Errors are logged to the Apps Script executions log; the client only sees the error code.

## Tests

`npm test` runs `Code.gs` in Node against fake Google services (`dev/gas-emulator.js`, including `UrlFetchApp` and a gzip with a file name in its header).
