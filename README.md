# vibedating

A small static site that asks one person out to dinner. The invite opens with a question (the "No" button runs away), then lets the guest pick a place, a day and a time slot, and ends with a celebration plus "Add to Google Calendar" and `.ics` buttons. Italian by default, English available.

**100% vibe-coded, just for fun.**

No build step, no framework: plain HTML, CSS and ES modules. It can be hosted on any static host (GitHub Pages works well).

## Run locally

```sh
npm install        # only needed for the tests
npm run serve      # http://localhost:8080
```

- `index.html` is the invite. Without a link fragment it shows a short landing page with a demo.
- `create.html` is the link builder.

Tests: `npm test` (unit tests for the pure modules, the Apps Script code and the link store Worker) and `npm run e2e` (Playwright, desktop and mobile emulation, back end mocked).

## Making a link

Open `create.html` and follow the five numbered steps: who it is for, where (places with emoji, note, address, Maps link; typing a name or an address suggests matching places, and picking one fills the address, the Maps link and an empty name, and the emoji button opens a small picker), when (time slots; duration, bookable days and time zone sit under "Altre opzioni"), how the answer reaches you, and create. The question, the message after the yes and the invite language are under "Personalizza i testi". Copy the link, share it, or open it to try it.

The whole invite is stored in the link fragment. Every text is configurable: `to`, `from`, `q` (question), `done` (message after the yes), `lang` (`it` or `en`). Both pages have an IT/EN switch for the viewer, remembered in local storage. When the site has a back end configured, its URL is not written into the link: the page reads it from its own meta tag.

| Fragment | Content |
|---|---|
| `#y=…` | Compact form, written by the builder and the back end: base64url of raw deflate of a positional JSON array (defaults and derived Maps links left out) |
| `#i=<id>` | Short link: the `#y=` payload kept by the optional link store ([worker/](worker/README.md)), about 45 characters |
| `#z=…` | Older gzip JSON links, still read |
| `#c=…` | Plain base64url JSON, still read (also written when the browser lacks `CompressionStream`) |

On the demo invite (three places with notes, on a 31 character site URL) the link is 285 characters with `#y=` and 44 with `#i=`, against 380 with the older `#z=`.

## Delivery modes

| Mode | What happens when the guest says yes | Needs |
|---|---|---|
| Solo link | Nothing is sent: the guest saves the date with the calendar buttons. | Nothing |
| Avvisami per email (multi-user) | The site's Apps Script emails you a signed link; when the guest accepts, you get an email with the details and an `.ics`. | The site's back end (see below) and your email |
| Personal | Your Apps Script creates an event in your Google Calendar and invites the guest. | Your own deployment and its shared key, under "Avanzate" (shown only with `create.html?advanced`) |

The builder learns the site's back end from `<meta name="vibedating-api" content="">` in `create.html` (the invite page reads the same meta in `index.html`). The repository keeps it empty: a deployment fills it in, for example the included GitHub Pages workflow (`.github/workflows/pages.yml`), which fills it in both pages from the repository variable `SITE_API` and makes the preview image absolute with `SITE_URL`, so no deployment URL is committed. With the meta set, the builder offers "Avvisami per email" and "Solo link"; filling the key under "Avanzate" builds a personal link with that back end and the key. Without it, the builder offers only links, and "Avanzate" asks for both the Apps Script URL and the key.

In personal mode the key must match the script's `SHARED_KEY`, and the guest's email must be in its `ALLOWED_GUESTS`. In multi-user mode the link is never shown in the browser: it is emailed to the owner address, which proves you own it.

If the back end cannot be reached, the invite still ends on the celebration screen and the guest can save the date with the calendar buttons.

Setting up the back end: see [apps-script/README.md](apps-script/README.md).

### Short links (optional)

The builder learns the link store from `<meta name="vibedating-links" content="">` in both pages, filled by the Pages workflow from the repository variable `SITE_LINKS` (the store URL ending in `/links`). With it set, "Crea il link" stores the compact link and shows a short `#i=` one; if the store does not answer, the builder quietly shows the `#y=` link. Emailed multi-user links are shortened by the Apps Script when its `LINKS_URL` and `LINKS_SECRET` properties are set. The invite page shows a short loader while it fetches an `#i=` link, and a dedicated message when the id is unknown or expired. Setting up the store: see [worker/README.md](worker/README.md).

## Privacy

The configuration lives in the URL fragment (after `#`), which browsers do not send to the web server, so the static host never sees names, places or keys. Anyone who has the link can read its content, so share it only with the person you are inviting. With the optional link store, a short link's content is kept unencrypted on the store until it expires (one year by default): anyone with the short link, or with access to the store, can read it. Ids are random and not guessable. The builder remembers your last form in this browser's local storage, except the shared key.

Place suggestions in the builder send what you type in the place name or address (from 3 characters) to [Photon](https://photon.komoot.io) (OpenStreetMap data). If the browser has already granted location access to the site, the approximate position is used to rank nearby results; the page never asks for it.

Link previews in chat apps only show a generic title ("Una domanda per te 💌") and a neutral image, so they do not spoil the surprise. For the preview image to appear, some apps need an absolute `og:image` URL: replace `assets/og.png` in `index.html` with the full URL of your deployment if you want it.

## Local test server

`npm run dev` serves the site, runs `apps-script/Code.gs` at `/api` with fake Calendar and Mail (nothing is sent; see `/outbox`) and the link store (`worker/src/index.js`) at `/links` with an in-memory KV. It fills the `vibedating-api` and `vibedating-links` metas of both pages with `ORIGIN/api` and `ORIGIN/links` on the fly. The emulated Apps Script has no `LINKS_URL`, so emailed links stay `#y=`. Since configs only accept https back ends, pass a certificate: `CERT=cert.pem KEY=key.pem ORIGIN=https://<host>:8443 npm run dev`. Optional env: `PORT`, `SITE_API` (real back end for the builder, default the local `/api`), `SITE_LINKS` (real link store, default the local `/links`), `LINKS_SECRET` (write secret of the local store), `SHARED_KEY` (default `dev-key`), `ALLOWED_GUESTS` (default `guest@example.com`), `SIGNING_SECRET`.
