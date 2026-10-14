// -----------------------------------------------------------------------------
// The Whisker cloud, as the Whisker app and pylitterbot (MIT, natekspencer)
// use it. Three families, three APIs, one Cognito id token:
//
//   Litter-Robot 3 Connect  REST    v2.api.whisker.iothings.site (+ x-api-key)
//   Litter-Robot 4          GraphQL lr4.iothings.site/graphql
//   Feeder-Robot            GraphQL cognito.hasura.iothings.site (Hasura),
//                           commands on an API Gateway (+ x-api-key)
//
// The tokens live in /data (src/store.js): a restart refreshes them instead of
// signing in again with the password. A 401 refreshes the token and retries
// once. Nothing here logs: errors are thrown as WhiskerError, without token
// nor password, and the hub decides what to say.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { login, refresh } from './cognito.js';
import { ERROR_KINDS, WhiskerError, defaultRequest, parseJson } from './http.js';

const decode = (value) => Buffer.from(value, 'base64').toString('utf8');

export const ENDPOINTS = Object.freeze({
  LR3: 'https://v2.api.whisker.iothings.site',
  LR4: 'https://lr4.iothings.site/graphql',
  LR4_REALTIME: 'wss://lr4.iothings.site/graphql/realtime',
  FEEDER: 'https://cognito.hasura.iothings.site/v1/graphql',
  FEEDER_REALTIME: 'wss://cognito.hasura.iothings.site/v1/graphql',
  FEEDER_COMMAND: 'https://42nk7qrhdg.execute-api.us-east-1.amazonaws.com/prod/command/feeder',
});

// Public keys of the Whisker app, as pylitterbot publishes them (base64).
const LR3_API_KEY = decode('cDduZE1vajYxbnBSWlA1Q1Z6OXY0VWowYkc3Njl4eTY3NThRUkJQYg==');
const FEEDER_API_KEY = decode('dzJ0UEZiamxQMTNHVW1iOGRNalVMNUIyWXlQVkQzcEo3RXk2Zno4dg==');

export const FAMILIES = Object.freeze({ LR3: 'lr3', LR4: 'lr4', FEEDER: 'feeder' });

// Refresh the id token this long before it expires (it lives one hour).
const EXPIRY_MARGIN_MS = 2 * 60_000;

const SLEEP_DAY = '{ sleepTime wakeTime isEnabled }';

// The fields pylitterbot reads (robot/models.py), the ones this integration uses.
export const LITTER_ROBOT_4_MODEL = `{
  unitId name serial userId espFirmware wifiRssi unitPowerType catWeight displayCode
  unitTimezone cleanCycleWaitTime isKeypadLockout nightLightMode nightLightBrightness
  weekdaySleepModeEnabled {
    Sunday ${SLEEP_DAY} Monday ${SLEEP_DAY} Tuesday ${SLEEP_DAY} Wednesday ${SLEEP_DAY}
    Thursday ${SLEEP_DAY} Friday ${SLEEP_DAY} Saturday ${SLEEP_DAY}
  }
  unitPowerStatus sleepStatus robotStatus globeMotorFaultStatus pinchStatus catDetect
  isBonnetRemoved odometerCleanCycles DFINumberOfCycles DFILevelPercent isDFIFull
  DFIFullCounter litterLevel robotCycleStatus robotCycleState weightSensor isOnline
  isOnboarded lastSeen setupDateTime isLaserDirty hopperStatus isHopperRemoved
  litterLevelPercentage litterLevelState
}`;

/** The feeder model, its feedings limited to the last 24 hours (pylitterbot's filter). */
export function feederRobotModel(now = Date.now()) {
  const since = new Date(now - 24 * 3_600_000).toISOString();
  const filter = `(order_by: { timestamp: desc }, where: { _and: [
    { status: { _eq: dispensed } } { timestamp: { _gte: "${since}" } } ] })`;
  return `{
    id name serial timezone isEighthCupEnabled created_at household_id
    state { id info updated_at active_schedule { id name meals created_at } }
    feeding_snack ${filter} { timestamp amount }
    feeding_meal ${filter} { timestamp amount meal_name meal_number meal_total_portions }
  }`;
}

// LR3 commands (dispatch-commands, prefixed with "<").
export const LR3_COMMANDS = Object.freeze({
  CLEAN: 'C',
  LOCK_ON: 'L1',
  LOCK_OFF: 'L0',
  NIGHT_LIGHT_ON: 'N1',
  NIGHT_LIGHT_OFF: 'N0',
  WAIT_TIME: 'W', // + the minutes in hexadecimal: W3, W7, WF
});

