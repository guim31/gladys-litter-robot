// -----------------------------------------------------------------------------
// A fake Whisker cloud behind the HTTP seam of src/whisker/http.js: Cognito
// (a real SRP server side, so a wrong password is refused for real and a
// good one accepted), the Litter-Robot 3 REST API, the Litter-Robot 4 and
// Feeder-Robot GraphQL APIs and the Feeder command API. The robots start as
// the real answers of test/fixtures/whisker, and the commands change them
// like the robots would. No network involved.
// -----------------------------------------------------------------------------

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { COGNITO } from '../../src/whisker/cognito.js';
import { ENDPOINTS } from '../../src/whisker/client.js';
import { ERROR_KINDS, WhiskerError } from '../../src/whisker/http.js';
import { G, K, N, hexHash, hkdf, modPow, padHex, sha256Hex } from '../../src/whisker/srp.js';

export const EMAIL = 'cat.owner@example.com';
export const PASSWORD = 'correct horse battery staple';
export const USER_ID = '000000';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/whisker/${name}.json`, import.meta.url), 'utf8'));

const POOL_NAME = COGNITO.poolId.split('_')[1];
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const toBig = (hex) => BigInt(`0x${hex}`);
const json = (status, body) => ({ status, body: JSON.stringify(body) });
const cognitoError = (type, message) => json(400, { __type: type, message });

export class FakeWhisker {
  /**
   * @param {object} [options]
   * @param {() => number} [options.now] the shared clock
   * @param {object[]} [options.lr3] raw LR3 robots
   * @param {object[]} [options.lr4] raw LR4 robots
   * @param {object[]} [options.feeders] raw Feeder-Robots
   */
  constructor({
    now = () => Date.now(),
    lr3 = [fixture('lr3-robots')[0]],
    lr4 = [fixture('lr4-robot-pylitterbot')],
    feeders = [fixture('feeder-robot')],
  } = {}) {
    this.now = now;
    this.lr3 = structuredClone(lr3);
    this.lr4 = structuredClone(lr4);
    this.feeders = structuredClone(feeders);
    this.online = true;
    this.users = new Map();
    this.addUser(EMAIL, PASSWORD, USER_ID);
    this.srpSessions = new Map();
    this.idTokens = new Map(); // token -> expiry (ms)
    this.refreshTokens = new Set();
    this.counter = 0;
    this.requests = [];
    this.commands = [];
    this.logins = 0;
    this.refreshes = 0;
    this.tokenLifetimeMs = 3_600_000;
    this.request = this.request.bind(this);
  }

  addUser(email, password, userId) {
    const userIdForSrp = `uuid-${userId}`;
    const salt = randomBytes(16).toString('hex');
    const x = toBig(
      hexHash(padHex(salt) + sha256Hex(Buffer.from(`${POOL_NAME}${userIdForSrp}:${password}`))),
    );
    this.users.set(email.toLowerCase(), {
      userId,
      userIdForSrp,
      salt,
      verifier: modPow(G, x, N),
    });
  }

  /** Every request the integration sent, as `{ method, url, body }`. */
  async request(url, { method = 'GET', headers = {}, body } = {}) {
    const parsedBody = body ? JSON.parse(body) : undefined;
    this.requests.push({ method, url, headers, body: parsedBody });
    if (!this.online) {
      throw new WhiskerError(ERROR_KINDS.UNREACHABLE, `${new URL(url).host}: ECONNREFUSED`);
    }
    if (url === COGNITO.url) {
      return this.cognito(headers['X-Amz-Target'], parsedBody);
    }
    const auth = headers.authorization ?? '';
    const token = auth.replace(/^Bearer /, '');
    const expiry = this.idTokens.get(token);
    if (expiry === undefined || expiry <= this.now()) {
      return json(401, { message: 'Unauthorized' });
    }
    return this.api(method, url, headers, parsedBody);
  }

  // --- Cognito ---------------------------------------------------------------

  issueTokens(userId, refreshToken) {
    this.counter += 1;
    const exp = Math.floor((this.now() + this.tokenLifetimeMs) / 1000);
    const idToken = `e30.${b64url({ exp, mid: userId })}.sig${this.counter}`;
    this.idTokens.set(idToken, exp * 1000);
    const fresh = refreshToken ?? `refresh-${randomBytes(8).toString('hex')}`;
    this.refreshTokens.add(fresh);
    return {
      AuthenticationResult: {
        IdToken: idToken,
        AccessToken: `access-${this.counter}`,
        ...(refreshToken ? {} : { RefreshToken: fresh }),
        ExpiresIn: 3600,
        TokenType: 'Bearer',
      },
    };
  }

  cognito(target, body) {
    if (target === 'AWSCognitoIdentityProviderService.InitiateAuth') {
      if (body.ClientId !== COGNITO.clientId) {
        return cognitoError('ResourceNotFoundException', 'User pool client does not exist.');
      }
      if (body.AuthFlow === 'REFRESH_TOKEN_AUTH') {
        const refreshToken = body.AuthParameters.REFRESH_TOKEN;
        if (!this.refreshTokens.has(refreshToken)) {
          return cognitoError('NotAuthorizedException', 'Invalid Refresh Token');
        }
        this.refreshes += 1;
        return json(200, this.issueTokens(USER_ID, refreshToken));
      }
      if (body.AuthFlow !== 'USER_SRP_AUTH') {
        return cognitoError('InvalidParameterException', 'Flow not supported');
      }
      const user = this.users.get(String(body.AuthParameters.USERNAME).toLowerCase());
      if (!user) {
        return cognitoError('UserNotFoundException', 'User does not exist.');
      }
      const b = toBig(randomBytes(32).toString('hex'));
      const B = (K * user.verifier + modPow(G, b, N)) % N;
      const secretBlock = randomBytes(32).toString('base64');
      this.srpSessions.set(secretBlock, { user, b, B, A: toBig(body.AuthParameters.SRP_A) });
      return json(200, {
        ChallengeName: 'PASSWORD_VERIFIER',
        ChallengeParameters: {
          SALT: user.salt,
          SRP_B: B.toString(16),
          SECRET_BLOCK: secretBlock,
          USER_ID_FOR_SRP: user.userIdForSrp,
          USERNAME: user.userIdForSrp,
        },
      });
    }
    if (target === 'AWSCognitoIdentityProviderService.RespondToAuthChallenge') {
      const responses = body.ChallengeResponses;
      const session = this.srpSessions.get(responses.PASSWORD_CLAIM_SECRET_BLOCK);
      if (!session) {
        return cognitoError('NotAuthorizedException', 'Invalid session');
      }
      this.srpSessions.delete(responses.PASSWORD_CLAIM_SECRET_BLOCK);
      const { user, b, B, A } = session;
      const u = toBig(hexHash(padHex(A) + padHex(B)));
      const S = modPow(A * modPow(user.verifier, u, N), b, N);
      const key = hkdf(Buffer.from(padHex(S), 'hex'), Buffer.from(padHex(u.toString(16)), 'hex'));
      const expected = createHmac('sha256', key)
        .update(
          Buffer.concat([
            Buffer.from(POOL_NAME),
            Buffer.from(user.userIdForSrp),
            Buffer.from(responses.PASSWORD_CLAIM_SECRET_BLOCK, 'base64'),
            Buffer.from(responses.TIMESTAMP),
          ]),
        )
        .digest('base64');
      if (expected !== responses.PASSWORD_CLAIM_SIGNATURE) {
        return cognitoError('NotAuthorizedException', 'Incorrect username or password.');
      }
      this.logins += 1;
      return json(200, this.issueTokens(user.userId));
    }
    return cognitoError('UnknownOperationException', 'Unknown operation');
  }

  // --- Whisker APIs --------------------------------------------------------------

  api(method, url, headers, body) {
    if (url.startsWith(ENDPOINTS.LR3)) {
      return this.lr3Api(method, url, headers, body);
    }
    if (url === ENDPOINTS.LR4) {
      return this.lr4Api(body);
    }
    if (url === ENDPOINTS.FEEDER) {
      return this.feederApi(body);
    }
    if (url === ENDPOINTS.FEEDER_COMMAND) {
      if (!headers['x-api-key']) {
        return json(403, { message: 'Forbidden' });
      }
      return this.feederCommand(body);
    }
    return json(404, { message: 'Not found' });
  }

  lr3Api(method, url, headers, body) {
    if (!headers['x-api-key']) {
      return json(403, { message: 'Forbidden' });
    }
    const path = url.slice(ENDPOINTS.LR3.length);
    if (method === 'GET' && path === `/users/${USER_ID}/robots`) {
      return json(200, this.lr3);
    }
    const match = path.match(/^\/users\/[^/]+\/robots\/([^/]+)(\/dispatch-commands)?$/);
    const robot = match && this.lr3.find((r) => r.litterRobotId === match[1]);
    if (!robot) {
      return json(404, { message: 'Robot not found' });
    }
    if (method === 'POST' && match[2]) {
      const command = String(body.command).replace(/^</, '');
      this.commands.push({ family: 'lr3', target: robot.litterRobotId, command });
      if (command === 'C') robot.unitStatus = 'CCP';
      if (command === 'L1' || command === 'L0') robot.panelLockActive = command[1];
      if (command === 'N1' || command === 'N0') robot.nightLightActive = command[1];
      if (command.startsWith('W')) robot.cleanCycleWaitTimeMinutes = command.slice(1);
      if (!/^(C|L[01]|N[01]|W[37F])$/.test(command)) {
        return json(500, {
          type: 'InvalidCommandException',
          developerMessage: `Invalid command: <${command}`,
        });
      }
      return json(200, { _developerMessage: `Command: <${command} posted` });
    }
    if (method === 'PATCH' && !match[2]) {
      this.commands.push({ family: 'lr3', target: robot.litterRobotId, patch: body });
      for (const [key, value] of Object.entries(body)) {
        robot[key] = typeof value === 'number' ? String(value) : value;
      }
      if (body.cycleCount === 0) {
        robot.unitStatus = 'RDY';
        robot.isDFITriggered = '0';
      }
      return json(200, robot);
    }
    return json(405, { message: 'Method not allowed' });
  }

  lr4Api(body) {
    const query = body.query;
    if (query.includes('getLitterRobot4ByUser')) {
      return json(200, { data: { getLitterRobot4ByUser: this.lr4 } });
    }
    if (query.includes('sendLitterRobot4Command')) {
      const { serial, command, value } = body.variables;
      const robot = this.lr4.find((r) => r.serial === serial);
      if (!robot) {
        return json(200, { data: { sendLitterRobot4Command: 'Error: robot not found' } });
      }
      this.commands.push({ family: 'lr4', target: serial, command, value });
      if (command === 'cleanCycle') robot.robotStatus = 'ROBOT_CLEAN';
      if (command === 'keyPadLockOutOn') robot.isKeypadLockout = true;
      if (command === 'keyPadLockOutOff') robot.isKeypadLockout = false;
      if (command.startsWith('nightLightMode')) {
        robot.nightLightMode = command.replace('nightLightMode', '').toUpperCase();
      }
      if (command === 'setClumpTime') robot.cleanCycleWaitTime = JSON.parse(value).clumpTime;
      return json(200, { data: { sendLitterRobot4Command: 'command sent' } });
    }
    return json(200, { errors: [{ message: 'Unknown query' }] });
  }

  feederApi(body) {
    if (body.query.includes('feeder_unit')) {
      return json(200, { data: { feeder_unit: this.feeders } });
    }
    return json(200, { errors: [{ message: 'Unknown query' }] });
  }

  feederCommand(body) {
    const feeder = this.feeders.find((f) => f.serial === body.serial);
    if (!feeder) {
      return json(404, { message: 'Feeder not found' });
    }
    this.commands.push({
      family: 'feeder',
      target: body.serial,
      command: body.command,
      value: body.value,
    });
    const info = feeder.state.info;
    if (body.command === 'giveSnack') {
      feeder.feeding_snack = [
        { timestamp: new Date(this.now()).toISOString(), amount: 0.125 },
        ...(feeder.feeding_snack ?? []),
      ];
    }
    if (body.command === 'setPanelLockout') info.panelLockout = body.value === 1;
    if (body.command === 'setAutoNightMode') info.autoNightMode = body.value === 1;
    return json(200, { success: true });
  }

  /** The commands sent to the robots, without the request details. */
  commandsOf(family) {
    return this.commands.filter((command) => command.family === family);
  }

  /** Reads of the robot lists (one per family per reading). */
  readCount() {
    return this.requests.filter(
      (r) =>
        (r.method === 'GET' && r.url.endsWith('/robots')) ||
        r.body?.query?.includes('getLitterRobot4ByUser') ||
        r.body?.query?.includes('feeder_unit '),
    ).length;
  }
}

/**
 * A WebSocket stand-in: records the sockets the integration opens, lets the
 * test open them, push messages and close them.
 */
export function createFakeSockets() {
  const sockets = [];
  class FakeWebSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.sent = [];
      this.listeners = {};
      this.closed = false;
      sockets.push(this);
    }

    addEventListener(type, listener) {
      (this.listeners[type] ??= []).push(listener);
    }

    emit(type, event = {}) {
      for (const listener of this.listeners[type] ?? []) {
        listener(event);
      }
    }

    send(data) {
      this.sent.push(JSON.parse(data));
    }

    close() {
      if (!this.closed) {
        this.closed = true;
        this.emit('close');
      }
    }

    // --- test side ---
    open() {
      this.emit('open');
    }

    receive(message) {
      this.emit('message', { data: JSON.stringify(message) });
    }
  }
  return { WebSocketImpl: FakeWebSocket, sockets };
}
