// -----------------------------------------------------------------------------
// From the raw answers of the Whisker cloud to one snapshot per robot, the
// same shape for the three families, so the rest of the code never reads an
// API field. The rules follow pylitterbot (MIT): status codes, LR4 status
// algorithm, LR3 drawer level from the cycle counters, Feeder food levels.
//
// Litter-Robot snapshot:
//   { family, serial, id, name, online, status, drawerLevel, drawerFull,
//     litterLevel, weightLb, cycles, waitMinutes, nightLight, nightLightMode,
//     panelLock, sleepMode, lastSeen }
// Feeder-Robot snapshot:
//   { family, serial, id, name, online, status, foodLevel, feedings,
//     nightLight, panelLock }
// A value the robot does not report is null (never published).
// -----------------------------------------------------------------------------

import { FAMILIES } from './client.js';

// Litter box status codes (pylitterbot LitterBoxStatus), the keys of the
// status texts (src/texts.js).
export const STATUS = Object.freeze({
  BONNET_REMOVED: 'BR',
  CLEAN_CYCLE_COMPLETE: 'CCC',
  CLEAN_CYCLE: 'CCP',
  CAT_DETECTED: 'CD',
  CAT_SENSOR_FAULT: 'CSF',
  CAT_SENSOR_INTERRUPTED: 'CSI',
  CAT_SENSOR_TIMING: 'CST',
  DRAWER_FULL_1: 'DF1',
  DRAWER_FULL_2: 'DF2',
  DRAWER_FULL: 'DFS',
  DUMP_HOME_POSITION_FAULT: 'DHF',
  DUMP_POSITION_FAULT: 'DPF',
  EMPTY_CYCLE: 'EC',
  HOME_POSITION_FAULT: 'HPF',
  OFF: 'OFF',
  OFFLINE: 'OFFLINE',
  OVER_TORQUE_FAULT: 'OTF',
  PAUSED: 'P',
  PINCH_DETECT: 'PD',
  POWER_DOWN: 'PWRD',
  POWER_UP: 'PWRU',
  READY: 'RDY',
  STARTUP_CAT_SENSOR_FAULT: 'SCF',
  STARTUP_DRAWER_FULL: 'SDF',
  STARTUP_PINCH_DETECT: 'SPF',
  UNKNOWN: 'UNKNOWN',
});

// Feeder-Robot states (no status code in its API: derived from its flags).
export const FEEDER_STATUS = Object.freeze({
  READY: 'FEEDER_READY',
  OFFLINE: 'OFFLINE',
  JAMMED: 'FEEDER_JAMMED',
  CHUTE_FULL: 'FEEDER_CHUTE_FULL',
  ON_BATTERY: 'FEEDER_ON_BATTERY',
  OFF: 'OFF',
});

// What the "Error" trigger reports, by kind (its `kind` filter).
export const ERROR_KIND = Object.freeze({
  MOTOR: 'motor',
  PINCH: 'pinch',
  CAT_SENSOR: 'cat_sensor',
  BONNET: 'bonnet',
  OFFLINE: 'offline',
  FEEDER_JAM: 'feeder_jam',
});

const ERROR_OF_STATUS = {
  [STATUS.BONNET_REMOVED]: ERROR_KIND.BONNET,
  [STATUS.CAT_SENSOR_FAULT]: ERROR_KIND.CAT_SENSOR,
  [STATUS.STARTUP_CAT_SENSOR_FAULT]: ERROR_KIND.CAT_SENSOR,
  [STATUS.DUMP_HOME_POSITION_FAULT]: ERROR_KIND.MOTOR,
  [STATUS.DUMP_POSITION_FAULT]: ERROR_KIND.MOTOR,
  [STATUS.HOME_POSITION_FAULT]: ERROR_KIND.MOTOR,
  [STATUS.OVER_TORQUE_FAULT]: ERROR_KIND.MOTOR,
  [STATUS.PINCH_DETECT]: ERROR_KIND.PINCH,
  [STATUS.STARTUP_PINCH_DETECT]: ERROR_KIND.PINCH,
  [STATUS.OFFLINE]: ERROR_KIND.OFFLINE,
  [FEEDER_STATUS.OFFLINE]: ERROR_KIND.OFFLINE,
  [FEEDER_STATUS.JAMMED]: ERROR_KIND.FEEDER_JAM,
};

