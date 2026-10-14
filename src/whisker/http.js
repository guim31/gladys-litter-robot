// -----------------------------------------------------------------------------
// The one door to the network: a fetch with a timeout, answering
// `{ status, body }` (body as text). The tests replace it with a fake Whisker
// cloud (test/helpers/fakeWhisker.js), so no test ever touches the network.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  AUTH: 'auth', // e-mail or password refused
  MFA: 'mfa', // the account asks for a second factor or a new password
  RATE_LIMIT: 'rate_limit', // too many attempts, Cognito or the API throttles
  UNREACHABLE: 'unreachable', // no answer, DNS, TLS, 5xx
  API: 'api', // an answer the integration does not understand
});

export class WhiskerError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message never a token, never a password
   */
  constructor(kind, message) {
    super(message);
    this.name = 'WhiskerError';
    this.kind = kind;
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function defaultRequest(url, { method = 'GET', headers = {}, body, timeoutMs } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    // The URL is a fixed cloud endpoint: no credential in it, safe to name.
    const reason = err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code ?? err.message);
    throw new WhiskerError(ERROR_KINDS.UNREACHABLE, `${new URL(url).host}: ${reason}`);
  }
  return { status: response.status, body: await response.text() };
}

/** Parse a JSON body, or throw an API error naming the host. */
export function parseJson(url, { status, body }) {
  try {
    return JSON.parse(body);
  } catch {
    throw new WhiskerError(
      ERROR_KINDS.API,
      `${new URL(url).host}: HTTP ${status}, unexpected answer (not JSON)`,
    );
  }
}
