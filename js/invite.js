import { readConfigFromHash, buildInviteUrl, configMode } from './config.js';
import { todayISO, addDaysISO, zonedToUtc, formatDateLong } from './dates.js';
import { googleCalendarUrl, buildIcs } from './calendar.js';
import { postJson, createAttempt, buildAcceptPayload } from './api.js';
import { isEmail } from './validators.js';
import { createFlow } from './state.js';
import { h, $, mount } from './ui/dom.js';
import { button, linkButton, chip, field, screen, seal, questionCard, hearts, downloadFile, note, iconRow, langToggle, siteFooter } from './ui/components.js';
import { icon } from './ui/icons.js';
import { attachRunaway } from './ui/runaway.js';
import { celebrate } from './ui/confetti.js';
import { strings, detectLang, savedLang, saveLang } from './ui/strings.js';

const DEMO = {
  v: 1,
  lang: 'it',
  to: 'Saro',
  from: 'Ciuchi',
  places: [
    { emoji: '🍣', name: 'Sushi Sapporo', note: 'Nigiri al bancone, uno dopo l’altro' },
    { emoji: '🍜', name: 'Hideo Ramen', note: 'Brodo che scalda, risucchio ammesso' },
    { emoji: '🍕', name: 'Pizzeria Montebello', note: 'Forno a legna e cornicione che scrocchia' },
  ],
  slots: ['19:30', '20:00', '20:30', '21:00'],
};

const app = $('#app');
const parsed = readConfigFromHash(location.hash);
let lang = savedLang() || parsed.cfg?.lang || detectLang();
let { s, t } = strings(lang);
let rerender = () => {};

function setLang(code) {
  lang = code;
  ({ s, t } = strings(code));
  document.documentElement.lang = code;
  document.title = s.pageTitle;
  footer?.setText(s.footer);
}

const footer = siteFooter(s.footer);
setLang(lang);
document.body.append(footer.el);
document.body.prepend(hearts(), h('div', { class: 'topbar' }, langToggle(lang, (code) => {
  saveLang(code);
  setLang(code);
  rerender();
}, s.language)));
addEventListener('hashchange', () => location.reload());
if (parsed.error === 'missing') landing();
else if (parsed.error) failure();
else invite(parsed.raw, parsed.cfg);

function landing() {
  rerender = landing;
  mount(app, screen({
    name: 'landing',
    head: [seal()],
    title: s.landingTitle,
    hint: s.landingText,
    foot: [
      linkButton(s.landingDemo, buildInviteUrl(location.href, DEMO), { variant: 'ghost', icon: 'eye' }),
      linkButton(s.landingCreate, 'create.html', { variant: 'primary', iconEnd: 'arrow-right' }),
    ],
  }));
}

function failure() {
  rerender = failure;
  mount(app, screen({
    name: 'error',
    head: [seal()],
    title: s.errorTitle,
    hint: s.errorText,
    foot: [linkButton(s.errorHome, location.pathname, { variant: 'soft', icon: 'arrow-left' })],
  }));
}

