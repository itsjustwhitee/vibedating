import { h } from './dom.js';
import { icon } from './icons.js';

const btnClass = (variant, block, cls) => `btn btn-${variant}${block ? ' btn-block' : ''} ${cls}`.trim();
const btnBody = (label, start, end) => [start && icon(start), label, end && icon(end)];

export function button(label, { variant = 'primary', block = false, class: cls = '', icon: start, iconEnd, ...rest } = {}) {
  return h('button', { type: 'button', class: btnClass(variant, block, cls), ...rest }, btnBody(label, start, iconEnd));
}

export function linkButton(label, href, { variant = 'soft', block = false, class: cls = '', icon: start, iconEnd, ...rest } = {}) {
  return h('a', { class: btnClass(variant, block, cls), href, ...rest }, btnBody(label, start, iconEnd));
}

export function chip(label, { pressed = false, ...rest } = {}) {
  return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), ...rest }, icon('check', { size: 16, class: 'chip-check' }), label);
}

export const note = (name, text, { class: cls = '', ...rest } = {}) =>
  h('p', { class: `note ${cls}`.trim(), ...rest }, icon(name, { size: 18 }), h('span', {}, text));

export const iconRow = (name, ...children) =>
  h('div', { class: 'icon-row' }, h('span', { class: 'icon-tile' }, icon(name, { size: 18 })), h('div', {}, children));

export function fill(root, dict) {
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = dict[el.dataset.t] ?? '';
  for (const el of root.querySelectorAll('[data-t-ph]')) el.placeholder = dict[el.dataset.tPh] ?? '';
  for (const el of root.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', dict[el.dataset.tAria] ?? '');
  for (const el of root.querySelectorAll('[data-icon]')) el.replaceWith(icon(el.dataset.icon, { size: Number(el.dataset.size) || 20 }));
}

export function langToggle(current, onChange, label) {
  const el = h('div', { class: 'lang-toggle', role: 'group', 'aria-label': label });
  for (const code of ['it', 'en']) {
    el.append(h('button', {
      type: 'button', class: 'lang-opt', lang: code, 'data-lang': code, 'aria-pressed': String(code === current),
      onClick: (e) => {
        for (const b of el.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        onChange(code);
      },
    }, code.toUpperCase()));
  }
  return el;
}

let fieldSeq = 0;
export function field(label, input, { hint, id, icon: name } = {}) {
  const inputId = input.id || id || `f${++fieldSeq}`;
  input.id = inputId;
  const error = h('p', { class: 'field-error', id: `${inputId}-err`, 'aria-live': 'polite' });
  input.setAttribute('aria-describedby', error.id);
  const wrap = h('div', { class: 'field' },
    h('label', { class: 'field-label', for: inputId }, name && icon(name, { size: 17 }), label),
    hint && h('p', { class: 'field-hint' }, hint),
    input,
    error,
  );
  const setError = (msg) => {
    error.textContent = msg || '';
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  return { el: wrap, input, setError };
}

export function screen({ title, hint, body = [], foot = [], name, head = [] }) {
  return h('section', { class: `card screen enter screen-${name}`, 'data-screen': name, 'aria-labelledby': `${name}-title` },
    head,
    (title || hint) && h('header', { class: 'screen-head' },
      title && h('h1', { id: `${name}-title`, tabindex: '-1' }, title),
      hint && h('p', {}, hint),
    ),
    body,
    foot.length > 0 && h('footer', { class: 'screen-foot' }, foot),
  );
}

const SVG = 'http://www.w3.org/2000/svg';
export function seal({ mark = 'heart', label = '' } = {}) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'seal');
  svg.setAttribute('aria-hidden', 'true');
  const inner = mark === 'heart'
    ? '<path class="seal-mark" d="M50 70c-1 0-2-.4-2.8-1.1C38 61 30 54 30 45.5 30 39.6 34.6 35 40.3 35c3.8 0 7.4 2 9.7 5.2 2.3-3.2 5.9-5.2 9.7-5.2C65.4 35 70 39.6 70 45.5 70 54 62 61 52.8 68.9 52 69.6 51 70 50 70z"/>'
    : `<text class="seal-mark" x="50" y="60" text-anchor="middle" font-family="Caprasimo, Georgia, serif" font-size="27">${label}</text>`;
  svg.innerHTML = `<path fill="currentColor" d="M50 4c6 0 8 5 13 6s10-2 14 2 1 9 4 13 8 6 8 12-5 8-6 13 2 10-2 14-9 1-13 4-6 8-12 8-8-5-13-6-10 2-14-2-1-9-4-13-8-6-8-12 5-8 6-13-2-10 2-14 9-1 13-4 6-8 12-8z"/>${inner}`;
  return svg;
}

export function questionCard({ to, q, from, yes, no, fromLine, heading = 'h1', titleId }) {
  const yesBtn = button(yes, { class: 'btn-yes' });
  const noBtn = button(no, { variant: 'soft', class: 'btn-no' });
  const el = h('div', { class: 'question' },
    seal(),
    h(heading, { class: 'question-text', id: titleId }, to ? `${to}, ${q}` : capitalize(q)),
    from && h('p', { class: 'question-from' }, fromLine),
    h('div', { class: 'question-actions' }, yesBtn, noBtn),
  );
  return { el, yes: yesBtn, no: noBtn };
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), 2700);
}

const HEARTS = [
  [6, 13, 19, -2], [17, 22, 24, -11], [29, 15, 21, -6], [42, 26, 27, -17], [55, 12, 18, -3],
  [66, 20, 25, -14], [78, 16, 22, -8], [88, 24, 28, -20], [94, 11, 17, -12], [36, 18, 23, -21],
];
export function hearts() {
  return h('div', { class: 'hearts', 'aria-hidden': 'true' },
    HEARTS.map(([x, s, d, delay]) => h('span', { style: `--x:${x}%;--s:${s}px;--d:${d}s;--delay:${delay}s` }, '♥')));
}

export function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