/** The error kind of a status, null when the status is not an error. */
export const errorKindOf = (status) => ERROR_OF_STATUS[status] ?? null;

const LR4_STATUS = {
  ROBOT_BONNET: STATUS.BONNET_REMOVED,
  ROBOT_CAT_DETECT: STATUS.CAT_DETECTED,
  ROBOT_CAT_DETECT_DELAY: STATUS.CAT_SENSOR_TIMING,
  ROBOT_CLEAN: STATUS.CLEAN_CYCLE,
  ROBOT_EMPTY: STATUS.EMPTY_CYCLE,
  ROBOT_FIND_DUMP: STATUS.CLEAN_CYCLE,
  ROBOT_IDLE: STATUS.READY,
  ROBOT_POWER_DOWN: STATUS.POWER_DOWN,
  ROBOT_POWER_OFF: STATUS.OFF,
  ROBOT_POWER_UP: STATUS.POWER_UP,
};
const LR4_CYCLE_STATE_STATUS = {
  CYCLE_STATE_CAT_DETECT: STATUS.CAT_SENSOR_INTERRUPTED,
  CYCLE_STATE_PAUSE: STATUS.PAUSED,
};
const KNOWN_STATUS = new Set(Object.values(STATUS));

// LR3: cycles still possible before the drawer is full, by status.
const CYCLES_LEFT = {
  [STATUS.DRAWER_FULL_1]: 2,
  [STATUS.DRAWER_FULL_2]: 1,
  [STATUS.DRAWER_FULL]: 0,
  [STATUS.STARTUP_DRAWER_FULL]: 0,
};
const DEFAULT_CYCLES_LEFT = 3;
const DEFAULT_LR3_CAPACITY = 30;

// Feeder food level: the hopper sensor step (0-9) → percent (pylitterbot).
const FOOD_LEVEL = { 9: 100, 8: 70, 7: 60, 6: 50, 5: 40, 4: 30, 3: 20, 2: 10, 1: 5, 0: 0 };

export const NIGHT_LIGHT_MODES = Object.freeze(['OFF', 'ON', 'AUTO']);

const int = (value) => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? Math.round(number) : null;
};
const clampPercent = (value) => (value === null ? null : Math.min(100, Math.max(0, value)));

/**
 * A Whisker date: "2021-02-01T00:30:00.000000" (UTC, no zone, microseconds),
 * "2022-07-20T00:13:00.000000Z", "2022-09-08T18:00:00.000000+00:00".
 * @returns {number|null} epoch milliseconds
 */
export function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  let text = value.trim().replace(' ', 'T');
  text = text.replace(/(\.\d{3})\d+/, '$1');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    text += 'Z';
  }
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

// --- Litter-Robot 3 Connect ------------------------------------------------------

