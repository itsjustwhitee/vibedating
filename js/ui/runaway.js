import { reducedMotion } from './dom.js';

const MARGIN = 10;
const GAP = 14;
const NEAR = 40;
const DASH_MS = 140;
const EASE = 'cubic-bezier(.2,.9,.1,1)';
const BLUR_ID = 'runaway-blur';

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const grow = (r, by) => ({ left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by });
const center = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });

function blurNode() {
  let f = document.getElementById(BLUR_ID);
  if (!f) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0';
    svg.innerHTML = `<filter id="${BLUR_ID}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="0 0"/></filter>`;
    document.body.append(svg);
    f = svg.firstChild;
  }
  return f.firstChild;
}

export function attachRunaway(noBtn, yesBtn, { onDodge = () => {}, labels = [], labelAfter = 3 } = {}) {
  let count = 0;
  let scale = 1;
  let last = 0;
  let pointer = null;
  let dash = null;

  const viewport = () => ({
    w: document.documentElement.clientWidth,
    h: window.visualViewport ? Math.min(window.visualViewport.height, window.innerHeight) : window.innerHeight,
  });

  function yesRect() {
    const yesScale = Number(yesBtn.dataset.scale || 1);
    const { x, y } = center(yesBtn.getBoundingClientRect());
    const w = (yesBtn.offsetWidth * yesScale) / 2;
    const hh = (yesBtn.offsetHeight * yesScale) / 2;
    return { left: x - w, right: x + w, top: y - hh, bottom: y + hh };
  }

  function place(x, y) {
    noBtn.style.left = `${x - (noBtn.offsetWidth * (1 - scale)) / 2}px`;
    noBtn.style.top = `${y - (noBtn.offsetHeight * (1 - scale)) / 2}px`;
    noBtn.style.transform = `scale(${scale})`;
  }

  function pick(from) {
    const { w: vw, h: vh } = viewport();
    const w = noBtn.offsetWidth * scale;
    const hgt = noBtn.offsetHeight * scale;
    const avoid = grow(yesRect(), GAP);
    const maxX = Math.max(MARGIN, vw - w - MARGIN);
    const maxY = Math.max(MARGIN, vh - hgt - MARGIN);
    const ok = (x, y) => {
      const r = { left: x, top: y, right: x + w, bottom: y + hgt };
      if (overlaps(r, avoid)) return false;
      return !(pointer && overlaps(r, grow({ left: pointer.x, right: pointer.x, top: pointer.y, bottom: pointer.y }, NEAR + 30)));
    };
    let best = null;
    for (let i = 0; i < 40; i++) {
      const x = MARGIN + Math.random() * (maxX - MARGIN);
      const y = MARGIN + Math.random() * (maxY - MARGIN);
      if (!ok(x, y)) continue;
      const dist = Math.hypot(x - from.left, y - from.top);
      if (dist > Math.min(vw, vh) * 0.25) return { x, y };
      if (!best || dist > best.dist) best = { x, y, dist };
    }
    if (best) return best;
    const corners = [[MARGIN, MARGIN], [maxX, MARGIN], [MARGIN, maxY], [maxX, maxY]];
    return corners.map(([x, y]) => ({ x, y })).find(({ x, y }) => ok(x, y)) || { x: MARGIN, y: MARGIN };
  }

  function ghost(rect) {
    const yes = yesBtn.getBoundingClientRect();
    const pad = Math.max(yes.width, yes.height) * 0.45;
    if (rect.left < yes.right + pad && rect.right > yes.left - pad && rect.top < yes.bottom + pad && rect.bottom > yes.top - pad) return;
    const g = noBtn.cloneNode(true);
    const w = noBtn.offsetWidth;
    const hgt = noBtn.offsetHeight;
    const k = rect.width / w;
    const { x, y } = center(rect);
    g.removeAttribute('id');
    g.setAttribute('aria-hidden', 'true');
    g.tabIndex = -1;
    g.classList.add('runaway-ghost');
    g.style.cssText = `position:fixed;left:${x - w / 2}px;top:${y - hgt / 2}px;width:${w}px;height:${hgt}px;margin:0;pointer-events:none;z-index:19`;
    document.body.append(g);
    g.animate([{ opacity: 0.3, transform: `scale(${k})` }, { opacity: 0, transform: `scale(${k * 0.8})` }], { duration: 160, easing: 'ease-out', fill: 'forwards' })
      .finished.then(() => g.remove(), () => g.remove());
  }

  function animateDash(old, prevScale) {
    const now = noBtn.getBoundingClientRect();
    const a = center(old);
    const b = center(now);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = Math.abs(dx) / dist;
    const uy = Math.abs(dy) / dist;
    const stretch = (k) => `scale(${scale * (1 + k * ux - (k / 3) * uy)}, ${scale * (1 + k * uy - (k / 3) * ux)})`;
    noBtn.classList.add('is-dashing');
    const current = noBtn.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${prevScale})` },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.3}px) ${stretch(0.45)}`, offset: 0.3 },
      { transform: `translate(${-dx * 0.02}px, ${-dy * 0.02}px) ${stretch(-0.1)}`, offset: 0.75 },
      { transform: `scale(${scale})` },
    ], { duration: DASH_MS, easing: EASE });
    dash = current;
    const blur = blurNode();
    const max = Math.min(8, dist / 30);
    const tick = () => {
      if (dash !== current) return;
      const p = Math.min(1, (current.currentTime || 0) / (DASH_MS * 0.7));
      const k = max * (1 - p) ** 2;
      blur.setAttribute('stdDeviation', `${(k * ux).toFixed(2)} ${(k * uy).toFixed(2)}`);
      if (current.playState !== 'finished' && current.playState !== 'idle') requestAnimationFrame(tick);
    };
    tick();
    const end = () => { if (dash === current) noBtn.classList.remove('is-dashing'); };
    current.finished.then(end, end);
  }

  function dodge(e) {
    if (e) {
      if (e.cancelable && e.type !== 'focus' && e.type !== 'pointermove') e.preventDefault();
      const t = e.touches?.[0] || e;
      if (typeof t.clientX === 'number') pointer = { x: t.clientX, y: t.clientY };
    }
    const now = performance.now();
    if (now - last < 90) return;
    last = now;
    count += 1;
    const old = noBtn.getBoundingClientRect();
    const prevScale = dash?.playState === 'running' ? old.width / noBtn.offsetWidth : scale;
    dash?.cancel();
    dash = null;
    const motion = !reducedMotion();
    if (motion) ghost(old);
    scale = Math.max(0.35, scale * 0.8);
    const yesScale = Math.min(1.8, 1 + count * 0.08);
    yesBtn.dataset.scale = String(yesScale);
    yesBtn.style.transform = `scale(${yesScale})`;
    if (labels.length && count >= labelAfter) {
      noBtn.textContent = labels[(count - labelAfter) % labels.length];
    }
    if (!noBtn.classList.contains('is-running')) {
      noBtn.classList.add('is-running');
      Object.assign(noBtn.style, { position: 'fixed', margin: '0', zIndex: '20', transformOrigin: '50% 50%' });
      document.body.append(noBtn);
    }
    const { x, y } = pick(old);
    place(x, y);
    if (motion) animateDash(old, prevScale);
    onDodge(count);
  }

  function block(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    dodge(e);
  }

  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') block(e);
  }

  function near(e) {
    if (e.pointerType === 'touch') return;
    const r = grow(noBtn.getBoundingClientRect(), NEAR);
    if (e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) dodge(e);
  }

  function clamp() {
    if (!noBtn.classList.contains('is-running')) return;
    const { w: vw, h: vh } = viewport();
    const r = noBtn.getBoundingClientRect();
    if (r.right > vw - MARGIN || r.bottom > vh - MARGIN || overlaps(r, grow(yesRect(), GAP))) {
      const { x, y } = pick(r);
      place(x, y);
    }
  }

  const events = [
    ['pointerenter', dodge], ['pointerdown', block], ['touchstart', block], ['mousedown', block],
    ['focus', dodge], ['click', block], ['keydown', onKey],
  ];
  for (const [type, fn] of events) noBtn.addEventListener(type, fn, { passive: false });
  document.addEventListener('pointermove', near);
  window.addEventListener('resize', clamp);

  return () => {
    for (const [type, fn] of events) noBtn.removeEventListener(type, fn);
    document.removeEventListener('pointermove', near);
    window.removeEventListener('resize', clamp);
    dash?.cancel();
    if (noBtn.classList.contains('is-running')) noBtn.remove();
  };
}
