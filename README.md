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

Tests: `npm test` (unit tests for the pure modules and the Apps Script code) and `npm run e2e` (Playwright, desktop and mobile emulation, back end mocked).

## Making a link

Open `create.html` and follow the five numbered steps: who it is for, where (places with emoji, note, address, Maps link), when (time slots; duration, bookable days and time zone sit under "Altre opzioni"), how the answer reaches you, and create. The question, the message after the yes and the invite language are under "Personalizza i testi". A live preview sits next to the form on desktop and behind the "Anteprima" button on phones. Copy the link, share it, or open it to try it.

The whole invite is stored in the link fragment (`index.html#c=…`, base64url JSON). Every text is configurable: `to`, `from`, `q` (question), `done` (message after the yes), `lang` (`it` or `en`). Both pages have an IT/EN switch for the viewer, remembered in local storage.

## Delivery modes

| Mode | What happens when the guest says yes | Needs |
|---|---|---|
| Solo link | Nothing is sent: the guest saves the date with the calendar buttons. | Nothing |
| Avvisami per email (multi-user) | The site's Apps Script emails you a signed link; when the guest accepts, you get an email with the details and an `.ics`. | The site's back end (see below) and your email |
| Personal | Your Apps Script creates an event in your Google Calendar and invites the guest. | Your own deployment and its shared key, under "Avanzate" |

The builder learns the site's back end from `<meta name="vibedating-api" content="">` in `create.html`. The repository keeps it empty: a deployment fills it in, for example the included GitHub Pages workflow (`.github/workflows/pages.yml`), which fills it from the repository variable `SITE_API` and makes the preview image absolute with `SITE_URL`, so no deployment URL is committed. With the meta set, the builder offers "Avvisami per email" and "Solo link"; filling the key under "Avanzate" builds a personal link with that back end and the key. Without it, the builder offers only links, and "Avanzate" asks for both the Apps Script URL and the key.

In personal mode the key must match the script's `SHARED_KEY`, and the guest's email must be in its `ALLOWED_GUESTS`. In multi-user mode the link is never shown in the browser: it is emailed to the owner address, which proves you own it.

If the back end cannot be reached, the invite still ends on the celebration screen and the guest can save the date with the calendar buttons.

Setting up the back end: see [apps-script/README.md](apps-script/README.md).

## Privacy

The configuration lives in the URL fragment (after `#`), which browsers do not send to the web server, so the static host never sees names, places or keys. Anyone who has the link can read its content, so share it only with the person you are inviting. The builder remembers your last form in this browser's local storage, except the shared key.

Link previews in chat apps only show a generic title ("Una domanda per te 💌") and a neutral image, so they do not spoil the surprise. For the preview image to appear, some apps need an absolute `og:image` URL: replace `assets/og.png` in `index.html` with the full URL of your deployment if you want it.

## Local test server

`npm run dev` serves the site and runs `apps-script/Code.gs` at `/api` with fake Calendar and Mail (nothing is sent; see `/outbox`). It fills the builder's `vibedating-api` meta with `ORIGIN/api` on the fly. Since configs only accept https back ends, pass a certificate: `CERT=cert.pem KEY=key.pem ORIGIN=https://<host>:8443 npm run dev`. Optional env: `PORT`, `SITE_API` (real back end for the builder, default the local `/api`), `SHARED_KEY` (default `dev-key`), `ALLOWED_GUESTS` (default `guest@example.com`), `SIGNING_SECRET`.
