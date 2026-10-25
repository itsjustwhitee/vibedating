import { normalizeConfig, buildInviteUrl, ConfigError } from './config.js';
import { postJson, createAttempt } from './api.js';
import { isHttps, isEmail, isValidTime } from './validators.js';
import { h, $, $$ } from './ui/dom.js';
import { button, chip, field, questionCard, toast, copyText, fill, langToggle } from './ui/components.js';
import { icon } from './ui/icons.js';
import { strings, CREATE, detectLang, savedLang, saveLang } from './ui/strings.js';

const STORE = 'vibedating:create';
const META_API = $('meta[name="vibedating-api"]')?.content.trim() || '';
const SITE_API = isHttps(META_API) ? META_API : '';
const PRESET_SLOTS = ['18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'];
const TEXT_FIELDS = ['to', 'from', 'q', 'done', 'lang', 'duration', 'days', 'tz', 'api', 'owner', 'k'];
const PLACE_KEYS = ['emoji', 'name', 'note', 'address', 'maps'];
const ERROR_IDS = ['to', 'from', 'q', 'done', 'places', 'slots', 'duration', 'days', 'tz', 'api', 'k', 'owner'];

const form = $('#form');
const placesEl = $('#places');
const slotsEl = $('#slots');
const result = $('#result');
const sent = $('#sent');
const build = $('#build');
const pane = $('#preview-pane');
const attempt = createAttempt();
let uiLang = savedLang() || detectLang();
let S;
let t;
let slots = [];
let customSlots = [];
let busy = false;

const DEFAULT = {
  to: '', from: '', q: '', done: '', lang: uiLang, duration: '120', days: '60', tz: 'Europe/Rome',
  delivery: SITE_API ? 'email' : 'link', api: '', owner: '',
  places: [{ emoji: '🍣', name: '', note: '', address: '', maps: '' }],
  slots: ['19:30', '20:00', '20:30', '21:00'],
};

function load() {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
  } catch {
    return { ...DEFAULT };
  }
}

function save(state) {
  const { k, ...rest } = state;
  try { localStorage.setItem(STORE, JSON.stringify(rest)); } catch { /* storage unavailable */ }
}

const readPlaces = () => $$('.place-row', placesEl).map((row) =>
  Object.fromEntries(PLACE_KEYS.map((key) => [key, $(`[data-key="${key}"]`, row).value])));

function readForm() {
  const state = Object.fromEntries(TEXT_FIELDS.map((n) => [n, form.elements[n].value]));
  state.delivery = form.elements.delivery.value || DEFAULT.delivery;
  state.places = readPlaces();
  state.slots = [...slots];
  state.customSlots = [...customSlots];
  return state;
}

function modeOf(state) {
  if (state.k.trim() || (!SITE_API && state.api.trim())) return 'personal';
  return SITE_API && state.delivery === 'email' ? 'multi' : 'client';
}

function placeRow(p = {}) {
  const row = h('li', { class: 'place-row' });
  const input = (key, attrs = {}) => {
    const el = h('input', { class: 'input', 'data-key': key, autocomplete: 'off', ...attrs });
    el.value = p[key] || '';
    return el;
  };
  const fields = {
    emoji: field(S.placeEmoji, input('emoji', { maxlength: 8, class: 'input input-emoji' })),
    name: field(S.placeName, input('name', { maxlength: 80, placeholder: S.placeNamePh })),
    note: field(S.placeNote, input('note', { maxlength: 140, placeholder: S.placeNotePh })),
    address: field(S.placeAddress, input('address', { maxlength: 200, placeholder: S.placeAddressPh })),
    maps: field(S.placeMaps, input('maps', { type: 'url', placeholder: 'https://maps.app.goo.gl/…', spellcheck: 'false' })),
  };
  row.setErrors = (errs = {}) => { for (const [key, f] of Object.entries(fields)) f.setError(errs[key]); };
  const remove = button(S.placeRemove, {
    variant: 'ghost', class: 'place-remove', icon: 'x',
    onClick: () => { row.remove(); renumber(); update(); },
  });
  row.append(
    h('div', { class: 'place-row-head' }, h('h3', { class: 'place-row-title' }), remove),
    h('div', { class: 'place-row-grid' }, ...Object.values(fields).map((f) => f.el)),
  );
  return row;
}

function renderPlaces(list) {
  placesEl.replaceChildren(...list.map(placeRow));
  renumber();
}

