// -----------------------------------------------------------------------------
// Signing in to the Whisker account: AWS Cognito, user pool of the Whisker app.
//
// - login: InitiateAuth (USER_SRP_AUTH) then RespondToAuthChallenge
//   (PASSWORD_VERIFIER), see src/whisker/srp.js;
// - refresh: InitiateAuth (REFRESH_TOKEN_AUTH), no password involved.
//
// Two plain JSON calls to the public Cognito endpoint, no AWS credentials:
// the app client has no secret. The pool and client ids are the public ones
// of the Whisker app, as pylitterbot (MIT) publishes them.
// -----------------------------------------------------------------------------

import { createSrpSession } from './srp.js';
import { ERROR_KINDS, WhiskerError, defaultRequest, parseJson } from './http.js';

const decode = (value) => Buffer.from(value, 'base64').toString('utf8');

export const COGNITO = Object.freeze({
  region: 'us-east-1',
  poolId: decode('dXMtZWFzdC0xX3JqaE5uWlZBbQ=='),
  clientId: decode('NDU1MnVqZXUzYWljOTBuZjhxbjUzbGV2bW4='),
  url: 'https://cognito-idp.us-east-1.amazonaws.com/',
});

// Cognito error types (`__type`), by what the user can do about them.
const AUTH_ERRORS = new Set([
  'NotAuthorizedException',
  'UserNotFoundException',
  'UserNotConfirmedException',
  'PasswordResetRequiredException',
]);
const RATE_ERRORS = new Set(['TooManyRequestsException', 'LimitExceededException']);

/** The claims of a JWT (no signature check: the token comes from Cognito over TLS). */
export function jwtClaims(token) {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new WhiskerError(ERROR_KINDS.API, 'Cognito: unreadable token');
  }
}

async function call(request, target, payload) {
  const url = COGNITO.url;
  const answer = await request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(payload),
  });
  if (answer.status >= 500) {
    throw new WhiskerError(ERROR_KINDS.UNREACHABLE, `Cognito: HTTP ${answer.status}`);
  }
  const data = parseJson(url, answer);
  if (answer.status >= 400) {
    // "__type" may carry a namespace: "com.amazonaws...#NotAuthorizedException".
    const type = String(data.__type ?? '')
      .split('#')
      .pop();
    // Cognito's messages never echo the password; kept short anyway.
    const reason = `${type || `HTTP ${answer.status}`}`;
    if (AUTH_ERRORS.has(type)) {
      throw new WhiskerError(ERROR_KINDS.AUTH, `Cognito refused the sign-in (${reason})`);
    }
    if (RATE_ERRORS.has(type)) {
      throw new WhiskerError(ERROR_KINDS.RATE_LIMIT, `Cognito throttles the sign-in (${reason})`);
    }
    throw new WhiskerError(ERROR_KINDS.API, `Cognito: ${reason}`);
  }
  return data;
}

/** Tokens out of an AuthenticationResult; `refreshToken` kept when not renewed. */
function tokensOf(result, previousRefreshToken) {
  if (!result?.IdToken || !result?.AccessToken) {
    throw new WhiskerError(ERROR_KINDS.API, 'Cognito: no token in the answer');
  }
  const claims = jwtClaims(result.IdToken);
  return {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken ?? previousRefreshToken ?? null,
    expiresAt: typeof claims.exp === 'number' ? claims.exp * 1000 : Date.now() + 3_600_000,
    // The Whisker user id ("mid" claim), the key of the LR3 and LR4 queries.
    userId: claims.mid !== undefined ? String(claims.mid) : null,
  };
}

/**
 * Sign in with the e-mail and the password.
 * @param {{ email: string, password: string, request?: Function, now?: () => number }} options
 */
export async function login({ email, password, request = defaultRequest, now = Date.now }) {
  const srp = createSrpSession();
  const first = await call(request, 'InitiateAuth', {
    AuthFlow: 'USER_SRP_AUTH',
    ClientId: COGNITO.clientId,
    AuthParameters: { USERNAME: email, SRP_A: srp.largeA },
  });
  if (first.ChallengeName !== 'PASSWORD_VERIFIER') {
    throw new WhiskerError(
      ERROR_KINDS.API,
      `Cognito: unexpected challenge ${first.ChallengeName ?? '(none)'}`,
    );
  }
  const responses = srp.respond({
    poolId: COGNITO.poolId,
    challenge: first.ChallengeParameters ?? {},
    username: email,
    password,
    now: new Date(now()),
  });
  const second = await call(request, 'RespondToAuthChallenge', {
    ChallengeName: 'PASSWORD_VERIFIER',
    ClientId: COGNITO.clientId,
    ChallengeResponses: responses,
  });
  if (second.ChallengeName) {
    // SMS_MFA, SOFTWARE_TOKEN_MFA, NEW_PASSWORD_REQUIRED: the app must be used first.
    throw new WhiskerError(
      ERROR_KINDS.MFA,
      `Cognito asks for ${second.ChallengeName}: finish it in the Whisker app`,
    );
  }
  return tokensOf(second.AuthenticationResult);
}

/**
 * New id and access tokens from the refresh token (valid for weeks).
 * @param {{ refreshToken: string, request?: Function }} options
 */
export async function refresh({ refreshToken, request = defaultRequest }) {
  const answer = await call(request, 'InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: COGNITO.clientId,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  return tokensOf(answer.AuthenticationResult, refreshToken);
}
