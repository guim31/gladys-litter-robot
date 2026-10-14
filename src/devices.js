// -----------------------------------------------------------------------------
// One Gladys device per robot of the Whisker account.
//
// Identity: the serial number (gladys.externalIds('litter-robot' | 'feeder-robot',
// serial)), printed on the robot and kept by the cloud for its whole life.
// The robot's nickname is only the default device name.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js):
//   - state: text/text, the robot's state in words (language of the config);
//   - waste drawer, litter level, food level: counter-sensor/integer in %,
//     cycle counters and portions: counter-sensor/integer — several counters
//     per device, so Gladys shows their names, not the generic label;
//   - cat weight (LR4): counter-sensor/integer in grams — Gladys has no mass
//     unit, so the unit is in the name;
//   - clean, reset drawer (LR3), dispense a portion (Feeder): button/push;
//   - cleaning delay: text/select of the delays the model accepts;
//   - night light: switch/binary (LR3, Feeder automatic mode), text/select
//     Off/On/Automatic (LR4); not light/binary, so that "turn off the lights"
//     scenes leave the litter box alone;
//   - panel lock: child-lock/binary; sleep mode: input/binary, read only;
//   - last visit, last meal: text/text.
//
// should_poll: false — the hub reads the cloud on its own timer and receives
// the live updates (GladysAssistant/Gladys#3198, and a pace above one minute
// is not in the core's list anyway).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { FAMILIES } from './whisker/client.js';
import { NIGHT_LIGHT_MODES, lbToGrams, portionsToday } from './whisker/model.js';
import {
  FEATURE_KEYS as K,
  MEAL_TEXT,
  NAMES,
  OPTION_TEXT,
  formatDateTime,
  pick,
  statusText,
} from './texts.js';

export const DEVICE_TYPES = Object.freeze({
  LITTER_ROBOT: 'litter-robot',
  FEEDER_ROBOT: 'feeder-robot',
});

export const MODEL_NAMES = {
  [FAMILIES.LR3]: 'Litter-Robot 3 Connect',
  [FAMILIES.LR4]: 'Litter-Robot 4',
  [FAMILIES.FEEDER]: 'Feeder-Robot',
};

// Cleaning delays each model accepts, in minutes (pylitterbot VALID_WAIT_TIMES).
export const WAIT_TIMES = {
  [FAMILIES.LR3]: [3, 7, 15],
  [FAMILIES.LR4]: [3, 7, 15, 25, 30],
};

// Display bounds (the core never applies them on write).
const MAX_CYCLES = 1_000_000;
const MAX_GRAMS = 15_000;

const text = { category: CAT.TEXT, type: TYPE.TEXT.TEXT, read_only: true, min: 0, max: 0 };
const percent = {
  category: CAT.COUNTER_SENSOR,
  type: TYPE.SENSOR.INTEGER,
  read_only: true,
  unit: UNIT.PERCENT,
  min: 0,
  max: 100,
};
const counter = (max) => ({
  category: CAT.COUNTER_SENSOR,
  type: TYPE.SENSOR.INTEGER,
  read_only: true,
  min: 0,
  max,
});
const push = { category: CAT.BUTTON, type: TYPE.BUTTON.PUSH, read_only: false, min: 0, max: 1 };
const select = { category: CAT.TEXT, type: TYPE.TEXT.SELECT, read_only: false, min: 0, max: 0 };
const toggle = (category) => ({
  category,
  type: TYPE.SWITCH.BINARY,
  read_only: false,
  min: 0,
  max: 1,
});
const readOnlyFlag = {
  category: CAT.INPUT,
  type: TYPE.SWITCH.BINARY,
  read_only: true,
  min: 0,
  max: 1,
};

const bool = (value) => (value === null || value === undefined ? null : value ? 1 : 0);
const textValue = (value) => (typeof value === 'string' && value !== '' ? { text: value } : null);

/**
 * The features of each family, in display order: definition, and the value
 * of a snapshot (null: nothing to publish). `context`: { language, lastVisit, now }.
 */
