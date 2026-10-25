import { h } from './dom.js';
import { mapsSearchUrl } from '../config.js';

const PHOTON = 'https://photon.komoot.io/api/';
const MIN_CHARS = 3;
const DELAY = 300;

let bias;
// Bias results near the user only if location access was already granted; never prompt.
async function position() {
  if (bias !== undefined) return bias;
  bias = null;
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'granted') {
      bias = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({ lat: coords.latitude.toFixed(3), lon: coords.longitude.toFixed(3) }),
        () => resolve(null),
        { maximumAge: 600000, timeout: 3000 },
      ));
    }
  } catch { /* no permissions API */ }
  return bias;
}

function toPlace({ properties: p = {} }) {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const city = p.city || p.town || p.village || p.county || p.state || '';
  const name = p.name || street;
  return name ? { name, address: [street, city].filter(Boolean).join(', ') } : null;
}

export async function searchPlaces(q, { lang = 'it', signal } = {}) {
  const params = new URLSearchParams({ q, limit: '5', lang: lang === 'en' ? 'en' : 'default' });
  const near = await position();
  if (near) {
    params.set('lat', near.lat);
    params.set('lon', near.lon);
  }
  try {
    const res = await fetch(`${PHOTON}?${params}`, { signal });
    if (!res.ok) return [];
    const seen = new Set();
    return ((await res.json()).features || []).map(toPlace).filter((p) => {
      const key = p && `${p.name}|${p.address}`;
      if (!p || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [];
  }
}

let seq = 0;

// Turns a text input into an ARIA combobox fed by Photon suggestions.
export function placeCombobox(input, { lang, label, onPick }) {
  const id = `suggest-${++seq}`;
  const list = h('ul', { class: 'suggest', id, role: 'listbox', hidden: true });
  const wrap = h('div', { class: 'combo' }, input, list);
  let items = [];
  let active = -1;
  let timer;
  let ctrl;

  for (const [k, v] of Object.entries({ role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': id })) {
    input.setAttribute(k, v);
  }
  const setLabel = (text) => list.setAttribute('aria-label', text);
  setLabel(label);

  function close() {
    list.hidden = true;
    items = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function highlight(i) {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `${id}-${i}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function render() {
    if (!items.length) return close();
    list.replaceChildren(...items.map((p, i) => h('li', {
      id: `${id}-${i}`, class: 'suggest-opt', role: 'option', 'aria-selected': 'false',
      onMousedown: (e) => e.preventDefault(),
      onClick: () => pick(i),
    }, h('span', { class: 'suggest-name' }, p.name), p.address && h('span', { class: 'suggest-addr' }, p.address))));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    list.scrollIntoView({ block: 'nearest' });
    highlight(-1);
  }

  function pick(i) {
    const place = items[i];
    close();
    if (!place) return;
    input.value = place.name;
    onPick({ ...place, maps: mapsSearchUrl(place.name, place.address) });
  }

  async function run(q) {
    ctrl?.abort();
    ctrl = new AbortController();
    const found = await searchPlaces(q, { lang: lang(), signal: ctrl.signal });
    if (q !== input.value.trim() || document.activeElement !== input) return;
    items = found;
    render();
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    ctrl?.abort();
    const q = input.value.trim();
    if (q.length < MIN_CHARS) return close();
    timer = setTimeout(() => run(q), DELAY);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      highlight(e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  input.addEventListener('blur', () => { clearTimeout(timer); ctrl?.abort(); close(); });

  return { el: wrap, setLabel };
}
