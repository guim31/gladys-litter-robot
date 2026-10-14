// -----------------------------------------------------------------------------
// The hub against the fake cloud: scene events on transitions, commands of
// the device rows, the anti-loop limit of the Feeder-Robot, sign-in errors,
// tokens kept under /data, robots added or removed from the account.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeWhisker, PASSWORD } from './helpers/fakeWhisker.js';
import {
  CONFIG,
  createAll,
  createClock,
  createWorld,
  feederId,
  lr3Id,
  lr4Id,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);
const feature = (w, ids, key) => ({ external_id: ids.feature(key) });
const setValue = (w, ids, key, value) =>
  w.fake.setValue({ external_id: ids.device }, feature(w, ids, key), value);

test('starts: devices published, connection status connected, nothing sent before "Add"', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.discoveredDevices.length, 3);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.states.length, 0, 'Gladys drops the states of devices not added');
  await createAll(w);
  assert.ok(w.fake.states.length >= 20);
  assert.equal(w.fake.lastState(lr4Id(w.gladys).feature('waste_drawer')), 91);
});

test('a cat visit: the countdown before cleaning, with the weight and the count of the day', async (t) => {
  const w = await world(t);
  await createAll(w);
  const robot = w.cloud.lr4[0];
  robot.robotStatus = 'ROBOT_CAT_DETECT';
  await w.hub.readAll();
  robot.robotStatus = 'ROBOT_CAT_DETECT_DELAY';
  await w.hub.readAll();
  await w.hub.readAll(); // still timing: no second event
  robot.robotStatus = 'ROBOT_CLEAN';
  robot.odometerCleanCycles += 1;
  await w.hub.readAll(); // the cycle of this visit: not another one
  const visits = events(w, 'cat_visited');
  assert.equal(visits.length, 1);
  assert.deepEqual(visits[0].data, {
    device: lr4Id(w.gladys).device,
    robot: 'Litter-Robot 4',
    weight_kg: 3.6,
    weight_lb: 7.93,
    visits_today: 1,
  });
  const lastVisit = w.fake.lastState(lr4Id(w.gladys).feature('last_visit'));
  assert.match(lastVisit, /Oct 14/);

  robot.robotStatus = 'ROBOT_CAT_DETECT_DELAY';
  await w.hub.readAll();
  assert.equal(events(w, 'cat_visited')[1].data.visits_today, 2);
});

test('a visit missed between two readings is found by the cycle counter (Litter-Robot 3)', async (t) => {
  const w = await world(t);
  const robot = w.cloud.lr3[0];
  robot.cycleCount = '16';
  await w.hub.readAll();
  const [visit] = events(w, 'cat_visited');
  assert.equal(visit.data.robot, 'Test');
  assert.equal(visit.data.weight_kg, null, 'no scale on a LR3');
  assert.equal(visit.data.visits_today, 1);
});

test('a cleaning started by Gladys is not a visit', async (t) => {
  const w = await world(t);
  await createAll(w);
  await setValue(w, lr3Id(w.gladys), 'clean', 1);
  w.cloud.lr3[0].cycleCount = '16';
  await w.hub.readAll();
  assert.equal(events(w, 'cat_visited').length, 0);
});

test('the visits of the day are counted again after midnight', async (t) => {
  const clock = createClock(new Date(2026, 9, 14, 23, 50).getTime());
  const w = await world(t, { clock });
  const robot = w.cloud.lr4[0];
  robot.robotStatus = 'ROBOT_CAT_DETECT_DELAY';
  await w.hub.readAll();
  robot.robotStatus = 'ROBOT_IDLE';
  await w.hub.readAll();
  clock.advance(20 * 60_000);
  robot.robotStatus = 'ROBOT_CAT_DETECT_DELAY';
  await w.hub.readAll();
  assert.deepEqual(
    events(w, 'cat_visited').map((e) => e.data.visits_today),
    [1, 1],
  );
});

