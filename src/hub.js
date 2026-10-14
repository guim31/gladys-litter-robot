// -----------------------------------------------------------------------------
// The Litter-Robot hub: the Whisker account, one record per robot, read on a
// timer of the container and updated live by the subscriptions, its states
// published to Gladys when they change, its scene events fired on
// transitions, and the commands of the devices, the widget and the scenes.
//
// Gladys never polls these devices (should_poll: false, and
// GladysAssistant/Gladys#3198): the hub reads the cloud every few minutes
// (the configured interval), its onPoll only serves a Gladys that would poll
// anyway.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createHash } from 'node:crypto';
import { isConfigured } from './config.js';
import {
  WAIT_TIMES,
  buildDevice,
  deviceIds,
  featureKeyOf,
  featureStates,
  robotName,
} from './devices.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_KIND_TEXT,
  ERROR_TEXT,
  FEATURE_KEYS as K,
  INIT_FAILED,
  REPORT_TEXT,
  labelled,
  pick,
  statusText,
} from './texts.js';
import {
  FAMILIES,
  FEEDER_COMMANDS,
  LR3_COMMANDS,
  LR4_COMMANDS,
  WhiskerClient,
} from './whisker/client.js';
import { ERROR_KINDS, WhiskerError } from './whisker/http.js';
import {
  NIGHT_LIGHT_MODES,
  STATUS,
  errorKindOf,
  lbToKg,
  parseRobot,
  startOfDay,
} from './whisker/model.js';
import { createSubscription } from './whisker/realtime.js';

const logger = createLogger({ name: 'litter-robot' });

export const WIDGET_KEY = 'litter_robot';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  CAT_VISITED: 'cat_visited',
  DRAWER_FULL: 'drawer_full',
  ERROR: 'robot_error',
});

export const HUB_TIMINGS = {
  // Every family is listed again this often, to find a robot added to the account.
  discoveryMs: 60 * 60_000,
  // After a command, read the robot again this soon (when no live update came).
  afterCommandMs: 15_000,
  // A throttled account (HTTP 429, Cognito) waits this long before the next try.
  rateLimitMs: 15 * 60_000,
  // Live updates silent for this long: said once in the logs.
  realtimeDownMs: 10 * 60_000,
  // A clean started by Gladys this recently explains a new cycle (no visit).
  ownCleanMs: 15 * 60_000,
  // Two portions dispensed by Gladys are at least this far apart.
  snackGapMs: 60_000,
  // Re-send an unchanged value this often, so it stays recently dated in Gladys.
  heartbeatMs: 6 * 3_600_000,
};

const DAY_MS = 24 * 3_600_000;
const LITTER_FAMILIES = [FAMILIES.LR3, FAMILIES.LR4];
const ALL_FAMILIES = [FAMILIES.LR3, FAMILIES.LR4, FAMILIES.FEEDER];
const LIVE_FAMILIES = [FAMILIES.LR4, FAMILIES.FEEDER];

const accountKey = (email) =>
  createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);

