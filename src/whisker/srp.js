// -----------------------------------------------------------------------------
// AWS Cognito Secure Remote Password (USER_SRP_AUTH): the math only.
//
// The Whisker account lives in an AWS Cognito user pool whose app client only
// accepts the SRP flow (the one of the Whisker app and of pylitterbot, through
// pycognito). Rather than pulling the AWS SDK into a 256 MB sandbox, the few
// big-number steps are written here with BigInt and node:crypto, following
// pycognito's aws_srp.py (Apache-2.0) line by line. test/srp.test.js checks
// them against vectors computed by pycognito itself.
// -----------------------------------------------------------------------------

import { createHash, createHmac, randomBytes } from 'node:crypto';

// RFC 5054 3072-bit group, the one of amazon-cognito-identity-js.
export const N_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64' +
  'ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
  'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B' +
  'F12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
  'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31' +
  '43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF';
const G_HEX = '2';

export const N = BigInt(`0x${N_HEX}`);
export const G = BigInt(`0x${G_HEX}`);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex');
export const hexHash = (hex) => sha256Hex(Buffer.from(hex, 'hex'));
const toBig = (hex) => BigInt(`0x${hex}`);

/** a^b mod m, for non-negative b. */
export function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = ((base % modulus) + modulus) % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % modulus;
    }
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

/**
 * Hex of a positive integer (or hex string), padded so that it reads as a
 * positive two's-complement number: an odd length gets a leading 0, a
 * leading digit 8-f gets 00 (pycognito's pad_hex).
 */
export function padHex(value) {
  let hex = typeof value === 'string' ? value : value.toString(16);
  if (hex.length % 2 === 1) {
    hex = `0${hex}`;
  } else if ('89abcdefABCDEF'.includes(hex[0])) {
    hex = `00${hex}`;
  }
  return hex;
}

// k = H(00 N | 0 g), exactly as pycognito builds it.
export const K = toBig(hexHash(`00${N_HEX}0${G_HEX}`));

export function hkdf(ikm, salt) {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  const info = Buffer.concat([Buffer.from('Caldera Derived Key', 'utf8'), Buffer.from([1])]);
  return createHmac('sha256', prk).update(info).digest().subarray(0, 16);
}

/** The date Cognito expects in the claim: "Tue Oct 14 08:05:09 UTC 2026" (day not padded). */
export function cognitoTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ` +
    `UTC ${date.getUTCFullYear()}`
  );
}

/**
 * One SRP session: a random secret `a`, its public value `A`, and the answer
 * to the PASSWORD_VERIFIER challenge.
 * @param {object} [options]
 * @param {bigint} [options.smallA] fixed secret (tests only)
 */
export function createSrpSession({ smallA } = {}) {
  const a = smallA ?? toBig(randomBytes(128).toString('hex')) % N;
  const A = modPow(G, a, N);
  if (A % N === 0n) {
    throw new Error('SRP safety check failed');
  }

  return {
    /** SRP_A of InitiateAuth. */
    largeA: A.toString(16),

    /**
     * The 16-byte key both sides derive from the password.
     * @param {string} poolName the part of the pool id after "_"
     * @param {string} userId USER_ID_FOR_SRP of the challenge
     * @param {string} password
     * @param {string} srpBHex SRP_B of the challenge
     * @param {string} saltHex SALT of the challenge
     */
    authenticationKey(poolName, userId, password, srpBHex, saltHex) {
      const B = toBig(srpBHex);
      if (B % N === 0n) {
        throw new Error('SRP safety check failed');
      }
      const u = toBig(hexHash(padHex(A) + padHex(B)));
      if (u === 0n) {
        throw new Error('SRP: U cannot be zero');
      }
      const userPasswordHash = sha256Hex(Buffer.from(`${poolName}${userId}:${password}`, 'utf8'));
      const x = toBig(hexHash(padHex(saltHex) + userPasswordHash));
      const base = B - K * modPow(G, x, N);
      const S = modPow(base, a + u * x, N);
      return hkdf(Buffer.from(padHex(S), 'hex'), Buffer.from(padHex(u.toString(16)), 'hex'));
    },

    /**
     * The ChallengeResponses of RespondToAuthChallenge (PASSWORD_VERIFIER).
     * @param {object} options
     * @param {string} options.poolId e.g. us-east-1_xxxxxxxxx
     * @param {Record<string, string>} options.challenge ChallengeParameters
     * @param {string} options.username as sent to InitiateAuth
     * @param {string} options.password
     * @param {Date} [options.now]
     */
    respond({ poolId, challenge, username, password, now = new Date() }) {
      const poolName = poolId.split('_')[1];
      const userId = challenge.USER_ID_FOR_SRP;
      const timestamp = cognitoTimestamp(now);
      const key = this.authenticationKey(
        poolName,
        userId,
        password,
        challenge.SRP_B,
        challenge.SALT,
      );
      const secretBlock = Buffer.from(challenge.SECRET_BLOCK, 'base64');
      const message = Buffer.concat([
        Buffer.from(poolName, 'utf8'),
        Buffer.from(userId, 'utf8'),
        secretBlock,
        Buffer.from(timestamp, 'utf8'),
      ]);
      return {
        TIMESTAMP: timestamp,
        USERNAME: challenge.USERNAME ?? username,
        PASSWORD_CLAIM_SECRET_BLOCK: challenge.SECRET_BLOCK,
        PASSWORD_CLAIM_SIGNATURE: createHmac('sha256', key).update(message).digest('base64'),
      };
    },
  };
}