export const LR4_COMMANDS = Object.freeze({
  CLEAN: 'cleanCycle',
  LOCK_ON: 'keyPadLockOutOn',
  LOCK_OFF: 'keyPadLockOutOff',
  NIGHT_LIGHT: { OFF: 'nightLightModeOff', ON: 'nightLightModeOn', AUTO: 'nightLightModeAuto' },
  WAIT_TIME: 'setClumpTime', // value: {"clumpTime": minutes}
});

export const FEEDER_COMMANDS = Object.freeze({
  SNACK: 'giveSnack',
  NIGHT_LIGHT: 'setAutoNightMode',
  LOCK: 'setPanelLockout',
});

export class WhiskerClient {
  /**
   * @param {object} options
   * @param {string} options.email
   * @param {string} options.password
   * @param {object|null} [options.tokens] tokens saved by a previous run
   * @param {(tokens: object|null) => void} [options.onTokens] called on every new token
   * @param {Function} [options.request] HTTP seam (src/whisker/http.js)
   * @param {() => number} [options.now]
   */
  constructor({ email, password, tokens = null, onTokens = () => {}, request, now }) {
    this.email = email;
    this.password = password;
    this.tokens = tokens;
    this.onTokens = onTokens;
    this.request = request ?? defaultRequest;
    this.now = now ?? (() => Date.now());
    this.signingIn = null;
  }

  get userId() {
    return this.tokens?.userId ?? null;
  }

  /** Sign in (refresh token first, password otherwise). Concurrent callers share it. */
  signIn({ force = false } = {}) {
    this.signingIn ??= this.doSignIn(force).finally(() => {
      this.signingIn = null;
    });
    return this.signingIn;
  }

  async doSignIn(force) {
    if (!force && this.tokens?.refreshToken) {
      try {
        this.setTokens(
          await refresh({ refreshToken: this.tokens.refreshToken, request: this.request }),
        );
        return;
      } catch (err) {
        if (err.kind !== ERROR_KINDS.AUTH && err.kind !== ERROR_KINDS.API) {
          throw err; // network: the refresh token may still be good
        }
        // Revoked or expired refresh token: sign in again below.
      }
    }
    this.setTokens(
      await login({
        email: this.email,
        password: this.password,
        request: this.request,
        now: this.now,
      }),
    );
  }

  setTokens(tokens) {
    this.tokens = tokens;
    this.onTokens(tokens);
  }

  /** A valid id token, renewed when it is about to expire. */
  async idToken() {
    if (!this.tokens?.idToken || this.tokens.expiresAt - this.now() < EXPIRY_MARGIN_MS) {
      await this.signIn();
    }
    if (!this.userId) {
      throw new WhiskerError(ERROR_KINDS.API, 'Cognito: no Whisker user id in the token');
    }
    return this.tokens.idToken;
  }