const localDay = (time) => {
  const date = new Date(startOfDay(time));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const isLitterRobot = (snapshot) => LITTER_FAMILIES.includes(snapshot.family);

export class LitterRobotHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/whisker/http.js)
   * @param {Function|null} [options.WebSocketImpl] WebSocket seam (null: no live updates)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.realtimeTimings] src/whisker/realtime.js overrides
   * @param {() => number} [options.now]
   */
  constructor({
    gladys,
    store,
    request,
    WebSocketImpl,
    timers = true,
    timings,
    realtimeTimings,
    now,
  }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.WebSocketImpl = WebSocketImpl === undefined ? globalThis.WebSocket : WebSocketImpl;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.realtimeTimings = realtimeTimings;
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    /** @type {Map<string, object>} robot records, by serial */
    this.records = new Map();
    this.families = new Set();
    this.discoveredAt = 0;
    this.readAt = new Map();
    this.error = null;
    this.blocked = false;
    this.pausedUntil = 0;
    this.saved = { visits: {}, snacks: {} };
    this.subscriptions = new Map();
    this.live = new Map();
    this.liveDownTimers = new Map();
    this.transports = new Map();
    this.connection = null;
    this.publishedDevices = null;
    this.pollTimer = null;
    this.refreshTimers = new Map();
    this.reading = null;
    this.connectedOnce = false;
    this.stopped = false;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (connected, lost, back, user commands). A
  // problem that repeats is logged once at its own level, then at debug until
  // it clears. LOG_LEVEL=debug shows everything. Never a token nor a password.

  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(`${message} (still)`);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  get language() {
    return this.config?.language ?? 'fr';
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      account: typeof saved.account === 'string' ? saved.account : null,
      tokens: saved.tokens && typeof saved.tokens === 'object' ? saved.tokens : null,
      visits: saved.visits && typeof saved.visits === 'object' ? saved.visits : {},
      snacks: saved.snacks && typeof saved.snacks === 'object' ? saved.snacks : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.publishedDevices = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const sameAccount =
      previous && previous.email === config.email && previous.password === config.password;
    if (!sameAccount || !this.client) {
      this.newClient(previous);
    }
    if (previous && previous.language !== config.language) {
      // States in words follow the new language.
      this.gladys.forgetPublishedStates?.();
      this.publishedDevices = null;
    }
    await this.readAll({ discover: true });
    this.schedulePoll();
  }

  newClient(previous) {
    const config = this.config;
    this.stopSubscriptions();
    this.records.clear();
    this.families.clear();
    this.error = null;
    this.blocked = false;
    this.pausedUntil = 0;
    this.connectedOnce = false;
    if (!isConfigured(config)) {
      this.client = null;
      return;
    }
    const account = accountKey(config.email);
    // Tokens of another account, or a password just changed: sign in again.
    const passwordChanged = previous && previous.email === config.email;
    let tokens = null;
    if (this.saved.account === account && !passwordChanged) {
      tokens = this.saved.tokens;
    }
    this.client = new WhiskerClient({
      email: config.email,
      password: config.password,
      tokens,
      request: this.request,
      now: this.now,
      onTokens: (fresh) => {
        this.saved.account = account;
        this.saved.tokens = fresh;
        this.store.save(this.saved);
      },
    });
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.stopSubscriptions();
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.readAll({
          discover: this.now() - this.discoveredAt >= this.timings.discoveryMs,
        });
      } catch (err) {
        this.problem('poll', `Reading cycle failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.refreshMs);
  }

  // --- Reading the cloud ----------------------------------------------------------

  /**
   * Read the robots of the account and apply what changed. Concurrent calls
   * share the read. Errors of the cloud are recorded, never thrown.
   * @param {{ discover?: boolean, families?: string[] }} [options]
   */
  readAll(options = {}) {
    this.reading ??= this.doRead(options).finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  async doRead({ discover = false, families } = {}) {
    if (!this.client) {
      await this.afterRead();
      return;
    }
    if (this.blocked || this.now() < this.pausedUntil) {
      logger.debug('Reading skipped: waiting for a new configuration or the end of a throttling');
      return;
    }
    const wanted = families ?? (discover ? ALL_FAMILIES : [...this.families]);
    const seen = new Map();
    try {
      for (const family of wanted) {
        const raws = await this.client.list(family);
        this.readAt.set(family, this.now());
        seen.set(
          family,
          raws
            .map((raw) => ({ raw, snapshot: parseRobot(family, raw) }))
            .filter((entry) => entry.snapshot),
        );
      }
    } catch (err) {
      await this.applyFailure(err);
      return;
    }
    const wasError = this.error;
    this.error = null;
    if (wasError || !this.connectedOnce) {
      this.connectedOnce = true;
      const count = [...seen.values()].reduce((total, list) => total + list.length, 0);
      logger.info(
        wasError
          ? 'Whisker account: connection restored'
          : `Whisker account connected: ${count} robot(s)`,
      );
      this.warned.delete('account');
    }
    for (const [family, entries] of seen) {
      const snapshots = entries.map((entry) => entry.snapshot);
      if (snapshots.length > 0) {
        this.families.add(family);
      } else {
        this.families.delete(family);
      }
      for (const { raw, snapshot } of entries) {
        await this.applyRobot(snapshot, { raw });
      }
      if (discover) {
        // Removed from the account: forget them.
        const serials = new Set(snapshots.map((s) => s.serial));
        for (const [serial, record] of this.records) {
          if (record.snapshot.family === family && !serials.has(serial)) {
            this.records.delete(serial);
            logger.info(`${labelOf(record)} is no longer on the account`);
          }
        }
      }
    }
    if (discover) {
      this.discoveredAt = this.now();
    }
    await this.afterRead();
    this.ensureSubscriptions();
  }

  async applyFailure(err) {
    if (!(err instanceof WhiskerError)) {
      this.problem('read', `Reading the Whisker cloud failed: ${err.message}`, 'error');
      return;
    }
    const kind = err.kind;
    const changed = this.error?.kind !== kind;
    this.error = { kind, message: err.message };
    if (changed) {
      this.warned.delete('account');
    }
    this.problem('account', `Whisker account: ${err.message}`);
    if (kind === ERROR_KINDS.AUTH || kind === ERROR_KINDS.MFA) {
      // Not retried on a timer: a refused password tried again and again
      // gets the account throttled. A new configuration or the "Test the
      // connection" action tries again.
      this.blocked = true;
      this.stopSubscriptions();
    } else if (kind === ERROR_KINDS.RATE_LIMIT) {
      this.pausedUntil = this.now() + this.timings.rateLimitMs;
    }
    await this.afterRead();
  }

  /** Gladys asks for a refresh (onPoll): read that robot's family, unless just read. */
  async pollDevice(device) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      return;
    }
    const family = record.snapshot.family;
    const last = this.readAt.get(family) ?? 0;
    if (this.now() - last < (this.config.refreshMs ?? 0) / 2) {
      logger.debug(`onPoll: ${family} read ${this.now() - last} ms ago, skipped`);
      return;
    }
    await this.readAll({ families: [family] });
  }

  // --- Robots ------------------------------------------------------------------------

  recordOf(deviceExternalId) {
    for (const record of this.records.values()) {
      if (deviceIds(this.gladys, record.snapshot).device === deviceExternalId) {
        return record;
      }
    }
    return null;
  }

  /** A new reading or live update of one robot. */
  async applyRobot(snapshot, { live = false, raw } = {}) {
    let record = this.records.get(snapshot.serial);
    if (!record) {
      record = {
        snapshot: null,
        visitSinceCycle: false,
        cleanedByGladysAt: 0,
      };
      this.records.set(snapshot.serial, record);
    }
    const previous = record.snapshot;
    record.snapshot = snapshot;
    if (raw) {
      record.raw = raw;
    }
    if (previous) {
      await this.transitions(record, previous, snapshot);
    }
    await this.publishStates(record);
    const widgetChanged =
      !previous ||
      ['status', 'drawerLevel', 'litterLevel', 'weightLb', 'name', 'online'].some(
        (key) => previous[key] !== snapshot[key],
      );
    if (widgetChanged && isLitterRobot(snapshot)) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
    if (live) {
      logger.debug(`${labelOf(record)}: live update (${snapshot.status})`);
    }
  }

  async transitions(record, previous, next) {
    const robot = robotName(next);
    const device = deviceIds(this.gladys, next).device;

    // A cat visit: the robot starts its countdown before cleaning (the cat
    // left). Missed between two readings (a Litter-Robot 3 read every few
    // minutes), the cycle counter that moves says it afterwards.
    if (isLitterRobot(next)) {
      const entersTiming =
        next.status === STATUS.CAT_SENSOR_TIMING && previous.status !== STATUS.CAT_SENSOR_TIMING;
      const cycled =
        typeof next.cycles === 'number' &&
        typeof previous.cycles === 'number' &&
        next.cycles > previous.cycles;
      const ownClean = this.now() - record.cleanedByGladysAt < this.timings.ownCleanMs;
      if (entersTiming) {
        record.visitSinceCycle = true;
        await this.visit(record, next);
      } else if (cycled && !record.visitSinceCycle && !ownClean) {
        await this.visit(record, next);
      }
      if (cycled) {
        record.visitSinceCycle = false;
      }

      if (next.drawerFull && !previous.drawerFull) {
        logger.info(`${labelOf(record)}: waste drawer full`);
        await this.fire(TRIGGERS.DRAWER_FULL, {
          device,
          robot,
          drawer_level: next.drawerLevel ?? 100,
        });
      }
    }

    const kind = errorKindOf(next.status);
    if (kind && kind !== errorKindOf(previous.status)) {
      logger.info(`${labelOf(record)}: ${pick(ERROR_KIND_TEXT[kind], 'en')}`);
      await this.fire(TRIGGERS.ERROR, {
        device,
        robot,
        kind,
        message: pick(ERROR_KIND_TEXT[kind], this.language),
      });
    } else if (!kind && errorKindOf(previous.status)) {
      logger.info(`${labelOf(record)}: back to ${statusText(next.status, 'en')}`);
    }
  }

  async visit(record, snapshot) {
    const now = this.now();
    const day = localDay(now);
    const saved = this.saved.visits[snapshot.serial];
    const count = saved?.day === day ? saved.count + 1 : 1;
    this.saved.visits[snapshot.serial] = { last: now, day, count };
    this.store.save(this.saved);
    // The weight the robot recorded last (Litter-Robot 4 with SmartWeight).
    const weightLb = snapshot.weightLb;
    await this.fire(TRIGGERS.CAT_VISITED, {
      device: deviceIds(this.gladys, snapshot).device,
      robot: robotName(snapshot),
      weight_kg: weightLb === null ? null : lbToKg(weightLb),
      weight_lb: weightLb === null ? null : Math.round(weightLb * 100) / 100,
      visits_today: count,
    });
  }

  /** The visits of a robot: { last, today }. */
  visits(serial) {
    const saved = this.saved.visits[serial];
    if (!saved) {
      return { last: null, today: 0 };
    }
    return {
      last: saved.last ?? null,
      today: saved.day === localDay(this.now()) ? saved.count : 0,
    };
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  createdIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  /** States of a robot whose device the user added (Gladys drops the others). */
  async publishStates(record) {
    if (!this.createdIds().has(deviceIds(this.gladys, record.snapshot).device)) {
      return;
    }
    const states = featureStates(this.gladys, record.snapshot, {
      language: this.language,
      lastVisit: this.visits(record.snapshot.serial).last,
      now: this.now(),
    });
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states', 'Gladys accepts the states again');
    } catch (err) {
      this.problem('states', `States refused by Gladys: ${err.message}`);
    }
  }

  async publishDevices() {
    const devices = [...this.records.values()].map((record) =>
      buildDevice(this.gladys, record.snapshot, this.language),
    );
    const key = JSON.stringify(devices);
    if (key === this.publishedDevices) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.publishedDevices = key;
      this.resolved('devices');
    } catch (err) {
      this.problem('devices', `Device list refused by Gladys: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: list every family again. */
  async rediscover() {
    this.publishedDevices = null;
    await this.readAll({ discover: true });
  }

  /** The user added a device: send its states now, they were dropped before. */
  async onDeviceCreated(device) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    this.transports.delete(device.external_id);
    await this.publishStates(record);
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  async afterRead() {
    await this.publishDevices();
    await this.publishTransports();
    await this.publishConnectionStatus();
  }

  async publishTransports() {
    const created = this.createdIds();
    const entries = [];
    for (const record of this.records.values()) {
      const externalId = deviceIds(this.gladys, record.snapshot).device;
      if (!created.has(externalId)) {
        continue;
      }
      const transport =
        this.error || !record.snapshot.online
          ? DEVICE_TRANSPORTS.UNREACHABLE
          : DEVICE_TRANSPORTS.CLOUD;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused by Gladys: ${err.message}`);
    }
  }

  connectionStatus() {
    if (!this.config || !isConfigured(this.config)) {
      return { connected: false, message: CONNECTION_TEXT.notConfigured };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] ?? INIT_FAILED };
    }
    if (this.records.size === 0) {
      return { connected: true, message: CONNECTION_TEXT.noRobot };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Live updates ----------------------------------------------------------------------

  ensureSubscriptions() {
    if (this.stopped || !this.client || this.blocked || !this.WebSocketImpl) {
      return;
    }
    for (const family of LIVE_FAMILIES) {
      const ids = [...this.records.values()]
        .filter((record) => record.snapshot.family === family)
        .map((record) => record.snapshot.id)
        .sort();
      const key = ids.join(',');
      const current = this.subscriptions.get(family);
      if (current && current.key === key) {
        continue;
      }
      current?.subscription.stop();
      this.subscriptions.delete(family);
      if (ids.length === 0) {
        continue;
      }
      const subscription = createSubscription({
        family,
        client: this.client,
        ids,
        WebSocketImpl: this.WebSocketImpl,
        timings: this.realtimeTimings,
        onRobots: (fam, raws) => this.onLiveRobots(fam, raws),
        onState: (fam, live, reason) => this.onLiveState(fam, live, reason),
      });
      this.subscriptions.set(family, { key, subscription });
      subscription.start();
    }
  }

  stopSubscriptions() {
    for (const { subscription } of this.subscriptions.values()) {
      subscription.stop();
    }
    this.subscriptions.clear();
    for (const timer of this.liveDownTimers.values()) {
      clearTimeout(timer);
    }
    this.liveDownTimers.clear();
    this.live.clear();
  }

  onLiveRobots(family, raws) {
    const work = async () => {
      for (const raw of raws) {
        // Only robots already known: a new one waits for the next discovery.
        const record = this.records.get(String(raw?.serial));
        if (!record) {
          continue;
        }
        // pylitterbot merges an update into what it knew: an update may
        // carry only some fields, a missing one must not read as "offline".
        const merged = { ...record.raw, ...raw };
        const snapshot = parseRobot(family, merged);
        if (snapshot) {
          await this.applyRobot(snapshot, { live: true, raw: merged });
        }
      }
      await this.publishTransports();
    };
    work().catch((err) => this.problem('live', `Live update failed: ${err.message}`, 'error'));
  }

  onLiveState(family, live, reason) {
    this.live.set(family, live);
    const key = `live-${family}`;
    if (live) {
      clearTimeout(this.liveDownTimers.get(family));
      this.liveDownTimers.delete(family);
      this.resolved(key, `Live updates of the ${family} robots work again`);
      logger.debug(`Live updates of the ${family} robots: on`);
      return;
    }
    logger.debug(`Live updates of the ${family} robots: off (${reason ?? 'stopped'})`);
    // Reconnections are routine (expired token, cloud restart): say it only
    // when the updates stay down.
    if (!this.liveDownTimers.has(family) && this.timersEnabled) {
      const timer = setTimeout(() => {
        this.liveDownTimers.delete(family);
        if (!this.live.get(family)) {
          this.problem(
            key,
            `Live updates of the ${family} robots are down (${reason ?? 'no connection'}): read every ${this.config.refreshMs / 60_000} min instead`,
          );
        }
      }, this.timings.realtimeDownMs);
      timer.unref?.();
      this.liveDownTimers.set(family, timer);
    }
  }

  // --- Commands --------------------------------------------------------------------------

  /** The record of a device chosen in a scene, a widget or a device row. */
  target(deviceExternalId, { litter = false, feeder = false } = {}) {
    if (!this.client || this.error) {
      throw new Error(pick(ACTION_TEXT.notConnected, this.language));
    }
    const record = deviceExternalId ? this.recordOf(deviceExternalId) : null;
    if (!record) {
      throw new Error(pick(ACTION_TEXT.unknownRobot, this.language));
    }
    if (litter && !isLitterRobot(record.snapshot)) {
      throw new Error(pick(ACTION_TEXT.notLitterRobot, this.language));
    }
    if (feeder && record.snapshot.family !== FAMILIES.FEEDER) {
      throw new Error(pick(ACTION_TEXT.notFeeder, this.language));
    }
    if (!record.snapshot.online) {
      throw new Error(pick(ACTION_TEXT.offline, this.language));
    }
    return record;
  }

  /** Run a command, turning a cloud error into a message in the user's language. */
  async command(record, label, run) {
    try {
      await run();
    } catch (err) {
      if (err instanceof WhiskerError) {
        logger.warn(`${labelOf(record)}: ${label} failed: ${err.message}`);
        if (err.kind === ERROR_KINDS.AUTH) {
          await this.applyFailure(err);
        }
        throw new Error(pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT[ERROR_KINDS.API], this.language), {
          cause: err,
        });
      }
      throw err;
    }
    logger.info(`${labelOf(record)}: ${label}`);
    this.scheduleRefresh(record.snapshot.family);
  }

  /** Read a family again soon, unless its live updates will say it. */
  scheduleRefresh(family) {
    if (!this.timersEnabled || this.live.get(family)) {
      return;
    }
    clearTimeout(this.refreshTimers.get(family));
    const timer = setTimeout(() => {
      this.refreshTimers.delete(family);
      this.readAll({ families: [family] }).catch(() => {});
    }, this.timings.afterCommandMs);
    timer.unref?.();
    this.refreshTimers.set(family, timer);
  }

  /** Apply the expected values at once (the cloud confirms them later). */
  async optimistic(record, values) {
    await this.applyRobot({ ...record.snapshot, ...values });
  }

  async clean(deviceExternalId) {
    const record = this.target(deviceExternalId, { litter: true });
    const { snapshot } = record;
    // Never turn the globe on a cat (the robot also refuses, belt and braces).
    if (snapshot.status === STATUS.CAT_DETECTED) {
      throw new Error(pick(ACTION_TEXT.catInside, this.language));
    }
    await this.command(record, 'cleaning started', () =>
      snapshot.family === FAMILIES.LR3
        ? this.client.lr3Command(snapshot.id, LR3_COMMANDS.CLEAN)
        : this.client.lr4Command(snapshot.serial, LR4_COMMANDS.CLEAN),
    );
    record.cleanedByGladysAt = this.now();
    return record;
  }

  async resetDrawer(deviceExternalId) {
    const record = this.target(deviceExternalId, { litter: true });
    const { snapshot } = record;
    if (snapshot.family !== FAMILIES.LR3) {
      throw new Error(pick(ACTION_TEXT.notLr3, this.language));
    }
    let answer = null;
    await this.command(record, 'drawer gauge reset', async () => {
      answer = await this.client.lr3Patch(snapshot.id, {
        cycleCount: 0,
        cycleCapacity: snapshot.cycleCapacity,
        cyclesAfterDrawerFull: 0,
      });
    });
    const parsed = answer ? parseRobot(FAMILIES.LR3, { ...answer }) : null;
    await this.optimistic(
      record,
      parsed ?? { cycles: 0, drawerLevel: 0, drawerFull: false, status: STATUS.READY },
    );
    return record;
  }

  async setWaitTime(record, minutes) {
    const { snapshot } = record;
    if (!WAIT_TIMES[snapshot.family]?.includes(minutes)) {
      throw new Error(pick(ACTION_TEXT.badValue, this.language));
    }
    await this.command(record, `cleaning delay set to ${minutes} min`, () =>
      snapshot.family === FAMILIES.LR3
        ? this.client.lr3Command(
            snapshot.id,
            `${LR3_COMMANDS.WAIT_TIME}${minutes.toString(16).toUpperCase()}`,
          )
        : this.client.lr4Command(snapshot.serial, LR4_COMMANDS.WAIT_TIME, { clumpTime: minutes }),
    );
    await this.optimistic(record, { waitMinutes: minutes });
  }

  async setNightLight(record, on) {
    const { snapshot } = record;
    await this.command(record, `night light ${on ? 'on' : 'off'}`, () =>
      snapshot.family === FAMILIES.LR3
        ? this.client.lr3Command(
            snapshot.id,
            on ? LR3_COMMANDS.NIGHT_LIGHT_ON : LR3_COMMANDS.NIGHT_LIGHT_OFF,
          )
        : this.client.feederCommand(snapshot.serial, FEEDER_COMMANDS.NIGHT_LIGHT, on),
    );
    await this.optimistic(record, { nightLight: on });
  }

  async setNightLightMode(record, mode) {
    if (!NIGHT_LIGHT_MODES.includes(mode)) {
      throw new Error(pick(ACTION_TEXT.badValue, this.language));
    }
    await this.command(record, `night light mode ${mode}`, () =>
      this.client.lr4Command(record.snapshot.serial, LR4_COMMANDS.NIGHT_LIGHT[mode]),
    );
    await this.optimistic(record, { nightLightMode: mode, nightLight: mode !== 'OFF' });
  }

  async setPanelLock(record, on) {
    const { snapshot } = record;
    await this.command(record, `panel ${on ? 'locked' : 'unlocked'}`, () => {
      switch (snapshot.family) {
        case FAMILIES.LR3:
          return this.client.lr3Command(
            snapshot.id,
            on ? LR3_COMMANDS.LOCK_ON : LR3_COMMANDS.LOCK_OFF,
          );
        case FAMILIES.LR4:
          return this.client.lr4Command(
            snapshot.serial,
            on ? LR4_COMMANDS.LOCK_ON : LR4_COMMANDS.LOCK_OFF,
          );
        default:
          return this.client.feederCommand(snapshot.serial, FEEDER_COMMANDS.LOCK, on);
      }
    });
    await this.optimistic(record, { panelLock: on });
  }

  /**
   * Dispense one portion, within the anti-loop limit: at most
   * `snackDailyLimit` portions by Gladys over 24 hours, a minute apart.
   * @returns {Promise<{ dispensed: boolean, remaining: number, reason: object|null }>}
   */
  async dispenseSnack(deviceExternalId) {
    const record = this.target(deviceExternalId, { feeder: true });
    const serial = record.snapshot.serial;
    const now = this.now();
    const limit = this.config.snackDailyLimit;
    const recent = (this.saved.snacks[serial] ?? []).filter((at) => now - at < DAY_MS);
    if (recent.length >= limit) {
      logger.info(`${labelOf(record)}: portion refused, ${limit} in 24 h`);
      return {
        dispensed: false,
        remaining: 0,
        reason: Object.fromEntries(
          Object.entries(ACTION_TEXT.snackLimit).map(([lang, fn]) => [lang, fn(limit)]),
        ),
      };
    }
    if (recent.length > 0 && now - Math.max(...recent) < this.timings.snackGapMs) {
      logger.info(`${labelOf(record)}: portion refused, one a minute ago`);
      return {
        dispensed: false,
        remaining: limit - recent.length,
        reason: ACTION_TEXT.snackTooSoon,
      };
    }
    await this.command(record, 'portion dispensed', () =>
      this.client.feederCommand(serial, FEEDER_COMMANDS.SNACK, true),
    );
    recent.push(now);
    this.saved.snacks[serial] = recent;
    this.store.save(this.saved);
    return { dispensed: true, remaining: limit - recent.length, reason: null };
  }

  /** A device row of Gladys: the feature tells the command. */
  async setValue(device, feature, value) {
    const record = this.recordOf(device.external_id);
    const key = record ? featureKeyOf(this.gladys, record.snapshot, feature.external_id) : null;
    if (!record || !key) {
      throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
    const on = Number(value) === 1;
    switch (key) {
      case K.CLEAN:
        await this.clean(device.external_id);
        return;
      case K.RESET_DRAWER:
        await this.resetDrawer(device.external_id);
        return;
      case K.SNACK: {
        const result = await this.dispenseSnack(device.external_id);
        if (!result.dispensed) {
          throw new Error(pick(result.reason, this.language));
        }
        return;
      }
      case K.WAIT_TIME:
        await this.setWaitTime(this.target(device.external_id), Number(value));
        return;
      case K.NIGHT_LIGHT:
      case K.AUTO_NIGHT_LIGHT:
        await this.setNightLight(this.target(device.external_id), on);
        return;
      case K.NIGHT_LIGHT_MODE:
        await this.setNightLightMode(this.target(device.external_id), String(value));
        return;
      case K.PANEL_LOCK:
        await this.setPanelLock(this.target(device.external_id), on);
        return;
      default:
        throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
  }

  // --- Reports ----------------------------------------------------------------------------

  /** "Test the connection": sign in again if needed, list every robot. */
  async testConnection() {
    if (!this.client) {
      return CONNECTION_TEXT.notConfigured;
    }
    this.blocked = false;
    this.pausedUntil = 0;
    await this.readAll({ discover: true });
    if (this.error) {
      return ERROR_TEXT[this.error.kind] ?? INIT_FAILED;
    }
    if (this.records.size === 0) {
      return CONNECTION_TEXT.noRobot;
    }
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const lines = [text.connected(this.records.size)];
      for (const record of this.records.values()) {
        const { snapshot } = record;
        const live = LIVE_FAMILIES.includes(snapshot.family) && this.live.get(snapshot.family);
        lines.push(
          labelled(
            labelOf(record),
            `${statusText(snapshot.status, language)} (${live ? text.live : text.polled})`,
            language,
          ),
        );
      }
      message[language] = lines.join('\n').slice(0, 1000);
    }
    return message;
  }
}

/** "Kitchen (Litter-Robot 4)", or the model alone when the robot has no nickname. */
function labelOf(record) {
  const model = {
    [FAMILIES.LR3]: 'Litter-Robot 3',
    [FAMILIES.LR4]: 'Litter-Robot 4',
    [FAMILIES.FEEDER]: 'Feeder-Robot',
  }[record.snapshot.family];
  const name = robotName(record.snapshot);
  return name.startsWith(model) ? name : `${name} (${model})`;
}
