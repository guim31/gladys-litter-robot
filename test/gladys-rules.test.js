// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (the real answers published by pylitterbot and Home Assistant):
// two Litter-Robot 3 Connect, two Litter-Robot 4 and a Feeder-Robot, in every
// feature-name language, before and after the devices are added.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled and guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeWhisker, fixture } from './helpers/fakeWhisker.js';
import { CONFIG, createAll, createClock, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'English names', language: 'en' },
  { label: 'French names', language: 'fr' },
  { label: 'German names', language: 'de' },
  { label: 'Spanish names', language: 'es' },
];

const fleet = (clock) => {
  const [ready, deleted, full] = fixture('lr3-robots');
  return new FakeWhisker({
    now: clock.now,
    lr3: [ready, deleted, full],
    lr4: [fixture('lr4-robot-pylitterbot'), fixture('lr4-robot')],
    feeders: [fixture('feeder-robot')],
  });
};

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const clock = createClock();
    const world = await createWorld({
      clock,
      cloud: fleet(clock),
      config: { ...CONFIG, language: scenario.language },
    });
    try {
      const devices = world.fake.discoveredDevices;
      assert.equal(devices.length, 5, 'the robot without serial is skipped');
      await createAll(world);
      // A visit, so that "Last visit" has a value too.
      const lr4 = world.cloud.lr4[0];
      lr4.robotStatus = 'ROBOT_CAT_DETECT_DELAY';
      await world.hub.readAll({ discover: true });

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // String options only on text/select (400 elsewhere), unique values.
          if (feature.supported_options) {
            assert.equal(`${feature.category}/${feature.type}`, 'text/select', `${at}: options`);
            const values = feature.supported_options.map((option) => option.value);
            assert.equal(new Set(values).size, values.length, `${at}: duplicate option`);
            for (const option of feature.supported_options) {
              assert.ok(typeof option.label === 'string' && option.label !== '', `${at}: label`);
            }
          }

          // The value read from the fixtures fits the declared bounds.
          if (feature.type === 'push') {
            continue; // a command, never a state
          }
          const state = world.fake.states.findLast(
            (s) => s.device_feature_external_id === feature.external_id,
          );
          if (feature.category === 'text') {
            if (
              feature.external_id.endsWith(':last_meal') ||
              feature.external_id.endsWith(':last_visit')
            ) {
              if (!state) continue; // nothing to tell yet
            }
            assert.equal(typeof state?.text, 'string', `${at}: no text state published`);
            assert.ok(state.text.length > 0, `${at}: empty text`);
            if (feature.supported_options) {
              assert.ok(
                feature.supported_options.some((o) => o.value === state.text),
                `${at}: ${state.text} is not one of the options`,
              );
            }
            continue;
          }
          if (feature.external_id.endsWith(':cat_weight') && !state) {
            continue; // SmartWeight off
          }
          const value = state?.state;
          assert.equal(typeof value, 'number', `${at}: no state published`);
          assert.ok(value >= feature.min && value <= feature.max, `${at}: ${value} out of bounds`);
          assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
        }
      }
      assert.ok(
        world.fake.states.some((s) => s.device_feature_external_id.endsWith(':last_visit')),
        'the visit was published',
      );
    } finally {
      await world.app.stop();
    }
  });
}