  /** Authenticated request; a 401 renews the token and retries once. */
  async send(url, { method = 'GET', headers = {}, json } = {}, retried = false) {
    const token = await this.idToken();
    const answer = await this.request(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const host = new URL(url).host;
    if (answer.status === 401 || answer.status === 403) {
      if (!retried) {
        this.tokens = { ...this.tokens, expiresAt: 0 };
        return this.send(url, { method, headers, json }, true);
      }
      throw new WhiskerError(ERROR_KINDS.AUTH, `${host}: HTTP ${answer.status}`);
    }
    if (answer.status === 429) {
      throw new WhiskerError(ERROR_KINDS.RATE_LIMIT, `${host}: HTTP 429`);
    }
    if (answer.status >= 400) {
      // The LR3 API answers a refused command with a 500 InvalidCommandException.
      let detail = '';
      try {
        const data = JSON.parse(answer.body);
        detail = typeof (data.type ?? data.message) === 'string' ? (data.type ?? data.message) : '';
      } catch {
        // not JSON: the status says enough
      }
      const kind = answer.status >= 500 && !detail ? ERROR_KINDS.UNREACHABLE : ERROR_KINDS.API;
      throw new WhiskerError(
        kind,
        `${host}: HTTP ${answer.status}${detail ? ` ${detail.slice(0, 80)}` : ''}`,
      );
    }
    return answer.body === '' ? null : parseJson(url, answer);
  }

  /** A GraphQL query; GraphQL errors become WhiskerError. */
  async graphql(url, query, variables, retried = false) {
    const data = await this.send(url, { method: 'POST', json: { query, variables } });
    const errors = Array.isArray(data?.errors) ? data.errors : [];
    if (errors.length > 0) {
      const message = errors.map((error) => error?.message ?? '').join(', ');
      if (/unauthori[sz]ed|jwt|token/i.test(message) && !retried) {
        this.tokens = { ...this.tokens, expiresAt: 0 };
        return this.graphql(url, query, variables, true);
      }
      throw new WhiskerError(ERROR_KINDS.API, `${new URL(url).host}: ${message.slice(0, 200)}`);
    }
    return data?.data ?? {};
  }

  // --- Reading -----------------------------------------------------------------

  /** Litter-Robot 3 Connect robots of the account (raw REST objects). */
  async listLitterRobot3() {
    const userId = await this.userIdReady();
    const data = await this.send(`${ENDPOINTS.LR3}/users/${encodeURIComponent(userId)}/robots`, {
      headers: { 'x-api-key': LR3_API_KEY },
    });
    return Array.isArray(data) ? data.filter((robot) => robot && typeof robot === 'object') : [];
  }

  /** Litter-Robot 4 robots of the account (raw GraphQL objects). */
  async listLitterRobot4() {
    const userId = await this.userIdReady();
    const data = await this.graphql(
      ENDPOINTS.LR4,
      `query GetLR4($userId: String!) { getLitterRobot4ByUser(userId: $userId) ${LITTER_ROBOT_4_MODEL} }`,
      { userId },
    );
    const robots = data.getLitterRobot4ByUser;
    return Array.isArray(robots)
      ? robots.filter((robot) => robot && typeof robot === 'object')
      : [];
  }

  /** Feeder-Robots of the account (raw Hasura objects). */
  async listFeederRobots() {
    const data = await this.graphql(
      ENDPOINTS.FEEDER,
      `query GetFeeders { feeder_unit ${feederRobotModel(this.now())} }`,
    );
    const robots = data.feeder_unit;
    return Array.isArray(robots)
      ? robots.filter((robot) => robot && typeof robot === 'object')
      : [];
  }

  /** One family's list, by FAMILIES key. */
  list(family) {
    switch (family) {
      case FAMILIES.LR3:
        return this.listLitterRobot3();
      case FAMILIES.LR4:
        return this.listLitterRobot4();
      case FAMILIES.FEEDER:
        return this.listFeederRobots();
      default:
        throw new Error(`Unknown family ${family}`);
    }
  }

  async userIdReady() {
    await this.idToken();
    return this.userId;
  }

  // --- Commands -------------------------------------------------------------------

  /** LR3: one dispatch command ("C", "L1", "W7"...). */
  async lr3Command(robotId, command) {
    const userId = await this.userIdReady();
    await this.send(
      `${ENDPOINTS.LR3}/users/${encodeURIComponent(userId)}/robots/${encodeURIComponent(robotId)}/dispatch-commands`,
      {
        method: 'POST',
        headers: { 'x-api-key': LR3_API_KEY },
        json: { command: `<${command}` },
      },
    );
  }

  /** LR3: change stored values (the drawer counters); answers the robot. */
  async lr3Patch(robotId, values) {
    const userId = await this.userIdReady();
    return this.send(
      `${ENDPOINTS.LR3}/users/${encodeURIComponent(userId)}/robots/${encodeURIComponent(robotId)}`,
      { method: 'PATCH', headers: { 'x-api-key': LR3_API_KEY }, json: values },
    );
  }

  /** LR4: one command, with its optional JSON value. */
  async lr4Command(serial, command, value) {
    const data = await this.graphql(
      ENDPOINTS.LR4,
      `mutation sendCommand($serial: String!, $command: String!, $value: String, $commandSource: String) {
        sendLitterRobot4Command(input: { serial: $serial, command: $command, value: $value, commandSource: $commandSource })
      }`,
      {
        serial,
        command,
        ...(value === undefined ? {} : { value: JSON.stringify(value) }),
      },
    );
    const answer = data.sendLitterRobot4Command;
    if (typeof answer === 'string' && answer.includes('Error')) {
      throw new WhiskerError(ERROR_KINDS.API, `lr4.iothings.site: ${answer.slice(0, 200)}`);
    }
  }

  /** Feeder: one command (giveSnack, setPanelLockout...). */
  async feederCommand(serial, command, value) {
    await this.send(ENDPOINTS.FEEDER_COMMAND, {
      method: 'POST',
      headers: { 'x-api-key': FEEDER_API_KEY },
      json: { command, id: randomUUID(), serial, value: value ? 1 : 0 },
    });
  }
}
