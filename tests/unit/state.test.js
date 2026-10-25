import test from 'node:test';
import assert from 'node:assert/strict';
import { SCREENS, createFlow } from '../../js/state.js';

test('SCREENS', () => {
  assert.deepEqual(SCREENS, ['question', 'places', 'datetime', 'email', 'sending', 'done', 'error']);
});

test('initial state and forward flow', () => {
  const seen = [];
  const f = createFlow((s) => seen.push(s.screen));
  assert.deepEqual(f.state, { screen: 'question', placeIndex: null, date: null, time: null, guest: '', result: null });
  for (let i = 0; i < 5; i++) f.next();
  assert.deepEqual(seen, ['places', 'datetime', 'email', 'sending', 'done']);
  f.next();
  assert.equal(f.state.screen, 'done');
});

test('back goes one step, not from first, sending or done', () => {
  const f = createFlow();
  f.back();
  assert.equal(f.state.screen, 'question');
  f.go('email');
  f.back();
  assert.equal(f.state.screen, 'datetime');
  f.go('sending');
  f.back();
  assert.equal(f.state.screen, 'sending');
  f.go('done');
  f.back();
  assert.equal(f.state.screen, 'done');
});

test('go rejects unknown screens and accepts error', () => {
  const f = createFlow();
  assert.throws(() => f.go('nope'));
  f.go('error');
  assert.equal(f.state.screen, 'error');
});

test('set patches state and notifies', () => {
  let calls = 0;
  const f = createFlow(() => calls++);
  f.set({ placeIndex: 2, guest: 'g@example.com' });
  assert.equal(f.state.placeIndex, 2);
  assert.equal(f.state.guest, 'g@example.com');
  assert.equal(calls, 1);
});
