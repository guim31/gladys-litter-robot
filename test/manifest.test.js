// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  LANGUAGES,
  REFRESH_MINUTES,
  SNACK_DAILY_LIMITS,
  WEIGHT_UNITS,
} from '../src/config.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { ERROR_KIND } from '../src/whisker/model.js';
import { ACTIONS, WIDGETS } from '../src/widgets.js';
import { createWorld, feederId, lr4Id } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

async function world(t) {
  const w = await createWorld();
  t.after(() => w.app.stop());
  return w;
}

test('identity: name, image, cover, cloud transport, appliances category', () => {
  assert.equal(manifest.name, 'Litter-Robot');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-litter-robot:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-litter-robot/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['appliances']);
  assert.equal(manifest.network_discovery, undefined);
});

test('Gladys 5.1.0 at least: categories (4.86), scene triggers, scene actions, widgets', () => {
  for (const field of ['scene_triggers', 'scene_actions', 'widgets', 'categories']) {
    assert.ok(manifest[field], field);
  }
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]));
  // No widget button opens a form (that would need 5.2.0, Gladys#3168).
});

test('every manifest action has a handler', async (t) => {
  const w = await world(t);
  assert.deepEqual(keysOf(manifest.actions), ['test_connection']);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
});

test('every scene_actions key has a handler, and returns the declared outputs', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  const w = await world(t);
  const targets = {
    start_cleaning: lr4Id(w.gladys).device,
    dispense_snack: feederId(w.gladys).device,
  };
  for (const action of manifest.scene_actions) {
    const ack = await w.fake.sceneAction(action.key, { device: targets[action.key] });
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data?.outputs ?? {}).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
  }
  const refused = await w.fake.sceneAction('start_cleaning', { device: feederId(w.gladys).device });
  assert.equal(refused.success, false, 'a feeder does not clean');
});

test('the scene triggers are the ones the hub fires, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const w = await world(t);
  const robot = w.cloud.lr4[0];
  robot.robotStatus = 'ROBOT_CAT_DETECT_DELAY';
  robot.isDFIFull = true;
  await w.hub.readAll();
  robot.isOnline = false;
  await w.hub.readAll();
  const fired = new Map(w.fake.sceneEvents.map((event) => [event.key, event.data]));
  for (const trigger of manifest.scene_triggers) {
    const data = fired.get(trigger.key);
    assert.ok(data, `${trigger.key} was fired`);
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in data, `${trigger.key}: "${key}" is in the event data`);
    }
    for (const key of Object.keys(data)) {
      assert.ok(
        keysOf(trigger.variables).includes(key) || keysOf(trigger.fields).includes(key),
        `${trigger.key}: "${key}" is declared`,
      );
    }
    for (const field of trigger.fields) {
      assert.notEqual(field.type, 'boolean', 'no boolean filter on a trigger');
    }
  }
  const kinds = manifest.scene_triggers
    .find((trigger) => trigger.key === TRIGGERS.ERROR)
    .fields.find((field) => field.key === 'kind')
    .options.map((option) => option.value);
  assert.deepEqual(kinds.sort(), Object.values(ERROR_KIND).sort());
});

test('every widgets key has a handler, with its button actions', async (t) => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.equal(new Set(Object.values(ACTIONS)).size, Object.values(ACTIONS).length);
  const w = await world(t);
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {} });
  assert.equal(ack.success, true, ack.error);
});

test('config_schema defaults and options stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  const options = (key) =>
    manifest.config_schema.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(options('language'), LANGUAGES);
  assert.deepEqual(options('refresh_minutes'), REFRESH_MINUTES);
  assert.deepEqual(options('weight_unit'), WEIGHT_UNITS);
  assert.deepEqual(options('snack_daily_limit'), SNACK_DAILY_LIMITS);
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((f) => f.type !== 'section')
      .map((f) => f.key)
      .sort(),
  );
  assert.equal(manifest.config_schema.find((f) => f.key === 'password').type, 'secret');
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key}`);
      }
    }
  }
});

test('actions declare no secret field, no required field (no default is applied)', () => {
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret');
      assert.notEqual(field.required, true);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
