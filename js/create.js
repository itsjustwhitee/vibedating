import { normalizeConfig, buildInviteUrl, ConfigError } from './config.js';
import { postJson, createAttempt } from './api.js';
import { isHttps, isEmail, isValidTime } from './validators.js';
import { h, $, $$ } from './ui/dom.js';
import { chip, iconButton, toast, copyText, fill, langToggle, siteFooter } from './ui/components.js';
import { icon } from './ui/icons.js';
import { emojiPicker, suggestEmoji, DEFAULT_EMOJI } from './ui/emojiPicker.js';
import { placeCombobox } from './ui/placeSearch.js';
import { strings, CREATE, detectLang, savedLang, saveLang } from './ui/strings.js';

const STORE = 'vibedating:create';
const meta = (name) => $(`meta[name="${name}"]`)?.content.trim() || '';
const SITE_API = isHttps(meta('vibedating-api')) ? meta('vibedating-api') : '';
const SITE_LINKS = meta('vibedating-links');
const ADVANCED = new URLSearchParams(location.search).has('advanced');
const PRESET_SLOTS = ['18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'];
const TEXT_FIELDS = ['to', 'from', 'q', 'done', 'lang', 'duration', 'days', 'tz', 'api', 'owner', 'k'];
const PLACE_KEYS = ['emoji', 'name', 'note', 'address', 'maps'];
const ERROR_IDS = ['to', 'from', 'q', 'done', 'places', 'slots', 'duration', 'days', 'tz', 'api', 'k', 'owner'];

// The personal key is for the site owner only: the section exists only with ?advanced.
if (!ADVANCED) $('#advanced').remove();

const form = $('#form');
const placesEl = $('#places');
const slotsEl = $('#slots');
const result = $('#result');
const sent = $('#sent');
const build = $('#build');
const attempt = createAttempt();
let uiLang = savedLang() || detectLang();
let S;
let t;
let slots = [];
let customSlots = [];
let busy = false;
let linkSeq = 0;
let shownKey = '';
let placeSeq = 0;
let footer;

