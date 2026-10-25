import { reducedMotion } from './dom.js';

const SRC = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1/dist/confetti.browser.min.js';
let loading;

function load() {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.confetti ? resolve(window.confetti) : reject(new Error('confetti')));
    s.onerror = () => reject(new Error('confetti'));
    document.head.append(s);
  });
  return loading;
}

export async function celebrate() {
  if (reducedMotion()) return;
  try {
    const confetti = await load();
    const colors = ['#e5486a', '#8e1b3f', '#f3c77a', '#f7a8b8', '#ffffff'];
    const shoot = (x, angle) => confetti({ particleCount: 70, spread: 70, angle, origin: { x, y: 0.75 }, colors, scalar: 0.9, disableForReducedMotion: true });
    shoot(0.1, 60);
    shoot(0.9, 120);
    setTimeout(() => confetti({ particleCount: 90, spread: 110, origin: { y: 0.35 }, colors, shapes: ['circle'], scalar: 0.8 }), 300);
  } catch {
    /* decorative only */
  }
}
