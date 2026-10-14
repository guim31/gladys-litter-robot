// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never the password, the e-mail nor a token, even
// at debug. (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD } from './helpers/fakeWhisker.js';
import { CONFIG, createAll, createWorld, settle } from './helpers/world.js';

/** Capture the lines of the SDK logger at the given level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return { lines, clear: () => lines.splice(0), texts: () => lines.map((line) => line.text) };
}

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

/** Everything secret the integration ever held. */
function secrets(w) {
  const tokens = [...w.cloud.idTokens.keys(), ...w.cloud.refreshTokens];
  return [PASSWORD, CONFIG.email, ...tokens];
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(logs.texts().some((text) => /Whisker account connected: 3 robot/.test(text)));
  await createAll(w);
  logs.clear();
  for (let i = 0; i < 5; i += 1) {
    w.cloud.lr4[0].DFILevelPercent += 1;
    w.cloud.lr4[0].odometerCleanCycles += 1; // a visit seen through the counter
    await w.hub.readAll({ discover: i === 4 });
  }
  assert.deepEqual(logs.texts(), []);
});

test('an outage of the cloud is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.cloud.online = false;
  for (let i = 0; i < 5; i += 1) {
    await w.hub.readAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  w.cloud.online = true;
  await w.hub.readAll();
  await w.hub.readAll();
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^.*\] /, '')),
    ['Whisker account: connection restored'],
  );
});

test('a user command is one info line; a fault is one line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  const ids = w.gladys.externalIds('litter-robot', 'LR4C000001');
  await w.fake.setValue({ external_id: ids.device }, { external_id: ids.feature('clean') }, 1);
  w.cloud.lr4[0].isOnline = false;
  await w.hub.readAll();
  await w.hub.readAll();
  const texts = logs.texts().map((text) => text.replace(/^.*\] /, ''));
  assert.deepEqual(texts, ['Litter-Robot 4: cleaning started', 'Litter-Robot 4: Robot offline']);
});

test('a refused password is logged once, without the password', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: { ...CONFIG, password: 'wrong-password' } });
  await w.fake.action('test_connection', {});
  await w.fake.action('test_connection', {});
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.ok(!logs.texts().join('\n').includes('wrong-password'));
});

test('LOG_LEVEL=debug shows the details, never a secret', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, { live: true });
  await createAll(w);
  const socket = w.sockets.find((s) => s.url.includes('lr4'));
  socket.open();
  socket.receive({ type: 'error' });
  await settle();
  w.cloud.online = false;
  await w.hub.readAll();
  await w.hub.readAll();
  w.cloud.online = true;
  await w.hub.readAll();
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\]/);
  for (const secret of secrets(w)) {
    assert.ok(!text.includes(secret), `a secret leaked: ${secret.slice(0, 6)}…`);
  }
});
