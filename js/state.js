export const SCREENS = ['question', 'places', 'datetime', 'email', 'sending', 'done', 'error'];
const STEPS = ['question', 'places', 'datetime', 'email', 'sending', 'done'];

export function createFlow(onChange = () => {}) {
  const state = { screen: 'question', placeIndex: null, date: null, time: null, guest: '', result: null };
  const emit = () => onChange(state);
  const flow = {
    state,
    go(screen) {
      if (!SCREENS.includes(screen)) throw new Error(`unknown screen: ${screen}`);
      state.screen = screen;
      emit();
    },
    next() {
      const i = STEPS.indexOf(state.screen);
      if (i >= 0 && i < STEPS.length - 1) flow.go(STEPS[i + 1]);
    },
    back() {
      const i = STEPS.indexOf(state.screen);
      if (i > 0 && i <= STEPS.indexOf('email')) flow.go(STEPS[i - 1]);
    },
    set(patch) {
      Object.assign(state, patch);
      emit();
    },
  };
  return flow;
}