function renumber() {
  const rows = $$('.place-row', placesEl);
  rows.forEach((row, i) => {
    $('.place-row-title', row).textContent = t('placeLabel', { n: i + 1 });
    $('.place-remove', row).hidden = rows.length === 1;
  });
  $('#add-place').disabled = rows.length >= 12;
}

function renderSlots() {
  const all = [...new Set([...PRESET_SLOTS, ...customSlots])].sort();
  slotsEl.replaceChildren(...all.map((slot) => chip(slot, {
    pressed: slots.includes(slot),
    'data-slot': slot,
    onClick: () => {
      slots = slots.includes(slot) ? slots.filter((s) => s !== slot) : [...slots, slot].sort();
      renderSlots();
      update();
    },
  })));
}

function buildRaw(state, mode) {
  const raw = { v: 1, lang: state.lang };
  for (const key of ['to', 'from', 'q', 'done']) if (state[key].trim()) raw[key] = state[key].trim();
  raw.places = state.places.map((p) => {
    const out = {};
    for (const key of PLACE_KEYS) if (p[key].trim()) out[key] = p[key].trim();
    return out;
  });
  raw.slots = state.slots;
  raw.duration = Number(state.duration);
  raw.days = Number(state.days);
  raw.tz = state.tz.trim();
  if (mode !== 'client') raw.api = SITE_API || state.api.trim();
  if (mode === 'personal') raw.k = state.k.trim();
  if (mode === 'multi') raw.owner = state.owner.trim();
  return raw;
}

function validate(mode, raw) {
  const errs = {};
  const placeErrs = raw.places.map((p) => {
    const e = {};
    if (!p.name || p.name.length > 80) e.name = S.errors.placeName;
    if (p.maps && !isHttps(p.maps)) e.maps = S.errors.placeMaps;
    if ((p.emoji || '').length > 8 || (p.note || '').length > 140 || (p.address || '').length > 200) e.note = S.errors.place;
    return Object.keys(e).length ? e : null;
  });
  if (!Number.isInteger(raw.days) || raw.days < 1 || raw.days > 180) errs.days = S.errors.days;
  if (mode === 'personal' && !isHttps(raw.api)) errs.api = S.errors.api;
  if (mode === 'personal' && (raw.k || '').length < 8) errs.k = S.errors.k;
  if (mode === 'multi' && !isEmail(raw.owner || '')) errs.owner = S.errors.owner;
  if (!placeErrs.some(Boolean)) {
    try {
      normalizeConfig(raw);
    } catch (e) {
      const code = e instanceof ConfigError ? e.code : 'shape';
      if (code !== 'place') errs[code] = S.errors[code] || S.errors.places;
    }
  }
  return { errs, placeErrs };
}

const hasErrors = ({ errs, placeErrs }) => Object.keys(errs).length > 0 || placeErrs.some(Boolean);

