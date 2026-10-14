// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Whisker cloud, fake
// WebSockets, a temporary /data and a manual clock, with the integration
// wired on top through registerHandlers. No timer runs unless
// `timers: true` (with node:test mock timers): the tests read the cloud with
// `world.hub.readAll()`. (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { EMAIL, FakeWhisker, PASSWORD, createFakeSockets } from './fakeWhisker.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const CONFIG = { email: EMAIL, password: PASSWORD, language: 'en' };

/** A manual clock, shared by the hub and the fake cloud. */
export function createClock(start = Date.UTC(2026, 9, 14, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {FakeWhisker} [options.cloud]
 * @param {boolean} [options.connect]
 * @param {boolean} [options.live] give the hub fake WebSockets
 */
export async function createWorld({
  clock = createClock(),
  cloud,
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-litter-robot-')),
  timings = {},
  timers = false,
  live = false,
} = {}) {
  const whisker = cloud ?? new FakeWhisker({ now: clock.now });
  const sockets = createFakeSockets();
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: whisker.request,
    WebSocketImpl: live ? sockets.WebSocketImpl : null,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    cloud: whisker,
    sockets: sockets.sockets,
    app,
    hub: app.hub,
    clock,
    dataDir,
  };
}

export const lr3Id = (gladys, serial = 'LR3C012345') => gladys.externalIds('litter-robot', serial);
export const lr4Id = (gladys, serial = 'LR4C000001') => gladys.externalIds('litter-robot', serial);
export const feederId = (gladys, serial = 'RF1C000001') =>
  gladys.externalIds('feeder-robot', serial);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** Let the pending promises and fake timers settle. */
export const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