test('drawer full: once per filling, never at start', async (t) => {
  const cloud = new FakeWhisker();
  cloud.lr4[0].isDFIFull = true;
  const w = await world(t, { cloud });
  assert.equal(events(w, 'drawer_full').length, 0, 'already full at start: no event');
  cloud.lr4[0].isDFIFull = false;
  await w.hub.readAll();
  cloud.lr4[0].isDFIFull = true;
  cloud.lr4[0].DFILevelPercent = 100;
  await w.hub.readAll();
  await w.hub.readAll();
  const full = events(w, 'drawer_full');
  assert.equal(full.length, 1);
  assert.deepEqual(full[0].data, {
    device: lr4Id(w.gladys).device,
    robot: 'Litter-Robot 4',
    drawer_level: 100,
  });
});

test('errors: one event per new fault, in the configured language', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'fr' } });
  w.cloud.lr3[0].unitStatus = 'OTF';
  await w.hub.readAll();
  await w.hub.readAll();
  w.cloud.lr3[0].unitStatus = 'RDY';
  await w.hub.readAll();
  w.cloud.feeders[0].state.info.motorJammed = true;
  await w.hub.readAll();
  w.cloud.lr4[0].isOnline = false;
  await w.hub.readAll();
  assert.deepEqual(
    events(w, 'robot_error').map((e) => [e.data.robot, e.data.kind, e.data.message]),
    [
      ['Test', 'motor', 'Défaut du moteur du globe'],
      ['Feeder-Robot', 'feeder_jam', 'Moteur du distributeur bloqué'],
      ['Litter-Robot 4', 'offline', 'Robot hors ligne'],
    ],
  );
});

test('an offline robot is shown unreachable', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.lr4[0].isOnline = false;
  await w.hub.readAll();
  const entry = w.fake.transports.findLast((e) => e.device_external_id === lr4Id(w.gladys).device);
  assert.equal(entry.transport, 'unreachable');
  assert.equal(w.fake.lastState(lr4Id(w.gladys).feature('status')), 'Offline');
});

test('device rows: every command reaches its robot, and the state follows at once', async (t) => {
  const w = await world(t);
  await createAll(w);
  const lr3 = lr3Id(w.gladys);
  const lr4 = lr4Id(w.gladys);
  const feeder = feederId(w.gladys);

  const acks = [
    await setValue(w, lr3, 'clean', 1),
    await setValue(w, lr3, 'wait_time', '15'),
    await setValue(w, lr3, 'night_light', 0),
    await setValue(w, lr3, 'panel_lock', 1),
    await setValue(w, lr4, 'clean', 1),
    await setValue(w, lr4, 'wait_time', '30'),
    await setValue(w, lr4, 'night_light_mode', 'ON'),
    await setValue(w, lr4, 'panel_lock', 1),
    await setValue(w, feeder, 'auto_night_light', 0),
    await setValue(w, feeder, 'panel_lock', 1),
    await setValue(w, feeder, 'snack', 1),
  ];
  assert.deepEqual(
    acks.filter((ack) => !ack.success),
    [],
  );
  assert.deepEqual(
    w.cloud.commands.map(
      (c) => `${c.family}:${c.command}${c.value === undefined ? '' : `=${c.value}`}`,
    ),
    [
      'lr3:C',
      'lr3:WF',
      'lr3:N0',
      'lr3:L1',
      'lr4:cleanCycle',
      'lr4:setClumpTime={"clumpTime":30}',
      'lr4:nightLightModeOn',
      'lr4:keyPadLockOutOn',
      'feeder:setAutoNightMode=0',
      'feeder:setPanelLockout=1',
      'feeder:giveSnack=1',
    ],
  );
  assert.equal(w.fake.lastState(lr3.feature('wait_time')), '15');
  assert.equal(w.fake.lastState(lr3.feature('night_light')), 0);
  assert.equal(w.fake.lastState(lr4.feature('night_light_mode')), 'ON');
  assert.equal(w.fake.lastState(lr4.feature('panel_lock')), 1);
  assert.equal(w.fake.lastState(feeder.feature('auto_night_light')), 0);
});

test('a delay the model does not accept, or a read-only feature, is refused', async (t) => {
  const w = await world(t);
  await createAll(w);
  assert.equal((await setValue(w, lr3Id(w.gladys), 'wait_time', '25')).success, false);
  assert.equal((await setValue(w, lr4Id(w.gladys), 'night_light_mode', 'DISCO')).success, false);
  assert.equal((await setValue(w, lr4Id(w.gladys), 'waste_drawer', 0)).success, false);
  assert.equal(w.cloud.commands.length, 0);
});

