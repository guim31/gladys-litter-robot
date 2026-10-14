// -----------------------------------------------------------------------------
// Real-time updates: the GraphQL subscriptions the Whisker app uses, over the
// "graphql-ws" WebSocket protocol, as pylitterbot (MIT) opens them.
//
//   Litter-Robot 4  AWS AppSync, one subscription for every robot of the
//                   user (litterRobot4StateSubscriptionByUser); the token goes
//                   in the URL (base64 "header") and in the start message.
//   Feeder-Robot    Hasura, connection_init with the token, then one
//                   subscription per feeder (feeder_unit_by_pk).
//
// Each update is a full robot object, handed to `onRobots(family, raws)`; the
// hub parses and publishes it like a reading. A connection that fails or goes
// silent (no message, not even a keep-alive, for `staleMs`) is opened again
// after a growing delay; the periodic reading of the hub stays the safety
// net. The Litter-Robot 3 has no such subscription here: it is read only.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { ENDPOINTS, FAMILIES, LITTER_ROBOT_4_MODEL, feederRobotModel } from './client.js';

export const REALTIME_TIMINGS = {
  staleMs: 180_000,
  retryMinMs: 5_000,
  retryMaxMs: 300_000,
};

const LR4_HOST = 'lr4.iothings.site';
const b64 = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

/** The two subscriptions: how to open them, and where their data is. */
const PROTOCOLS = {
  [FAMILIES.LR4]: {
    async url(client) {
      const token = await client.idToken();
      const header = b64({ Authorization: `Bearer ${token}`, host: LR4_HOST });
      return `${ENDPOINTS.LR4_REALTIME}?header=${encodeURIComponent(header)}&payload=${encodeURIComponent(b64({}))}`;
    },
    async open(client, send) {
      const token = await client.idToken();
      send({
        id: randomUUID(),
        type: 'start',
        payload: {
          data: JSON.stringify({
            query: `subscription GetLR4ByUser($userId: String!) {
              litterRobot4StateSubscriptionByUser(userId: $userId) { robots ${LITTER_ROBOT_4_MODEL} }
            }`,
            variables: { userId: client.userId },
          }),
          extensions: { authorization: { Authorization: `Bearer ${token}`, host: LR4_HOST } },
        },
      });
    },
    robots(payload) {
      const robots = payload?.data?.litterRobot4StateSubscriptionByUser?.robots;
      return Array.isArray(robots) ? robots : [];
    },
  },
  [FAMILIES.FEEDER]: {
    async url() {
      return ENDPOINTS.FEEDER_REALTIME;
    },
    async open(client, send, ids) {
      const token = await client.idToken();
      send({ type: 'connection_init', payload: { headers: { Authorization: `Bearer ${token}` } } });
      for (const id of ids) {
        send({
          id: randomUUID(),
          type: 'start',
          payload: {
            query: `subscription GetFeeder($id: Int!) { feeder_unit_by_pk(id: $id) ${feederRobotModel(Date.now())} }`,
            variables: { id: Number(id) },
          },
        });
      }
    },
    robots(payload) {
      const robot = payload?.data?.feeder_unit_by_pk;
      return robot && typeof robot === 'object' ? [robot] : [];
    },
  },
};

/**
 * One subscription that keeps itself open.
 * @param {object} options
 * @param {string} options.family FAMILIES.LR4 or FAMILIES.FEEDER
 * @param {object} options.client WhiskerClient
 * @param {string[]} [options.ids] feeder ids (Feeder-Robot only)
 * @param {(family: string, raws: object[]) => void} options.onRobots
 * @param {(family: string, live: boolean, reason?: string) => void} options.onState
 * @param {Function} [options.WebSocketImpl]
 * @param {object} [options.timings]
 */
export function createSubscription({
  family,
  client,
  ids = [],
  onRobots,
  onState,
  WebSocketImpl = globalThis.WebSocket,
  timings = REALTIME_TIMINGS,
}) {
  const protocol = PROTOCOLS[family];
  let socket = null;
  let staleTimer = null;
  let retryTimer = null;
  let retryMs = timings.retryMinMs;
  let stopped = false;
  let live = false;

  const setLive = (value, reason) => {
    if (live !== value) {
      live = value;
      onState(family, value, reason);
    } else if (!value && reason) {
      onState(family, false, reason);
    }
  };

  const armStale = () => {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      drop('no message for too long');
    }, timings.staleMs);
    staleTimer.unref?.();
  };

  function drop(reason) {
    clearTimeout(staleTimer);
    const current = socket;
    socket = null;
    if (current) {
      try {
        current.close();
      } catch {
        // already closing
      }
    }
    setLive(false, reason);
    scheduleRetry();
  }

  function scheduleRetry() {
    if (stopped || retryTimer) {
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryMs);
    retryTimer.unref?.();
    retryMs = Math.min(retryMs * 2, timings.retryMaxMs);
  }

  async function connect() {
    if (stopped || socket) {
      return;
    }
    if (typeof WebSocketImpl !== 'function') {
      setLive(false, 'no WebSocket support');
      return;
    }
    let ws;
    try {
      ws = new WebSocketImpl(await protocol.url(client), ['graphql-ws']);
    } catch (err) {
      setLive(false, err.message);
      scheduleRetry();
      return;
    }
    if (stopped) {
      ws.close();
      return;
    }
    socket = ws;
    const send = (message) => ws.send(JSON.stringify(message));
    ws.addEventListener('open', () => {
      armStale();
      protocol.open(client, send, ids).catch((err) => {
        if (socket === ws) {
          drop(err.message);
        }
      });
    });
    ws.addEventListener('message', (event) => {
      if (socket !== ws) {
        return;
      }
      armStale();
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
      switch (message?.type) {
        case 'data': {
          retryMs = timings.retryMinMs;
          setLive(true);
          const robots = protocol.robots(message.payload);
          if (robots.length > 0) {
            onRobots(family, robots);
          }
          break;
        }
        case 'start_ack':
        case 'connection_ack':
          retryMs = timings.retryMinMs;
          setLive(true);
          break;
        case 'error':
        case 'connection_error':
          drop(`subscription refused (${message.type})`);
          break;
        default:
          // ka (keep-alive), complete: only the stale timer cares
          break;
      }
    });
    ws.addEventListener('close', () => {
      if (socket === ws) {
        drop('connection closed');
      }
    });
    ws.addEventListener('error', () => {
      if (socket === ws) {
        drop('connection error');
      }
    });
  }

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      clearTimeout(staleTimer);
      clearTimeout(retryTimer);
      retryTimer = null;
      const current = socket;
      socket = null;
      live = false;
      current?.close();
    },
    get live() {
      return live;
    },
  };
}