export function parseLitterRobot3(raw) {
  const rawStatus = typeof raw.unitStatus === 'string' ? raw.unitStatus : null;
  const powered = raw.powerStatus !== 'NC' && raw.powerStatus !== null;
  let status = rawStatus && KNOWN_STATUS.has(rawStatus) ? rawStatus : STATUS.UNKNOWN;
  if (!powered || rawStatus === STATUS.OFFLINE) {
    status = STATUS.OFFLINE;
  }
  const cycles = int(raw.cycleCount) ?? 0;
  const left = CYCLES_LEFT[status] ?? DEFAULT_CYCLES_LEFT;
  const stored = int(raw.cycleCapacity) ?? DEFAULT_LR3_CAPACITY;
  // pylitterbot's rule: the status (DF1, DF2, DFS) caps the capacity.
  const capacity = left < DEFAULT_CYCLES_LEFT ? cycles + left : Math.max(stored, cycles + left);
  const dfiTriggered = raw.isDFITriggered !== undefined && String(raw.isDFITriggered) !== '0';
  const drawerFull =
    status === STATUS.DRAWER_FULL ||
    status === STATUS.STARTUP_DRAWER_FULL ||
    (dfiTriggered && cycles > 9);
  const wait =
    typeof raw.cleanCycleWaitTimeMinutes === 'string'
      ? parseInt(raw.cleanCycleWaitTimeMinutes, 16)
      : int(raw.cleanCycleWaitTimeMinutes);
  const flag = (value) => value !== undefined && value !== null && String(value) !== '0';
  return {
    family: FAMILIES.LR3,
    serial: String(raw.litterRobotSerial),
    id: String(raw.litterRobotId),
    name: typeof raw.litterRobotNickname === 'string' ? raw.litterRobotNickname : '',
    online: status !== STATUS.OFFLINE,
    status,
    rawStatus,
    // The level follows the counters (pylitterbot); "full" may come earlier,
    // from the drawer full indicator.
    drawerLevel: left === 0 ? 100 : clampPercent(Math.round((cycles / capacity) * 100)),
    drawerFull,
    litterLevel: null,
    weightLb: null,
    cycles,
    cycleCapacity: capacity,
    waitMinutes: Number.isFinite(wait) ? wait : null,
    nightLight: flag(raw.nightLightActive),
    nightLightMode: null,
    panelLock: flag(raw.panelLockActive),
    sleepMode: flag(raw.sleepModeActive),
    lastSeen: parseTimestamp(raw.lastSeen),
  };
}

// --- Litter-Robot 4 ------------------------------------------------------------------

function lr4Status(raw) {
  if (raw.isOnline !== true) {
    return STATUS.OFFLINE;
  }
  if (raw.unitPowerStatus !== undefined && raw.unitPowerStatus !== 'ON') {
    return STATUS.OFF;
  }
  const cycle = LR4_CYCLE_STATE_STATUS[raw.robotCycleState];
  if (cycle) {
    return cycle;
  }
  const status = LR4_STATUS[raw.robotStatus] ?? STATUS.UNKNOWN;
  if (status === STATUS.READY) {
    if (raw.displayCode === 'DC_CAT_DETECT') {
      return STATUS.CAT_DETECTED;
    }
    if (raw.isDFIFull === true) {
      return STATUS.DRAWER_FULL;
    }
  }
  return status;
}

export function parseLitterRobot4(raw) {
  const status = lr4Status(raw);
  const sleepDays =
    raw.weekdaySleepModeEnabled && typeof raw.weekdaySleepModeEnabled === 'object'
      ? Object.values(raw.weekdaySleepModeEnabled)
      : [];
  const litter = typeof raw.litterLevelPercentage === 'number' ? raw.litterLevelPercentage : null;
  const weight = typeof raw.catWeight === 'number' && raw.catWeight > 0 ? raw.catWeight : null;
  return {
    family: FAMILIES.LR4,
    serial: String(raw.serial),
    id: String(raw.unitId ?? raw.serial),
    name: typeof raw.name === 'string' ? raw.name : '',
    online: raw.isOnline === true,
    status,
    rawStatus: typeof raw.robotStatus === 'string' ? raw.robotStatus : null,
    drawerLevel: clampPercent(int(raw.DFILevelPercent)),
    drawerFull: raw.isDFIFull === true,
    litterLevel: litter === null ? null : clampPercent(Math.round(litter * 100)),
    weightLb: weight,
    cycles: int(raw.odometerCleanCycles),
    cycleCapacity: int(raw.DFINumberOfCycles),
    waitMinutes: int(raw.cleanCycleWaitTime),
    nightLight: typeof raw.nightLightMode === 'string' ? raw.nightLightMode !== 'OFF' : null,
    nightLightMode: NIGHT_LIGHT_MODES.includes(raw.nightLightMode) ? raw.nightLightMode : null,
    panelLock: typeof raw.isKeypadLockout === 'boolean' ? raw.isKeypadLockout : null,
    sleepMode: sleepDays.some((day) => day?.isEnabled === true),
    lastSeen: parseTimestamp(raw.lastSeen),
  };
}

