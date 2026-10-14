// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys never polls a device published
// with should_poll: false (and never polls the devices created without
// should_poll, GladysAssistant/Gladys#3198): the robots must be read by the
// hub's own timer, with no onPoll at all.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, createAll, createClock, createWorld, lr3Id, settle } from './helpers/world.js';

test('the internal timer reads the robots without any onPoll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const w = await createWorld({ clock, config: { ...CONFIG, refresh_minutes: '2' }, timers: true });
  t.after(() => w.app.stop());
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);
  assert.ok(
    w.fake.discoveredDevices.every((d) => d.should_poll === false),
    'Gladys is not asked to poll',
  );

  const before = w.cloud.readCount();
  for (const cycles of [16, 17, 18]) {
    w.cloud.lr3[0].cycleCount = String(cycles);
    clock.advance(2 * 60_000);
    t.mock.timers.tick(2 * 60_000);
    await settle();
    assert.equal(w.fake.lastState(lr3Id(w.gladys).feature('drawer_cycles')), cycles);
  }
  assert.equal(w.cloud.readCount() - before, 9, 'three families, once per interval');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('every family is listed again once an hour, only the known ones in between', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const { FakeWhisker } = await import('./helpers/fakeWhisker.js');
  const cloud = new FakeWhisker({ now: clock.now, lr3: [], feeders: [] });
  const w = await createWorld({
    clock,
    cloud,
    config: { ...CONFIG, refresh_minutes: '15' },
    timers: true,
  });
  t.after(() => w.app.stop());
  const before = w.cloud.readCount();
  for (let i = 0; i < 4; i += 1) {
    clock.advance(15 * 60_000);
    t.mock.timers.tick(15 * 60_000);
    await settle();
  }
  // 3 cycles of the LR4 only, then the hourly discovery of the three families.
  assert.equal(w.cloud.readCount() - before, 3 + 3);
});

test('a command is followed by a reading a few seconds later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await createWorld({ timers: true });
  t.after(() => w.app.stop());
  await createAll(w);
  await w.fake.setValue(
    { external_id: lr3Id(w.gladys).device },
    { external_id: lr3Id(w.gladys).feature('clean') },
    1,
  );
  const before = w.cloud.readCount();
  t.mock.timers.tick(15_000);
  await settle();
  assert.equal(w.cloud.readCount(), before + 1, 'the LR3 family only');
  assert.equal(w.fake.lastState(lr3Id(w.gladys).feature('status')), 'Cleaning in progress');
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await createWorld({ timers: true });
  await w.app.stop();
  const before = w.cloud.requests.length;
  t.mock.timers.tick(60 * 60_000);
  await settle();
  assert.equal(w.cloud.requests.length, before);
});
