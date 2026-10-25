// `npm run dev`: see dev/dev-server.js. Env: PORT, ORIGIN, CERT, KEY, SITE_API, SITE_LINKS,
// SHARED_KEY, ALLOWED_GUESTS, SIGNING_SECRET, LINKS_SECRET.
import { readFileSync } from 'node:fs';
import { startDevServer } from './dev-server.js';

const { CERT, KEY, ORIGIN } = process.env;
const PORT = Number(process.env.PORT || 8443);
const { origin } = await startDevServer({
  port: PORT,
  origin: ORIGIN || `https://localhost:${PORT}`,
  cert: CERT && readFileSync(CERT),
  key: KEY && readFileSync(KEY),
  env: process.env,
});
console.log(`vibedating dev server on ${origin} (outbox: ${origin}/outbox)`);
