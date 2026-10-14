// -----------------------------------------------------------------------------
// The dashboard widget: every content it can produce passes the core's
// vocabulary and budget (validateWidgetContent: [] = rendered exactly as
// sent), the buttons reach the robot, the texts follow the language.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { CONFIG, createWorld, lr3Id, lr4Id } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const content = async (w, settings = {}, language = 'en') => {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], 'within the vocabulary and budget');
  return ack.data.content;
};
const ofType = (c, type) => c.components.filter((component) => component.type === type);

test('Litter-Robot 3 (the first robot by default): drawer, visits, state, Clean and Drawer emptied', async (t) => {
  const w = await world(t);
  const c = await content(w);
  assert.deepEqual(
    ofType(c, 'value').map((v) => [v.label, v.value]),
    [
      ['Drawer', 50],
      ['Visits today', 0],
    ],
  );
  const [status] = ofType(c, 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Test', 'Ready'],
      ['Last visit', 'None seen yet'],
    ],
  );
  assert.deepEqual(
    ofType(c, 'button').map((b) => [b.label, b.action.key, b.action.confirm]),
    [
      ['Clean', 'clean', true],
      ['Drawer emptied', 'reset_drawer', true],
    ],
  );
  for (const button of ofType(c, 'button')) {
    assert.notEqual(button.icon, 'check-circle', 'a check mark means "current choice"');
  }
});

test('Litter-Robot 4: litter level and weight in the configured unit, visits after one', async (t) => {
  const w = await world(t, { config: { ...CONFIG, weight_unit: 'lb' } });
  w.cloud.lr4[0].robotStatus = 'ROBOT_CAT_DETECT_DELAY';
  await w.hub.readAll();
  const c = await content(w, { device: lr4Id(w.gladys).device }, 'fr');
  assert.deepEqual(
    ofType(c, 'value').map((v) => [v.label, v.value]),
    [
      ['Tiroir', 91],
      ['Litière', 40],
      ['Visites du jour', 1],
    ],
  );
  const items = ofType(c, 'status')[0].items;
  assert.equal(items[0].value, 'Attente avant nettoyage');
  assert.match(items[1].value, /^\d{1,2}:\d{2}$/, 'a visit of today: the time only');
  assert.equal(items[2].value, '7.9 lb');
  assert.equal(c.ttl_seconds, 30, 'a countdown runs: refresh sooner');
  assert.equal(ofType(c, 'button').length, 1, 'no drawer counter on a LR4');

  await w.fake.configUpdated({ ...CONFIG, weight_unit: 'kg' });
  const kg = await content(w, { device: lr4Id(w.gladys).device }, 'fr');
  assert.equal(ofType(kg, 'status')[0].items[2].value, '3,6 kg');
});

test('the Clean button starts a cleaning and says so; Drawer emptied resets a LR3', async (t) => {
  const w = await world(t);
  const settings = { device: lr3Id(w.gladys).device };
  const clean = await w.fake.widgetAction(WIDGET_KEY, 'clean', {}, { settings });
  assert.equal(clean.success, true, clean.error);
  assert.equal(clean.data.message.en, 'Cleaning started on Test.');
  assert.equal(clean.data.message.fr, 'Nettoyage lancé sur Test.');
  const reset = await w.fake.widgetAction(WIDGET_KEY, 'reset_drawer', {}, { settings });
  assert.equal(reset.success, true, reset.error);
  assert.deepEqual(
    w.cloud.commands.map((c) => c.command ?? 'patch'),
    ['C', 'patch'],
  );
  const refused = await w.fake.widgetAction(
    WIDGET_KEY,
    'clean',
    {},
    {
      settings: { device: 'ext:test-integration:litter-robot:GONE' },
    },
  );
  assert.equal(refused.success, false);
});

test('the messages: not configured, no robot, robot gone, account down', async (t) => {
  const empty = await world(t, { config: { language: 'en' } });
  assert.match((await content(empty)).components[0].text, /Whisker account/);

  const { FakeWhisker } = await import('./helpers/fakeWhisker.js');
  const feederOnly = await world(t, { cloud: new FakeWhisker({ lr3: [], lr4: [] }) });
  assert.match((await content(feederOnly, {}, 'de')).components[0].text, /Kein Litter-Robot/);
  assert.match(
    (await content(feederOnly, { device: 'ext:test-integration:litter-robot:GONE' }, 'es'))
      .components[0].text,
    /ya no está/,
  );

  const w = await world(t);
  w.cloud.online = false;
  await w.hub.readAll();
  const down = await content(w);
  assert.equal(down.components[0].type, 'text');
  assert.match(down.components[0].text, /does not answer/);
});

test('the widget is nudged when what it shows changes', async (t) => {
  const w = await world(t);
  const before = w.fake.widgetRefreshes.length;
  await w.hub.readAll();
  assert.equal(w.fake.widgetRefreshes.length, before, 'nothing changed');
  w.cloud.lr3[0].unitStatus = 'CCP';
  await w.hub.readAll();
  assert.ok(w.fake.widgetRefreshes.length > before);
});
