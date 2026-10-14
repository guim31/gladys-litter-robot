// -----------------------------------------------------------------------------
// The Whisker client against the fake cloud: Cognito sign-in (a real SRP
// exchange), refresh, the three APIs, the 401 retry, and the errors the user
// can act on. Never the password nor a token in an error message.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WhiskerClient } from '../src/whisker/client.js';
import { login, refresh, jwtClaims } from '../src/whisker/cognito.js';
import { ERROR_KINDS } from '../src/whisker/http.js';
import { EMAIL, FakeWhisker, PASSWORD, USER_ID } from './helpers/fakeWhisker.js';

const client = (cloud, options = {}) =>
  new WhiskerClient({ email: EMAIL, password: PASSWORD, request: cloud.request, ...options });

test('the right password signs in, and the token carries the Whisker user id', async () => {
  const cloud = new FakeWhisker();
  const tokens = await login({ email: EMAIL, password: PASSWORD, request: cloud.request });
  assert.equal(tokens.userId, USER_ID);
  assert.ok(tokens.refreshToken);
  assert.ok(tokens.expiresAt > Date.now());
  assert.equal(jwtClaims(tokens.idToken).mid, USER_ID);
  assert.equal(cloud.logins, 1);
});

test('the e-mail is not case sensitive', async () => {
  const cloud = new FakeWhisker();
  const tokens = await login({
    email: EMAIL.toUpperCase(),
    password: PASSWORD,
    request: cloud.request,
  });
  assert.equal(tokens.userId, USER_ID);
});

test('a wrong password or an unknown account is an auth error, without the password', async () => {
  const cloud = new FakeWhisker();
  for (const [email, password] of [
    [EMAIL, 'wrong-password'],
    ['nobody@example.com', PASSWORD],
  ]) {
    await assert.rejects(login({ email, password, request: cloud.request }), (err) => {
      assert.equal(err.kind, ERROR_KINDS.AUTH);
      assert.ok(!err.message.includes(password));
      return true;
    });
  }
});

test('a second factor or a new password asked by Cognito is reported as such', async () => {
  const cloud = new FakeWhisker();
  const request = async (url, options) => {
    const answer = await cloud.request(url, options);
    if (options.headers['X-Amz-Target']?.endsWith('RespondToAuthChallenge')) {
      return { status: 200, body: JSON.stringify({ ChallengeName: 'SOFTWARE_TOKEN_MFA' }) };
    }
    return answer;
  };
  await assert.rejects(login({ email: EMAIL, password: PASSWORD, request }), {
    kind: ERROR_KINDS.MFA,
  });
});

test('Cognito throttling and outages have their own kinds', async () => {
  const throttled = async () => ({
    status: 400,
    body: JSON.stringify({ __type: 'com.amazonaws#TooManyRequestsException' }),
  });
  await assert.rejects(login({ email: EMAIL, password: PASSWORD, request: throttled }), {
    kind: ERROR_KINDS.RATE_LIMIT,
  });
  const down = async () => ({ status: 503, body: '' });
  await assert.rejects(login({ email: EMAIL, password: PASSWORD, request: down }), {
    kind: ERROR_KINDS.UNREACHABLE,
  });
  const html = async () => ({ status: 200, body: '<html>' });
  await assert.rejects(login({ email: EMAIL, password: PASSWORD, request: html }), {
    kind: ERROR_KINDS.API,
  });
});

test('the refresh token renews the id token, and keeps itself', async () => {
  const cloud = new FakeWhisker();
  const first = await login({ email: EMAIL, password: PASSWORD, request: cloud.request });
  const second = await refresh({ refreshToken: first.refreshToken, request: cloud.request });
  assert.notEqual(second.idToken, first.idToken);
  assert.equal(second.refreshToken, first.refreshToken);
  await assert.rejects(refresh({ refreshToken: 'revoked', request: cloud.request }), {
    kind: ERROR_KINDS.AUTH,
  });
});