const DEFAULT = {
  to: '', from: '', q: '', done: '', lang: uiLang, duration: '120', days: '60', tz: 'Europe/Rome',
  delivery: SITE_API ? 'email' : 'link', api: '', owner: '',
  places: [{ emoji: DEFAULT_EMOJI, name: '', note: '', address: '', maps: '' }],
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

const readPlaces = () => $$('.place-row', placesEl).map((row) => row.read());

function readForm() {
  const state = Object.fromEntries(TEXT_FIELDS.map((n) => [n, form.elements[n]?.value ?? '']));
  state.delivery = form.elements.delivery.value || DEFAULT.delivery;
  state.places = readPlaces();
  state.slots = [...slots];
  state.customSlots = [...customSlots];
  return state;
}

function modeOf(state) {
  if (ADVANCED && (state.k.trim() || (!SITE_API && state.api.trim()))) return 'personal';
  return SITE_API && state.delivery === 'email' ? 'multi' : 'client';
}

function placeRow(p = {}) {
  const row = h('li', { class: 'place-row' });
  const inputs = {};
  const errors = {};
  const field = (key, label, attrs = {}, control) => {
    const id = `place-${key}-${++placeSeq}`;
    const el = h('input', { class: 'input', id, 'data-key': key, autocomplete: 'off', 'aria-describedby': `${id}-err`, ...attrs });
    el.value = p[key] || '';
    inputs[key] = el;
    errors[key] = h('p', { class: 'field-error', id: `${id}-err`, 'aria-live': 'polite' });
    return h('div', { class: 'field' }, label && h('label', { class: 'field-label', for: id }, label), control ? control(el) : el, errors[key]);
  };

  let picked = Boolean(p.picked);
  const emoji = emojiPicker({
    value: p.emoji || suggestEmoji(p.name),
    label: S.placeEmoji,
    onPick: () => { picked = true; update(); },
  });
  const autoEmoji = () => { if (!picked) emoji.set(suggestEmoji(inputs.name.value)); };

  const nameField = field('name', null, { maxlength: 80, spellcheck: 'false', placeholder: S.placeNamePh }, (el) => placeCombobox(el, {
    lang: () => uiLang,
    label: S.suggestions,
    onPick: (place) => {
      inputs.address.value = place.address;
      inputs.maps.value = place.maps;
      autoEmoji();
      update();
    },
  }).el);
  inputs.name.addEventListener('input', autoEmoji);

  const title = h('label', { class: 'field-label place-row-title', for: inputs.name.id });
  const remove = iconButton('x', '', {
    class: 'place-remove',
    onClick: () => { row.remove(); renumber(); update(); $('#add-place').focus(); },
  });

  row.append(
    h('div', { class: 'place-row-head' }, title, remove),
    h('div', { class: 'place-main' }, emoji.el, nameField),
    field('note', S.placeNote, { maxlength: 140, placeholder: S.placeNotePh }),
    h('details', { class: 'place-more' },
      h('summary', {}, icon('map-pin', { size: 16 }), h('span', {}, S.placeDetails)),
      h('div', { class: 'place-more-body' },
        field('address', S.placeAddress, { maxlength: 200, placeholder: S.placeAddressPh }),
        field('maps', S.placeMaps, { type: 'url', placeholder: 'https://maps.app.goo.gl/…', spellcheck: 'false' }))),
  );

  row.read = () => ({
    emoji: emoji.value,
    ...Object.fromEntries(Object.entries(inputs).map(([key, el]) => [key, el.value])),
    picked,
  });
  row.setNumber = (n) => {
    title.textContent = t('placeLabel', { n });
    const label = t('placeRemove', { n });
    remove.setAttribute('aria-label', label);
    remove.title = label;
  };
  row.setErrors = (errs = {}) => {
    for (const [key, el] of Object.entries(errors)) {
      el.textContent = errs[key] || '';
      if (errs[key]) inputs[key].setAttribute('aria-invalid', 'true');
      else inputs[key].removeAttribute('aria-invalid');
    }
  };
  return row;
}

function renderPlaces(list) {
  placesEl.replaceChildren(...list.map(placeRow));
  renumber();
}

function renumber() {
  const rows = $$('.place-row', placesEl);
  rows.forEach((row, i) => {
    row.setNumber(i + 1);
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
  // With a site back end the invite page talks to it directly: links never carry `api` then.
  if (mode === 'personal') {
    if (!SITE_API) raw.api = state.api.trim();
    raw.k = state.k.trim();
  }
  if (mode === 'multi') raw.owner = state.owner.trim();
  return raw;
}

function validate(mode, raw) {
  const errs = {};
  const placeErrs = raw.places.map((p) => {
    const e = {};
    if (!p.name || p.name.length > 80) e.name = S.errors.placeName;
    if (p.maps && !isHttps(p.maps)) e.maps = S.errors.placeMaps;
    if ((p.note || '').length > 140) e.note = S.errors.place;
    if ((p.address || '').length > 200) e.address = S.errors.place;
    return Object.keys(e).length ? e : null;
  });
  if (!Number.isInteger(raw.days) || raw.days < 1 || raw.days > 180) errs.days = S.errors.days;
  if (mode === 'personal' && !SITE_API && !isHttps(raw.api)) errs.api = S.errors.api;
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

function setButton(label, name) {
  build.replaceChildren(icon(name, { size: 18 }), label);
}

function hideLink() {
  linkSeq++;
  shownKey = '';
  result.hidden = true;
}

// `store` asks the link store for a short link; it is used on an explicit build only, so edits
// never spend store writes.
async function showLink(raw, { store = false } = {}) {
  const seq = ++linkSeq;
  shownKey = JSON.stringify(raw);
  const url = await buildInviteUrl(new URL('./', location.href).href, raw, { linksApi: store ? SITE_LINKS : '' });
  if (seq !== linkSeq) return;
  $('#link').value = url;
  $('#open').href = url;
  result.hidden = false;
}

function update() {
  const state = readForm();
  const mode = modeOf(state);
  save(state);
  const { s: invite } = strings(state.lang);
  $('#q').placeholder = invite.q;
  $('#done').placeholder = invite.done;
  $('#choices').hidden = !SITE_API;
  $('#choices').classList.toggle('is-locked', mode === 'personal');
  for (const r of form.elements.delivery) r.disabled = mode === 'personal';
  $('#owner-field').hidden = mode !== 'multi';
  $('#link-only').hidden = Boolean(SITE_API) || mode === 'personal';
  $('#personal-note').hidden = mode !== 'personal';
  if (ADVANCED) $('#api-field').hidden = Boolean(SITE_API);
  if (!busy) setButton(mode === 'multi' ? S.buildEmail : S.build, mode === 'multi' ? 'send' : 'sparkles');
  if (!result.hidden) {
    const raw = buildRaw(state, mode);
    if (JSON.stringify(raw) === shownKey) return;
    // A short link would go stale on edit: drop it until the next build.
    if (mode === 'multi' || SITE_LINKS || hasErrors(validate(mode, raw))) hideLink();
    else showLink(raw);
  }
}

async function whileBusy(label, name, task) {
  busy = true;
  build.disabled = true;
  setButton(label, name);
  try {
    return await task();
  } finally {
    busy = false;
    build.disabled = false;
    update();
  }
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
    hideLink();
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  $('#form-err').textContent = '';
  if (busy) return;
  if (mode !== 'multi') {
    if (SITE_LINKS) await whileBusy(S.shortening, 'link', () => showLink(raw, { store: true }));
    else await showLink(raw);
    return;
  }
  hideLink();
  const id = attempt.begin(JSON.stringify(raw));
  if (!id) return;
  const res = await whileBusy(S.sending, 'send', () => postJson(SITE_API, { action: 'create', id, config: raw }));
  attempt.end(res);
  showSent(res.ok, res.ok ? S.sent : t('createFailed', { reason: S.reasons[res.error] || S.reasons.default }));
}

function applyLang(code) {
  const places = readPlaces();
  uiLang = code;
  ({ s: S, t } = strings(code, CREATE));
  document.documentElement.lang = code;
  document.title = `${S.title} 💌`;
  fill(document, S);
  footer?.setText(S.footer);
  for (const el of $$('[data-step]')) el.textContent = t('stepOf', { n: el.dataset.step });
  if (places.length) renderPlaces(places);
  showErrors({ errs: {}, placeErrs: [] });
  $('#form-err').textContent = '';
  sent.hidden = true;
  update();
}

function addSlot() {
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
}

function init() {
  ({ s: S, t } = strings(uiLang, CREATE));
  const state = load();
  for (const n of TEXT_FIELDS) if (n !== 'k' && state[n] !== undefined && form.elements[n]) form.elements[n].value = state[n];
  form.elements.delivery.value = SITE_API ? state.delivery : 'link';
  slots = [...state.slots];
  customSlots = (state.customSlots || []).filter((s) => !PRESET_SLOTS.includes(s));
  renderPlaces(state.places.length ? state.places : DEFAULT.places);
  renderSlots();
  footer = siteFooter(S.footer);
  document.body.append(footer.el);
  $('#topbar').append(langToggle(uiLang, (code) => { saveLang(code); applyLang(code); }, S.language));
  $('#share').hidden = typeof navigator.share !== 'function';

  $('#add-place').addEventListener('click', () => {
    const row = placeRow({});
    placesEl.append(row);
    renumber();
    update();
    $('[data-key="name"]', row).focus();
  });
  $('#add-slot').addEventListener('click', addSlot);
  $('#custom-slot').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addSlot();
  });
  $('#copy').addEventListener('click', async () => {
    toast((await copyText($('#link').value)) ? S.copied : S.copyFailed);
  });
  $('#share').addEventListener('click', () => {
    navigator.share({ title: strings(form.elements.lang.value).s.pageTitle, url: $('#link').value }).catch(() => {});
  });
  form.addEventListener('input', (e) => {
    // Inline validation: an edited field drops its error right away; the rest waits for the next submit.
    if (e.target.getAttribute?.('aria-invalid') === 'true') {
      e.target.removeAttribute('aria-invalid');
      const err = $(`#${e.target.id}-err`);
      if (err) err.textContent = '';
    }
    update();
  });
  form.addEventListener('change', update);
  form.addEventListener('submit', submit);
  applyLang(uiLang);
}

init();
