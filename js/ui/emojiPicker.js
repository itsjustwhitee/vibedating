import { h } from './dom.js';

export const DEFAULT_EMOJI = '🍽️';

export const EMOJI_POOL = [
  '🍽️', '🍕', '🍣', '🍜', '🍝', '🍔', '🌮', '🥗',
  '🥘', '🍤', '🍱', '🥟', '🍛', '🥩', '🐟', '🍳',
  '🥐', '🍰', '🍦', '🧁', '☕', '🍷', '🍺', '🍸',
];

// First match wins: specific dishes before generic venues ("Sushi Bar" is sushi, not a bar).
const KEYWORDS = [
  ['🍣', 'sushi|giappon|japan|nigiri|sashimi|uramaki|izakaya'],
  ['🍜', 'ramen|noodle|pho|udon|soba'],
  ['🍕', 'pizz'],
  ['🍔', 'burger|hamburger'],
  ['🌮', 'taco|taque|messic|mexic|burrito'],
  ['🍛', 'india|curry|tandoor'],
  ['🥟', 'cines|chinese|china|dim sum|dumpling'],
  ['🍱', 'bento|korea|corean|thai'],
  ['🥘', 'paella|tapas|spagn|spanish'],
  ['🍤', 'frittur|gamber|shrimp|seafood'],
  ['🐟', 'pesce|fish|mare|ittic'],
  ['🥩', 'carne|steak|braceri|bistecc|grill|griglia|bbq|barbecue|churrasc'],
  ['🥗', 'insalat|salad|vegan|vegetarian|bowl|poke'],
  ['🍳', 'brunch|breakfast|colazion'],
  ['🥐', 'bakery|panific|fornai|cornett|croissant|boulanger'],
  ['🧁', 'cupcake|muffin'],
  ['🍰', 'pasticc|dolc|dessert|torta|torte|cake|patisser'],
  ['🍦', 'gelat|ice cream|frozen yogurt'],
  ['🍷', 'vino|vini|enotec|wine|vineria'],
  ['🍺', 'birr|pub|beer|brew'],
  ['🍸', 'cocktail|lounge|mixolog|spritz'],
  ['☕', 'caff|cafe|coffee|bar\\b'],
  ['🍝', 'osteri|trattori|pasta|italian|cucina|ristorant'],
].map(([emoji, words]) => [emoji, new RegExp(`\\b(?:${words})`)]);

const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function suggestEmoji(name) {
  const text = plain(name || '');
  return KEYWORDS.find(([, re]) => re.test(text))?.[0] || DEFAULT_EMOJI;
}

const COLS = 6;

export function emojiPicker({ value = DEFAULT_EMOJI, label, onPick }) {
  const face = h('span', { class: 'emoji-face', 'aria-hidden': 'true' });
  const trigger = h('button', {
    type: 'button', class: 'emoji-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false',
  }, face);
  const grid = h('div', { class: 'emoji-pop', role: 'group', hidden: true });
  const el = h('div', { class: 'emoji-picker' }, trigger, grid);
  let current = value;

  const options = EMOJI_POOL.map((emoji) => h('button', {
    type: 'button', class: 'emoji-opt', tabindex: '-1', 'data-emoji': emoji,
    onClick: () => { set(emoji); close(true); onPick(emoji); },
  }, emoji));
  grid.append(...options);

  function set(emoji) {
    current = emoji;
    face.textContent = emoji;
    for (const o of options) o.setAttribute('aria-pressed', String(o.dataset.emoji === emoji));
  }

  function setLabel(text) {
    trigger.setAttribute('aria-label', `${text}: ${current}`);
    trigger.title = text;
    grid.setAttribute('aria-label', text);
    trigger.dataset.label = text;
  }

  const outside = (e) => { if (!el.contains(e.target)) close(false); };

  function open() {
    grid.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside);
    (options.find((o) => o.dataset.emoji === current) || options[0]).focus({ preventScroll: true });
    grid.scrollIntoView({ block: 'nearest' });
  }

  function close(refocus) {
    if (grid.hidden) return;
    grid.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside);
    if (refocus) trigger.focus();
    setLabel(trigger.dataset.label);
  }

  trigger.addEventListener('click', () => (grid.hidden ? open() : close(false)));
  grid.addEventListener('keydown', (e) => {
    const i = options.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS, Home: -i, End: options.length - 1 - i }[e.key];
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    } else if (step !== undefined && i >= 0) {
      e.preventDefault();
      options[Math.min(options.length - 1, Math.max(0, i + step))].focus();
    }
  });

  set(value);
  setLabel(label);
  return {
    el,
    get value() { return current; },
    set: (emoji) => { set(emoji); setLabel(trigger.dataset.label); },
  };
}
