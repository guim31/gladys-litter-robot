// -----------------------------------------------------------------------------
// Live updates: the Litter-Robot 4 AppSync subscription and the Feeder-Robot
// Hasura subscription (graphql-ws), on fake WebSockets. An update is
// published without any reading; a silent or closed connection is opened
// again; the LR3 has none.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENDPOINTS } from '../src/whisker/client.js';
import { createSubscription } from '../src/whisker/realtime.js';
import { USER_ID, createFakeSockets, fixture } from './helpers/fakeWhisker.js';
import { createAll, createWorld, feederId, lr4Id, settle } from './helpers/world.js';

async function liveWorld(t) {
  const w = await createWorld({ live: true });
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

const socketFor = (w, prefix) => w.sockets.findLast((s) => s.url.startsWith(prefix) && !s.closed);

test('the LR4 subscription: token in the URL and the start message, updates published at once', async (t) => {
  const w = await liveWorld(t);
  const socket = socketFor(w, ENDPOINTS.LR4_REALTIME);
  assert.ok(socket, 'a socket to AppSync');
  assert.deepEqual(socket.protocols, ['graphql-ws']);
  const header = JSON.parse(
    Buffer.from(decodeURIComponent(new URL(socket.url).searchParams.get('header')), 'base64'),
  );
  assert.match(header.Authorization, /^Bearer /);
  assert.equal(header.host, 'lr4.iothings.site');

  socket.open();
  await settle();
  const [start] = socket.sent;
  assert.equal(start.type, 'start');
  const data = JSON.parse(start.payload.data);
  assert.match(data.query, /litterRobot4StateSubscriptionByUser/);
  assert.deepEqual(data.variables, { userId: USER_ID });
  socket.receive({ type: 'start_ack', id: start.id });

  const reads = w.cloud.readCount();
  const robot = { ...fixture('lr4-robot-pylitterbot'), DFILevelPercent: 42 };
  socket.receive({
    type: 'data',
    id: start.id,
    payload: { data: { litterRobot4StateSubscriptionByUser: { robots: [robot] } } },
  });
  await settle();
  assert.equal(w.fake.lastState(lr4Id(w.gladys).feature('waste_drawer')), 42);
  assert.equal(w.cloud.readCount(), reads, 'no reading needed');

  // A robot the hub does not know (yet) is ignored until the next discovery.
  socket.receive({
    type: 'data',
    payload: {
      data: {
        litterRobot4StateSubscriptionByUser: { robots: [{ ...robot, serial: 'LR4C999999' }] },
      },
    },
  });
  await settle();
  assert.ok(!w.hub.records.has('LR4C999999'));

  const report = await w.fake.action('test_connection', {});
  assert.match(report.data.message.en, /Litter-Robot 4: Ready \(live updates\)/);
  assert.match(report.data.message.en, /Test \(Litter-Robot 3\): Ready \(read every few minutes\)/);
});

test('a cat visit seen live fires the trigger', async (t) => {
  const w = await liveWorld(t);
  const socket = socketFor(w, ENDPOINTS.LR4_REALTIME);
  socket.open();
  const robot = { ...fixture('lr4-robot-pylitterbot'), robotStatus: 'ROBOT_CAT_DETECT_DELAY' };
  socket.receive({
    type: 'data',
    payload: { data: { litterRobot4StateSubscriptionByUser: { robots: [robot] } } },
  });
  await settle();
  assert.equal(w.fake.sceneEvents.filter((e) => e.key === 'cat_visited').length, 1);
});

test('the Feeder subscription: connection_init with the token, one start per feeder', async (t) => {
  const w = await liveWorld(t);
  const socket = socketFor(w, ENDPOINTS.FEEDER_REALTIME);
  socket.open();
  await settle();
  const [init, start] = socket.sent;
  assert.equal(init.type, 'connection_init');
  assert.match(init.payload.headers.Authorization, /^Bearer /);
  assert.equal(start.type, 'start');
  assert.deepEqual(start.payload.variables, { id: 1 });
  const feeder = fixture('feeder-robot');
  feeder.state.info.level = 9;
  socket.receive({ type: 'data', id: start.id, payload: { data: { feeder_unit_by_pk: feeder } } });
  await settle();
  assert.equal(w.fake.lastState(feederId(w.gladys).feature('food_level')), 100);
});

test('no live connection for a Litter-Robot 3 alone', async (t) => {
  const { FakeWhisker } = await import('./helpers/fakeWhisker.js');
  const cloud = new FakeWhisker({ lr4: [], feeders: [] });
  const w = await createWorld({ cloud, live: true });
  t.after(() => w.app.stop());
  assert.equal(w.sockets.length, 0);
});

test('a refused, closed or silent subscription is opened again, later each time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { WebSocketImpl, sockets } = createFakeSockets();
  const states = [];
  const client = { idToken: async () => 'token', userId: USER_ID };
  const subscription = createSubscription({
    family: 'lr4',
    client,
    WebSocketImpl,
    timings: { staleMs: 60_000, retryMinMs: 1_000, retryMaxMs: 4_000 },
    onRobots: () => {},
    onState: (family, live, reason) => states.push([live, reason ?? null]),
  });
  subscription.start();
  await settle();
  assert.equal(sockets.length, 1);
  sockets[0].open();
  sockets[0].receive({ type: 'start_ack' });
  assert.equal(subscription.live, true);

  sockets[0].receive({ type: 'error', payload: { errors: [{ message: 'Unauthorized' }] } });
  assert.equal(subscription.live, false);
  t.mock.timers.tick(1_000);
  await settle();
  assert.equal(sockets.length, 2, 'opened again after 1 s');

  sockets[1].open();
  t.mock.timers.tick(60_000); // silent: not even a keep-alive
  await settle();
  t.mock.timers.tick(2_000);
  await settle();
  assert.equal(sockets.length, 3, 'opened again after 2 s');

  sockets[2].open();
  sockets[2].receive({ type: 'ka' });
  sockets[2].close();
  t.mock.timers.tick(4_000);
  await settle();
  assert.equal(sockets.length, 4, 'capped at 4 s');

  subscription.stop();
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(sockets.length, 4, 'stopped for good');
  assert.deepEqual(states[0], [true, null]);
});

test('a partial live update is merged with what the robot reported before', async (t) => {
  const w = await liveWorld(t);
  const socket = socketFor(w, ENDPOINTS.LR4_REALTIME);
  socket.open();
  socket.receive({
    type: 'data',
    payload: {
      data: {
        litterRobot4StateSubscriptionByUser: {
          robots: [{ serial: 'LR4C000001', DFILevelPercent: 55 }],
        },
      },
    },
  });
  await settle();
  const ids = lr4Id(w.gladys);
  assert.equal(w.fake.lastState(ids.feature('waste_drawer')), 55);
  assert.equal(w.fake.lastState(ids.feature('status')), 'Ready', 'still online');
  assert.equal(w.fake.lastState(ids.feature('litter_level')), 40);
});
