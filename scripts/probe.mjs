#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of the real Whisker cloud, for a machine with internet.
//
//   node scripts/probe.mjs
//       Signs in with a made-up account: Cognito must refuse it cleanly
//       ("auth"), which proves the SRP exchange reaches the right pool.
//
//   WHISKER_EMAIL=… WHISKER_PASSWORD=… node scripts/probe.mjs
//       Signs in with a real account, lists the robots of the three families
//       (model, state, levels), and listens to the live subscriptions for
//       30 seconds. Sends no command. Prints no e-mail, password, token nor
//       serial number.
// -----------------------------------------------------------------------------

import { FAMILIES, WhiskerClient } from '../src/whisker/client.js';
import { parseRobot } from '../src/whisker/model.js';
import { createSubscription } from '../src/whisker/realtime.js';

const LISTEN_MS = 30_000;
const email = process.env.WHISKER_EMAIL ?? `gladys-probe-${Date.now()}@example.com`;
const password = process.env.WHISKER_PASSWORD ?? 'not-a-real-password-1';
const real = Boolean(process.env.WHISKER_EMAIL && process.env.WHISKER_PASSWORD);
const mask = (serial) => `${String(serial).slice(0, 4)}…`;

const client = new WhiskerClient({ email, password });
try {
  await client.signIn({ force: true });
} catch (err) {
  console.log(`sign-in: refused, kind "${err.kind ?? 'unknown'}" (${err.message})`);
  if (!real) {
    console.log(err.kind === 'auth' ? 'OK: a made-up account is cleanly refused.' : 'UNEXPECTED');
    process.exit(err.kind === 'auth' ? 0 : 1);
  }
  process.exit(1);
}
if (!real) {
  console.log('UNEXPECTED: a made-up account was accepted');
  process.exit(1);
}
console.log('sign-in: OK, Whisker user id present:', Boolean(client.userId));

const robots = [];
for (const family of Object.values(FAMILIES)) {
  try {
    const raws = await client.list(family);
    const parsed = raws.map((raw) => parseRobot(family, raw)).filter(Boolean);
    robots.push(...parsed);
    console.log(`${family}: ${raws.length} answer(s), ${parsed.length} robot(s)`);
    for (const robot of parsed) {
      const { serial, name: _name, id: _id, feedings, ...rest } = robot;
      console.log(
        `  ${mask(serial)}`,
        JSON.stringify({ ...rest, feedings: feedings ? feedings.length : undefined }),
      );
    }
  } catch (err) {
    console.log(`${family}: FAILED, kind "${err.kind}" (${err.message})`);
  }
}

const subscriptions = [];
for (const family of [FAMILIES.LR4, FAMILIES.FEEDER]) {
  const ids = robots.filter((r) => r.family === family).map((r) => r.id);
  if (ids.length === 0) continue;
  const subscription = createSubscription({
    family,
    client,
    ids,
    onRobots: (fam, raws) => console.log(`${fam}: live update of ${raws.length} robot(s)`),
    onState: (fam, live, reason) =>
      console.log(`${fam}: live ${live ? 'ON' : 'off'}${reason ? ` (${reason})` : ''}`),
  });
  subscription.start();
  subscriptions.push(subscription);
}
if (subscriptions.length > 0) {
  console.log(`listening ${LISTEN_MS / 1000} s for live updates…`);
  await new Promise((resolve) => setTimeout(resolve, LISTEN_MS));
  for (const subscription of subscriptions) subscription.stop();
}
console.log('done');