function invite(raw, cfg) {
  const mode = configMode(cfg);
  let shown = null;
  let detach = null;
  const attempt = createAttempt();
  let notice = { datetime: '', email: '' };
  const flow = createFlow((state) => {
    if (state.screen !== shown) render(state.screen);
  });
  const st = flow.state;

  const SCREENS = { question, places, datetime, email, sending, done };
  rerender = () => render(shown);

  function render(name) {
    shown = name;
    detach?.();
    detach = null;
    mount(app, SCREENS[name]());
    if (name !== 'question') $('h1', app)?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  const backBtn = () => button(s.back, { variant: 'ghost', class: 'btn-back', icon: 'arrow-left', onClick: () => flow.back() });
  const nextBtn = (label, onClick, iconEnd = 'arrow-right') => button(label, { class: 'btn-next', iconEnd, onClick });
  const place = () => cfg.places[st.placeIndex];
  const today = () => todayISO(new Date(), cfg.tz);

  function friendlyDate(iso) {
    const n = Math.round((Date.parse(iso) - Date.parse(today())) / 86400000);
    const date = formatDateLong(iso, lang);
    if (n === 0) return t('dateToday', { date });
    if (n === 1) return t('dateTomorrow', { date });
    return t('dateIn', { date, n });
  }

  function summary() {
    const p = place();
    return h('div', { class: 'summary' },
      iconRow('map-pin', h('strong', { class: 'summary-place' }, p.emoji ? `${p.emoji} ${p.name}` : p.name), p.address && h('span', { class: 'summary-sub' }, p.address)),
      iconRow('calendar', h('span', { class: 'summary-when' }, formatDateLong(st.date, lang))),
      iconRow('clock', h('span', { class: 'summary-when' }, t('at', { time: st.time }))),
    );
  }

  function question() {
    const card = questionCard({
      to: cfg.to, q: cfg.q || s.q, from: cfg.from, yes: s.yes, no: s.no,
      fromLine: t('fromLine', { from: cfg.from }), titleId: 'question-title',
    });
    card.yes.id = 'yes';
    card.no.id = 'no';
    card.yes.addEventListener('click', () => flow.next());
    const el = h('section', { class: 'card screen enter screen-question', 'data-screen': 'question', 'aria-labelledby': 'question-title' }, card.el);
    requestAnimationFrame(() => {
      if (shown === 'question') detach = attachRunaway(card.no, card.yes, { labels: s.dodges });
    });
    return el;
  }

  function places() {
    const next = nextBtn(s.next, () => flow.next());
    next.disabled = st.placeIndex === null;
    const items = cfg.places.map((p, i) => {
      const pick = h('button', {
        type: 'button', class: 'place-pick', 'aria-pressed': String(st.placeIndex === i),
        onClick: () => {
          flow.set({ placeIndex: i });
          for (const b of list.querySelectorAll('.place-pick')) b.setAttribute('aria-pressed', String(b === pick));
          next.disabled = false;
        },
      },
      h('span', { class: 'place-emoji', 'aria-hidden': 'true' }, p.emoji || '🍽️'),
      h('span', { class: 'place-body' },
        h('span', { class: 'place-name' }, p.name),
        p.note && h('span', { class: 'place-note' }, p.note),
        p.address && h('span', { class: 'place-address' }, p.address),
      ),
      h('span', { class: 'place-check', 'aria-hidden': 'true' }, icon('check', { size: 16 })));
      return h('li', { class: 'place' }, pick,
        p.maps && h('a', { class: 'place-maps', href: p.maps, target: '_blank', rel: 'noopener noreferrer' }, icon('map-pin', { size: 16 }), s.openMaps));
    });
    const list = h('ul', { class: 'places', role: 'list' }, items);
    return screen({ name: 'places', title: s.placesTitle, hint: s.placesHint, body: [list], foot: [backBtn(), next] });
  }

  function datetime() {
    const day = today();
    const input = h('input', { type: 'date', class: 'input', min: day, max: addDaysISO(day, cfg.days), required: true });
    if (st.date) input.value = st.date;
    const dateField = field(s.dateLabel, input, { id: 'date', icon: 'calendar' });
    const long = h('p', { class: 'date-long', 'aria-live': 'polite' });
    const slots = h('div', { class: 'chips slots', role: 'group', 'aria-label': s.timeLabel });
    const next = mode === 'client'
      ? nextBtn(s.send, () => (isStale() ? retryWhen() : finish(null)), 'heart')
      : nextBtn(s.next, () => flow.next());

    const isPast = (slot) => st.date === day && zonedToUtc(st.date, slot, cfg.tz).getTime() <= Date.now();
    function refresh() {
      const valid = input.value && input.value >= input.min && input.value <= input.max;
      st.date = valid ? input.value : null;
      dateField.setError(!input.value || valid ? ''
        : input.value < input.min ? s.datePast : t('dateTooFar', { date: friendlyDate(input.max) }));
      long.textContent = st.date ? friendlyDate(st.date) : '';
      if (st.time && st.date && isPast(st.time)) st.time = null;
      slots.replaceChildren(...cfg.slots.map((slot) => {
        const past = Boolean(st.date) && isPast(slot);
        return chip(slot, {
          pressed: st.time === slot,
          disabled: past,
          title: past ? s.slotPast : undefined,
          'data-slot': slot,
          onClick: () => { st.time = slot; refresh(); },
        });
      }));
      next.disabled = !(st.date && st.time);
    }
    input.addEventListener('click', () => { try { input.showPicker(); } catch {} });
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
    refresh();

    return screen({
      name: 'datetime', title: s.whenTitle, hint: s.whenHint,
      body: [h('div', { class: 'stack' }, dateField.el, long, h('p', { class: 'field-error', role: 'alert' }, takeNotice('datetime')), h('div', { class: 'field' }, h('span', { class: 'field-label' }, icon('clock', { size: 17 }), s.timeLabel), slots))],
      foot: [backBtn(), next],
    });
  }

  function email() {
    const input = h('input', {
      type: 'email', class: 'input', autocomplete: 'email', inputmode: 'email', required: true,
      placeholder: s.emailPlaceholder, value: st.guest,
    });
    const f = field(s.emailLabel, input, { id: 'guest', icon: 'mail' });
    f.setError(takeNotice('email'));
    const send = nextBtn(s.send, submit, 'heart');
    const form = h('form', { class: 'stack', novalidate: true, onSubmit: (e) => { e.preventDefault(); submit(); } }, summary(), f.el);
    input.addEventListener('input', () => f.setError(''));
    function submit() {
      if (send.disabled) return;
      const guest = input.value.trim();
      if (!input.checkValidity() || !isEmail(guest)) {
        f.setError(s.emailInvalid);
        input.focus();
        return;
      }
      send.disabled = true;
      flow.set({ guest });
      send_();
    }
    return screen({ name: 'email', title: s.emailTitle, hint: s.emailHint, body: [form], foot: [backBtn(), send] });
  }

  const isStale = () => zonedToUtc(st.date, st.time, cfg.tz).getTime() <= Date.now();

  function takeNotice(screenName) {
    const msg = notice[screenName];
    notice[screenName] = '';
    return msg;
  }

  function retryWhen() {
    notice.datetime = s.whenRetry;
    st.time = null;
    const same = shown === 'datetime';
    flow.go('datetime');
    if (same) render('datetime');
  }

  function retryEmail(msg) {
    notice.email = msg;
    flow.go('email');
  }

  async function send_() {
    if (isStale()) return retryWhen();
    const key = JSON.stringify([st.placeIndex, st.date, st.time, st.guest]);
    const id = attempt.begin(key);
    if (!id) return;
    flow.go('sending');
    const payload = buildAcceptPayload({ raw, cfg: { ...cfg, lang }, mode, id, guest: st.guest, placeIndex: st.placeIndex, date: st.date, time: st.time });
    const result = await postJson(cfg.api, payload);
    attempt.end(result);
    if (result.error === 'bad_time' || result.error === 'bad_date') return retryWhen();
    if (result.error === 'bad_email') return retryEmail(s.emailRetry);
    if (result.error === 'guest_not_allowed') return retryEmail(t('emailGuest', { from: cfg.from || s.fromAnon }));
    finish(result);
  }

  function finish(result) {
    flow.set({ result });
    flow.go('done');
  }

  function sending() {
    return h('section', { class: 'card screen enter screen-sending', 'data-screen': 'sending', 'aria-busy': 'true' },
      h('div', { class: 'sending' },
        h('div', { class: 'plate', 'aria-hidden': 'true' }, h('span', {}, '🍷'), h('span', {}, '🕯️'), h('span', {}, '🍷')),
        h('h1', { tabindex: '-1' }, s.sending),
      ));
  }

  function done() {
    const p = place();
    const start = zonedToUtc(st.date, st.time, cfg.tz);
    const end = new Date(start.getTime() + cfg.duration * 60000);
    const title = cfg.from ? t('eventTitle', { from: cfg.from }) : s.eventTitleAnon;
    const location = [p.name, p.address].filter(Boolean).join(', ');
    const details = cfg.done || s.done;
    const failed = st.result && !st.result.ok;
    const reason = failed ? (s.reasons[st.result.error] || s.reasons.default) : '';
    const ics = () => downloadFile('cena.ics', buildIcs({ uid: `${start.getTime()}-${Math.random().toString(36).slice(2)}@vibedating`, title, start, end, location, description: details }), 'text/calendar;charset=utf-8');
    setTimeout(celebrate, 250);
    return screen({
      name: 'done',
      head: [seal({ mark: 'text', label: s.sealYes })],
      title: s.doneTitle,
      hint: details,
      body: [
        summary(),
        failed && note('info', t('fallbackLine', { reason }), { class: 'fallback', role: 'status' }),
        h('div', { class: 'stack actions' },
          linkButton(s.gcal, googleCalendarUrl({ title, start, end, location, details }), { variant: 'primary', block: true, icon: 'calendar-plus', target: '_blank', rel: 'noopener noreferrer', id: 'gcal' }),
          button(s.ics, { variant: 'soft', block: true, icon: 'download', id: 'ics', onClick: ics }),
        ),
      ],
    });
  }

  render('question');
}