test('no cleaning while a cat is detected, nor on an offline robot', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'es' } });
  await createAll(w);
  w.cloud.lr4[0].displayCode = 'DC_CAT_DETECT';
  await w.hub.readAll();
  const ack = await setValue(w, lr4Id(w.gladys), 'clean', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Hay un gato/);
  w.cloud.lr3[0].powerStatus = 'NC';
  await w.hub.readAll();
  assert.equal((await setValue(w, lr3Id(w.gladys), 'clean', 1)).success, false);
  assert.equal(w.cloud.commands.length, 0);
});

test('reset drawer: Litter-Robot 3 only, counters back to zero', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ack = await setValue(w, lr3Id(w.gladys), 'reset_drawer', 1);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.cloud.commands[0].patch, {
    cycleCount: 0,
    cycleCapacity: 30,
    cyclesAfterDrawerFull: 0,
  });
  assert.equal(w.fake.lastState(lr3Id(w.gladys).feature('waste_drawer')), 0);
  assert.equal(w.fake.lastState(lr3Id(w.gladys).feature('drawer_cycles')), 0);
  await assert.rejects(w.hub.resetDrawer(lr4Id(w.gladys).device), /Litter-Robot 4 measures/);
});

test('portions: the daily limit and the minute between two hold, across a restart', async (t) => {
  const clock = createClock();
  const cloud = new FakeWhisker({ now: clock.now });
  const options = { clock, cloud, config: { ...CONFIG, snack_daily_limit: '2' } };
  const w = await createWorld(options);
  const id = feederId(w.gladys).device;
  assert.deepEqual(await w.hub.dispenseSnack(id), { dispensed: true, remaining: 1, reason: null });
  const tooSoon = await w.hub.dispenseSnack(id);
  assert.equal(tooSoon.dispensed, false);
  clock.advance(61_000);
  assert.equal((await w.hub.dispenseSnack(id)).dispensed, true);
  clock.advance(61_000);
  await w.app.stop();

  // Restarted: the limit is still reached.
  const again = await createWorld({ ...options, dataDir: w.dataDir });
  t.after(() => again.app.stop());
  const refused = await again.hub.dispenseSnack(id);
  assert.equal(refused.dispensed, false);
  assert.match(refused.reason.en, /2 portion/);
  clock.advance(24 * 3_600_000);
  assert.equal((await again.hub.dispenseSnack(id)).dispensed, true, 'a day later');
  assert.equal(cloud.commandsOf('feeder').length, 3);
});

test('a refused password: said in the configuration screen, not retried on a timer', async (t) => {
  const w = await world(t, { config: { ...CONFIG, password: 'wrong-password', language: 'en' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /refused/);
  const attempts = w.cloud.requests.length;
  await w.hub.readAll();
  await w.hub.readAll();
  assert.equal(w.cloud.requests.length, attempts, 'no new attempt');

  // The user fixes the password: signs in at once.
  await w.fake.configUpdated({ ...CONFIG, password: PASSWORD });
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.discoveredDevices.length, 3);
});

test('"Test the connection" tries again after a refused password', async (t) => {
  const w = await world(t, { config: { ...CONFIG, password: 'wrong-password' } });
  w.cloud.addUser(CONFIG.email, 'wrong-password', '000000'); // fixed on the Whisker side
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /Connected to Whisker: 3 robot/);
});

test('without credentials: asks for them, reads nothing', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /e-mail and password/);
  assert.equal(w.cloud.requests.length, 0);
  assert.deepEqual(w.fake.discoveredDevices, []);
});