test('saved tokens are refreshed, not replaced by a password sign-in', async () => {
  const cloud = new FakeWhisker();
  const saved = await login({ email: EMAIL, password: PASSWORD, request: cloud.request });
  const c = client(cloud, { tokens: { ...saved, expiresAt: 0 } });
  await c.listLitterRobot4();
  assert.equal(cloud.logins, 1, 'no new password sign-in');
  assert.equal(cloud.refreshes, 1);
});

test('a revoked refresh token falls back to the password', async () => {
  const cloud = new FakeWhisker();
  const c = client(cloud, {
    tokens: { idToken: 'x', refreshToken: 'revoked', expiresAt: 0, userId: USER_ID },
  });
  await c.listFeederRobots();
  assert.equal(cloud.logins, 1);
});

test('the three families are listed with their API, and every new token is handed over', async () => {
  const cloud = new FakeWhisker();
  const saved = [];
  const c = client(cloud, { onTokens: (tokens) => saved.push(tokens) });
  assert.equal((await c.listLitterRobot3())[0].litterRobotSerial, 'LR3C012345');
  assert.equal((await c.listLitterRobot4())[0].serial, 'LR4C000001');
  assert.equal((await c.listFeederRobots())[0].serial, 'RF1C000001');
  assert.equal(saved.length, 1, 'one sign-in for the three calls');
  const lr3 = cloud.requests.find((r) => r.url.endsWith(`/users/${USER_ID}/robots`));
  assert.ok(lr3.headers['x-api-key'], 'the LR3 API needs the app key');
  assert.match(lr3.headers.authorization, /^Bearer /);
  const feeder = cloud.requests.find((r) => r.body?.query?.includes('feeder_unit'));
  assert.match(feeder.body.query, /_gte: "\d{4}-\d{2}-\d{2}T/, 'feedings of the last 24 h only');
});

test('an expired token met by a 401 is renewed and the call retried once', async () => {
  const cloud = new FakeWhisker();
  const c = client(cloud);
  await c.listLitterRobot4();
  cloud.idTokens.clear(); // the cloud forgets the token
  assert.equal((await c.listLitterRobot4()).length, 1);
  assert.equal(cloud.refreshes, 1);
});

test('commands reach the right API with the right payload', async () => {
  const cloud = new FakeWhisker();
  const c = client(cloud);
  await c.lr3Command('a0123b4567cd8e', 'C');
  await c.lr3Command('a0123b4567cd8e', 'WF');
  await c.lr4Command('LR4C000001', 'setClumpTime', { clumpTime: 15 });
  await c.feederCommand('RF1C000001', 'giveSnack', true);
  assert.deepEqual(
    cloud.commands.map(({ family, command, value }) => [family, command, value]),
    [
      ['lr3', 'C', undefined],
      ['lr3', 'WF', undefined],
      ['lr4', 'setClumpTime', '{"clumpTime":15}'],
      ['feeder', 'giveSnack', 1],
    ],
  );
  const feeder = cloud.requests.find((r) => r.url.includes('/command/feeder'));
  assert.ok(feeder.headers['x-api-key']);
  assert.ok(feeder.body.id, 'each feeder command has its own id');
});

test('a refused LR3 command and a GraphQL error are API errors', async () => {
  const cloud = new FakeWhisker();
  const c = client(cloud);
  await assert.rejects(c.lr3Command('a0123b4567cd8e', 'Z9'), (err) => {
    assert.equal(err.kind, ERROR_KINDS.API);
    assert.match(err.message, /InvalidCommandException/);
    return true;
  });
  await assert.rejects(c.lr4Command('LR4C999999', 'cleanCycle'), { kind: ERROR_KINDS.API });
});

test('a cloud that does not answer is unreachable', async () => {
  const cloud = new FakeWhisker();
  cloud.online = false;
  await assert.rejects(client(cloud).listLitterRobot3(), { kind: ERROR_KINDS.UNREACHABLE });
});