// --- Feeder-Robot --------------------------------------------------------------------

/** The dispensed feedings of the answer, newest first. */
function feedingsOf(raw) {
  const meals = (Array.isArray(raw.feeding_meal) ? raw.feeding_meal : []).map((meal) => ({
    at: parseTimestamp(meal.timestamp),
    kind: 'meal',
    name: typeof meal.meal_name === 'string' ? meal.meal_name : null,
    portions: int(meal.meal_total_portions) ?? 1,
  }));
  const snacks = (Array.isArray(raw.feeding_snack) ? raw.feeding_snack : []).map((snack) => ({
    at: parseTimestamp(snack.timestamp),
    kind: 'snack',
    name: null,
    portions: 1,
  }));
  return [...meals, ...snacks].filter((feeding) => feeding.at !== null).sort((a, b) => b.at - a.at);
}

export function parseFeederRobot(raw) {
  const info = raw.state?.info ?? {};
  let status = FEEDER_STATUS.READY;
  if (info.online !== true) {
    status = FEEDER_STATUS.OFFLINE;
  } else if (info.power === false) {
    status = FEEDER_STATUS.OFF;
  } else if (info.motorJammed === true) {
    status = FEEDER_STATUS.JAMMED;
  } else if (info.chuteFull === true || info.chuteFullExt === true) {
    status = FEEDER_STATUS.CHUTE_FULL;
  } else if (info.acPower === false && info.dcPower === true) {
    status = FEEDER_STATUS.ON_BATTERY;
  }
  const level = int(info.level);
  return {
    family: FAMILIES.FEEDER,
    serial: String(raw.serial),
    id: String(raw.id),
    name: typeof raw.name === 'string' ? raw.name : '',
    online: info.online === true,
    status,
    foodLevel: level === null ? null : (FOOD_LEVEL[level] ?? null),
    feedings: feedingsOf(raw),
    nightLight: typeof info.autoNightMode === 'boolean' ? info.autoNightMode : null,
    panelLock: typeof info.panelLockout === 'boolean' ? info.panelLockout : null,
  };
}

/** Local midnight of the day of `now` (the container runs in Gladys' time zone, TZ). */
export function startOfDay(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Portions dispensed since local midnight (meals count their portions, a snack one). */
export function portionsToday(feedings, now) {
  const since = startOfDay(now);
  return feedings.filter((f) => f.at >= since).reduce((total, f) => total + f.portions, 0);
}

/**
 * Parse one raw robot of a family; null when unusable (no serial: a robot
 * removed from the account, as pylitterbot skips them).
 */
export function parseRobot(family, raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const serial = family === FAMILIES.LR3 ? raw.litterRobotSerial : raw.serial;
  if (serial === null || serial === undefined || serial === '') {
    return null;
  }
  switch (family) {
    case FAMILIES.LR3:
      return parseLitterRobot3(raw);
    case FAMILIES.LR4:
      return parseLitterRobot4(raw);
    case FAMILIES.FEEDER:
      return parseFeederRobot(raw);
    default:
      return null;
  }
}

/** Pounds to kilograms, one decimal. */
export const lbToKg = (lb) => Math.round(lb * 0.45359237 * 10) / 10;
/** Pounds to grams, whole. */
export const lbToGrams = (lb) => Math.round(lb * 453.59237);