test('a throttled account waits before trying again', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  const original = w.cloud.request;
  w.cloud.request = async () => ({ status: 429, body: '{}' });
  w.hub.client.request = w.cloud.request;
  await w.hub.readAll();
  w.hub.client.request = original;
  const before = w.cloud.requests.length;
  await w.hub.readAll();
  assert.equal(w.cloud.requests.length, before, 'still waiting');
  clock.advance(16 * 60_000);
  await w.hub.readAll();
  assert.ok(w.cloud.requests.length > before);
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('tokens are kept under /data (mode 600): a restart refreshes them, no password sign-in', async (t) => {
  const clock = createClock();
  const cloud = new FakeWhisker({ now: clock.now });
  const first = await createWorld({ clock, cloud });
  await first.app.stop();
  const file = join(first.dataDir, 'litter-robot.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const saved = await readFile(file, 'utf8');
  assert.ok(!saved.includes(PASSWORD), 'never the password');
  assert.ok(!saved.includes(CONFIG.email), 'not even the e-mail');

  clock.advance(2 * 3_600_000); // the id token expired
  const second = await createWorld({ clock, cloud, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(cloud.logins, 1);
  assert.equal(cloud.refreshes, 1);
  assert.equal(second.fake.connectionStatus.connected, true);

  // Another account: the saved tokens are not used.
  cloud.addUser('other@example.com', 'other-password', '000000');
  await second.fake.configUpdated({
    ...CONFIG,
    email: 'other@example.com',
    password: 'other-password',
  });
  assert.equal(cloud.logins, 2);
});

test('a robot added to the account appears at the next discovery, a removed one goes', async (t) => {
  const clock = createClock();
  const cloud = new FakeWhisker({ now: clock.now, feeders: [] });
  const w = await world(t, { clock, cloud });
  assert.equal(w.fake.discoveredDevices.length, 2);
  cloud.lr3 = [];
  await w.hub.readAll(); // the families known only
  assert.equal(w.fake.discoveredDevices.length, 2);
  await w.fake.scanRequest();
  assert.equal(w.fake.discoveredDevices.length, 1);
  cloud.feeders = [
    structuredClone((await import('./helpers/fakeWhisker.js')).fixture('feeder-robot')),
  ];
  await w.fake.scanRequest();
  assert.deepEqual(
    w.fake.discoveredDevices.map((d) => d.name),
    ['Litter-Robot 4', 'Feeder-Robot'],
  );
});

test('a device added in Gladys gets its states at once, and its badge', async (t) => {
  const w = await world(t);
  const device = w.fake.discoveredDevices.find((d) => d.external_id === lr4Id(w.gladys).device);
  await w.fake.deviceCreated(device);
  assert.equal(w.fake.lastState(lr4Id(w.gladys).feature('litter_level')), 40);
  assert.equal(w.fake.lastState(lr3Id(w.gladys).feature('waste_drawer')), undefined);
  assert.ok(w.fake.transports.some((e) => e.device_external_id === device.external_id));
  assert.ok(w.fake.widgetRefreshes.includes('litter_robot'));
});

test('unchanged values are not sent again; the language of the states follows the config', async (t) => {
  const w = await world(t);
  await createAll(w);
  const count = w.fake.states.length;
  await w.hub.readAll();
  await w.hub.readAll();
  assert.equal(w.fake.states.length, count, 'deduplicated');
  await w.fake.configUpdated({ ...CONFIG, language: 'de' });
  assert.equal(w.fake.lastState(lr4Id(w.gladys).feature('status')), 'Bereit');
});

test('a Gladys that polls anyway reads the family, unless just read', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  await createAll(w);
  const before = w.cloud.readCount();
  await w.fake.poll({ external_id: lr4Id(w.gladys).device });
  assert.equal(w.cloud.readCount(), before, 'read moments ago');
  clock.advance(3 * 60_000);
  w.cloud.lr4[0].DFILevelPercent = 95;
  await w.fake.poll({ external_id: lr4Id(w.gladys).device });
  assert.equal(w.cloud.readCount(), before + 1, 'that family only');
  assert.equal(w.fake.lastState(lr4Id(w.gladys).feature('waste_drawer')), 95);
});

test('a Whisker outage: unreachable badges, status, then back', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.online = false;
  await w.hub.readAll();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  assert.ok(w.fake.transports.slice(-3).every((e) => e.transport === 'unreachable'));
  w.cloud.online = true;
  await w.hub.readAll();
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.ok(w.fake.transports.slice(-3).every((e) => e.transport === 'cloud'));
});