const FEATURES = {
  [FAMILIES.LR3]: [
    { key: K.STATUS, def: text, value: (s, c) => textValue(statusText(s.status, c.language)) },
    { key: K.WASTE_DRAWER, def: percent, value: (s) => s.drawerLevel },
    { key: K.DRAWER_CYCLES, def: counter(MAX_CYCLES), value: (s) => s.cycles },
    { key: K.CLEAN, def: push, value: () => null },
    { key: K.RESET_DRAWER, def: push, value: () => null },
    { key: K.WAIT_TIME, def: select, options: 'wait', value: (s) => waitValue(s) },
    { key: K.NIGHT_LIGHT, def: toggle(CAT.SWITCH), value: (s) => bool(s.nightLight) },
    { key: K.PANEL_LOCK, def: toggle(CAT.CHILD_LOCK), value: (s) => bool(s.panelLock) },
    { key: K.SLEEP_MODE, def: readOnlyFlag, value: (s) => bool(s.sleepMode) },
    { key: K.LAST_VISIT, def: text, value: (s, c) => visitValue(c) },
  ],
  [FAMILIES.LR4]: [
    { key: K.STATUS, def: text, value: (s, c) => textValue(statusText(s.status, c.language)) },
    { key: K.WASTE_DRAWER, def: percent, value: (s) => s.drawerLevel },
    { key: K.LITTER_LEVEL, def: percent, value: (s) => s.litterLevel },
    {
      key: K.CAT_WEIGHT,
      def: counter(MAX_GRAMS),
      value: (s) => (s.weightLb === null ? null : lbToGrams(s.weightLb)),
    },
    { key: K.TOTAL_CYCLES, def: counter(MAX_CYCLES), value: (s) => s.cycles },
    { key: K.CLEAN, def: push, value: () => null },
    { key: K.WAIT_TIME, def: select, options: 'wait', value: (s) => waitValue(s) },
    {
      key: K.NIGHT_LIGHT_MODE,
      def: select,
      options: 'nightLight',
      value: (s) => (s.nightLightMode ? { text: s.nightLightMode } : null),
    },
    { key: K.PANEL_LOCK, def: toggle(CAT.CHILD_LOCK), value: (s) => bool(s.panelLock) },
    { key: K.SLEEP_MODE, def: readOnlyFlag, value: (s) => bool(s.sleepMode) },
    { key: K.LAST_VISIT, def: text, value: (s, c) => visitValue(c) },
  ],
  [FAMILIES.FEEDER]: [
    { key: K.STATUS, def: text, value: (s, c) => textValue(statusText(s.status, c.language)) },
    { key: K.FOOD_LEVEL, def: percent, value: (s) => s.foodLevel },
    {
      key: K.PORTIONS_TODAY,
      def: counter(1000),
      value: (s, c) => portionsToday(s.feedings, c.now),
    },
    { key: K.LAST_MEAL, def: text, value: (s, c) => mealValue(s, c) },
    { key: K.SNACK, def: push, value: () => null },
    { key: K.AUTO_NIGHT_LIGHT, def: toggle(CAT.SWITCH), value: (s) => bool(s.nightLight) },
    { key: K.PANEL_LOCK, def: toggle(CAT.CHILD_LOCK), value: (s) => bool(s.panelLock) },
  ],
};

function waitValue(snapshot) {
  const allowed = WAIT_TIMES[snapshot.family] ?? [];
  return allowed.includes(snapshot.waitMinutes) ? { text: String(snapshot.waitMinutes) } : null;
}

function visitValue({ lastVisit, language }) {
  return lastVisit ? { text: formatDateTime(lastVisit, language) } : null;
}

/** "Tue, Oct 14, 7:30 AM · Breakfast · 2 portions". */
export function describeFeeding(feeding, language) {
  const name =
    feeding.kind === 'snack'
      ? pick(MEAL_TEXT.snack, language)
      : (feeding.name ?? pick(MEAL_TEXT.meal, language));
  return [
    formatDateTime(feeding.at, language),
    name,
    pick(MEAL_TEXT.portions, language)(feeding.portions),
  ].join(' · ');
}

function mealValue(snapshot, { language }) {
  const [last] = snapshot.feedings;
  return last ? { text: describeFeeding(last, language) } : null;
}

function optionsOf(kind, family, language) {
  if (kind === 'wait') {
    return WAIT_TIMES[family].map((minutes, index) => ({
      value: String(minutes),
      label: `${minutes} min`,
      sort_order: index,
    }));
  }
  return NIGHT_LIGHT_MODES.map((mode, index) => ({
    value: mode,
    label: pick(OPTION_TEXT[mode], language),
    sort_order: index,
  }));
}

export const deviceTypeOf = (family) =>
  family === FAMILIES.FEEDER ? DEVICE_TYPES.FEEDER_ROBOT : DEVICE_TYPES.LITTER_ROBOT;

/** External ids of a robot's device and features. */
export const deviceIds = (gladys, snapshot) =>
  gladys.externalIds(deviceTypeOf(snapshot.family), snapshot.serial);

/** The keys of the features of a family. */
export const featureKeys = (family) => FEATURES[family].map((feature) => feature.key);

/** The name shown for a robot: its nickname, else its model. */
export const robotName = (snapshot) => snapshot.name || MODEL_NAMES[snapshot.family];

/**
 * The discovery payload of a robot.
 * @param {object} gladys SDK client
 * @param {object} snapshot src/whisker/model.js
 * @param {string} language feature names language
 */
export function buildDevice(gladys, snapshot, language = 'fr') {
  const ids = deviceIds(gladys, snapshot);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: robotName(snapshot),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: 'MODEL', value: MODEL_NAMES[snapshot.family] }],
    features: FEATURES[snapshot.family].map(({ key, def, options }) => ({
      ...def,
      has_feedback: !def.read_only && def.type !== TYPE.BUTTON.PUSH,
      keep_history: def.category !== CAT.TEXT || def.type === TYPE.TEXT.TEXT,
      name: names[key],
      external_id: ids.feature(key),
      ...(options ? { supported_options: optionsOf(options, snapshot.family, language) } : {}),
    })),
  };
}

/**
 * The states of a robot, in the publishStates format (values to publish only).
 * @param {object} context { language, lastVisit, now }
 */
export function featureStates(gladys, snapshot, context) {
  const ids = deviceIds(gladys, snapshot);
  const states = [];
  for (const { key, value } of FEATURES[snapshot.family]) {
    const result = value(snapshot, context);
    if (result === null || result === undefined) {
      continue;
    }
    states.push(
      typeof result === 'object'
        ? { device_feature_external_id: ids.feature(key), text: result.text }
        : { device_feature_external_id: ids.feature(key), state: result },
    );
  }
  return states;
}

/** The feature key of a feature external id of this device, or null. */
export function featureKeyOf(gladys, snapshot, featureExternalId) {
  const ids = deviceIds(gladys, snapshot);
  return featureKeys(snapshot.family).find((key) => ids.feature(key) === featureExternalId) ?? null;
}
