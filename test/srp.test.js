// -----------------------------------------------------------------------------
// The Cognito SRP math against pycognito, the implementation pylitterbot and
// Home Assistant rely on: same public value A, same claim signature, for a
// fixed secret, server value and clock (test/fixtures/cognito).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cognitoTimestamp, createSrpSession, modPow, padHex } from '../src/whisker/srp.js';

const vectors = JSON.parse(
  await readFile(new URL('./fixtures/cognito/srp-vectors.json', import.meta.url), 'utf8'),
);

test('the SRP exchange signs the claim exactly like pycognito', () => {
  const session = createSrpSession({ smallA: BigInt(`0x${vectors.smallA}`) });
  assert.equal(session.largeA, vectors.largeA);
  const response = session.respond({
    poolId: 'us-east-1_TestPool1',
    challenge: {
      USER_ID_FOR_SRP: 'abc-user-id',
      USERNAME: 'abc-user-id',
      SALT: vectors.salt,
      SRP_B: vectors.srpB,
      SECRET_BLOCK: vectors.secretBlock,
    },
    username: 'cat@example.com',
    password: 'hunter2',
    now: new Date(Date.UTC(2026, 9, 4, 8, 5, 9)),
  });
  assert.deepEqual(response, vectors.response);
});

test('a wrong password gives another signature', () => {
  const session = createSrpSession({ smallA: BigInt(`0x${vectors.smallA}`) });
  const response = session.respond({
    poolId: 'us-east-1_TestPool1',
    challenge: {
      USER_ID_FOR_SRP: 'abc-user-id',
      SALT: vectors.salt,
      SRP_B: vectors.srpB,
      SECRET_BLOCK: vectors.secretBlock,
    },
    username: 'cat@example.com',
    password: 'hunter3',
    now: new Date(Date.UTC(2026, 9, 4, 8, 5, 9)),
  });
  assert.notEqual(response.PASSWORD_CLAIM_SIGNATURE, vectors.response.PASSWORD_CLAIM_SIGNATURE);
});

test('helpers: hex padding, modular power, Cognito timestamp', () => {
  assert.equal(padHex(0xabn), '00ab');
  assert.equal(padHex(0x1abn), '01ab');
  assert.equal(padHex(0x7fn), '7f');
  assert.equal(padHex('9f3a1c'), '009f3a1c');
  assert.equal(modPow(4n, 13n, 497n), 445n);
  assert.equal(modPow(-3n, 3n, 7n), 1n); // (-27) mod 7, never negative
  assert.equal(
    cognitoTimestamp(new Date(Date.UTC(2026, 9, 4, 8, 5, 9))),
    'Sun Oct 4 08:05:09 UTC 2026',
  );
  assert.equal(
    cognitoTimestamp(new Date(Date.UTC(2026, 11, 25, 23, 0, 0))),
    'Fri Dec 25 23:00:00 UTC 2026',
  );
});

test('a session draws a new secret every time', () => {
  assert.notEqual(createSrpSession().largeA, createSrpSession().largeA);
});