function showErrors({ errs, placeErrs }) {
  for (const id of ERROR_IDS) {
    const el = $(`#${id}-err`);
    if (el) el.textContent = errs[id] || '';
    const input = form.elements[id];
    if (input?.setAttribute) {
      if (errs[id]) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }
  $$('.place-row', placesEl).forEach((row, i) => row.setErrors(placeErrs[i] || {}));
  for (const d of $$('details', form)) if ($('[aria-invalid="true"]', d)) d.open = true;
}

function renderPreview(state) {
  const { s, t: ti } = strings(state.lang);
  const card = questionCard({
    to: state.to.trim(), q: state.q.trim() || s.q, from: state.from.trim(), yes: s.yes, no: s.no,
    fromLine: ti('fromLine', { from: state.from.trim() }), heading: 'p',
  });
  for (const b of [card.yes, card.no]) b.tabIndex = -1;
  $('#preview').replaceChildren(card.el);
  $('#q').placeholder = s.q;
  $('#done').placeholder = s.done;
}

function setButton(label, name) {
  build.replaceChildren(icon(name, { size: 18 }), label);
}

function update() {
  const state = readForm();
  const mode = modeOf(state);
  save(state);
  renderPreview(state);
  $('#choices').hidden = !SITE_API;
  $('#choices').classList.toggle('is-locked', mode === 'personal');
  for (const r of form.elements.delivery) r.disabled = mode === 'personal';
  $('#owner-field').hidden = mode !== 'multi';
  $('#link-only').hidden = Boolean(SITE_API) || mode === 'personal';
  $('#personal-note').hidden = mode !== 'personal';
  $('#api-field').hidden = Boolean(SITE_API);
  if (!busy) setButton(mode === 'multi' ? S.buildEmail : S.build, mode === 'multi' ? 'send' : 'sparkles');
  if (!result.hidden) {
    const raw = buildRaw(state, mode);
    if (mode === 'multi' || hasErrors(validate(mode, raw))) result.hidden = true;
    else showLink(raw);
  }
}

function showLink(raw) {
  const url = buildInviteUrl(new URL('index.html', location.href).href, raw);
  $('#link').value = url;
  $('#open').href = url;
  result.hidden = false;
}

function showSent(ok, text) {
  sent.replaceChildren(icon(ok ? 'mail' : 'info', { size: 18 }), h('span', {}, text));
  sent.classList.toggle('is-error', !ok);
  sent.hidden = false;
}

async function submit(e) {
  e.preventDefault();
  const state = readForm();
  const mode = modeOf(state);
  const raw = buildRaw(state, mode);
  const v = validate(mode, raw);
  showErrors(v);
  sent.hidden = true;
  if (hasErrors(v)) {
    $('#form-err').textContent = S.fixErrors;
    result.hidden = true;
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  $('#form-err').textContent = '';
  if (mode !== 'multi') {
    showLink(raw);
    return;
  }
  result.hidden = true;
  if (busy) return;
  const config = { ...raw };
  delete config.sig;
  delete config.exp;
  const id = attempt.begin(JSON.stringify(config));
  if (!id) return;
  busy = true;
  build.disabled = true;
  setButton(S.sending, 'send');
  const res = await postJson(config.api, { action: 'create', id, config });
  attempt.end(res);
  busy = false;
  build.disabled = false;
  update();
  showSent(res.ok, res.ok ? S.sent : t('createFailed', { reason: S.reasons[res.error] || S.reasons.default }));
}

function applyLang(code) {
  const places = readPlaces();
  uiLang = code;
  ({ s: S, t } = strings(code, CREATE));
  document.documentElement.lang = code;
  document.title = `${S.title} 💌`;
  fill(document, S);
  for (const el of $$('[data-step]')) el.textContent = t('stepOf', { n: el.dataset.step });
  if (places.length) renderPlaces(places);
  showErrors({ errs: {}, placeErrs: [] });
  $('#form-err').textContent = '';
  sent.hidden = true;
  update();
}

function init() {
  ({ s: S, t } = strings(uiLang, CREATE));
  const state = load();
  for (const n of TEXT_FIELDS) if (n !== 'k' && state[n] !== undefined) form.elements[n].value = state[n];
  form.elements.delivery.value = SITE_API ? state.delivery : 'link';
  slots = [...state.slots];
  customSlots = (state.customSlots || []).filter((s) => !PRESET_SLOTS.includes(s));
  renderPlaces(state.places.length ? state.places : DEFAULT.places);
  renderSlots();
  $('#topbar').append(langToggle(uiLang, (code) => { saveLang(code); applyLang(code); }, S.language));
  $('#share').hidden = typeof navigator.share !== 'function';

  $('#add-place').addEventListener('click', () => {
    const row = placeRow({});
    placesEl.append(row);
    renumber();
    update();
    $('[data-key="name"]', row).focus();
  });
  $('#add-slot').addEventListener('click', () => {
    const v = $('#custom-slot').value;
    if (!isValidTime(v)) {
      $('#slots-err').textContent = S.errors.slotFormat;
      return;
    }
    if (!PRESET_SLOTS.includes(v) && !customSlots.includes(v)) customSlots.push(v);
    if (!slots.includes(v)) slots = [...slots, v].sort();
    $('#custom-slot').value = '';
    $('#slots-err').textContent = '';
    renderSlots();
    update();
  });
  $('#copy').addEventListener('click', async () => {
    toast((await copyText($('#link').value)) ? S.copied : S.copyFailed);
  });
  $('#share').addEventListener('click', () => {
    const url = $('#link').value;
    navigator.share({ title: strings(form.elements.lang.value).s.pageTitle, url }).catch(() => {});
  });
  const setPreview = (open) => {
    pane.classList.toggle('is-open', open);
    document.body.classList.toggle('preview-open', open);
  };
  $('#preview-open').addEventListener('click', () => setPreview(true));
  $('#preview-close').addEventListener('click', () => setPreview(false));
  pane.addEventListener('click', (e) => { if (e.target === pane) setPreview(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setPreview(false); });
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', submit);
  applyLang(uiLang);
}

init();
