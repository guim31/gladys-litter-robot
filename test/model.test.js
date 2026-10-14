// -----------------------------------------------------------------------------
// From the real answers of the Whisker cloud (test/fixtures/whisker) to the
// robot snapshots: status codes, the LR4 status algorithm and the LR3 drawer
// level of pylitterbot, the Feeder food level and feedings.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES } from '../src/whisker/client.js';
import {
  ERROR_KIND,
  FEEDER_STATUS,
  STATUS,
  errorKindOf,
  lbToGrams,
  lbToKg,
  parseRobot,
  parseTimestamp,
  portionsToday,
} from '../src/whisker/model.js';
import { fixture } from './helpers/fakeWhisker.js';

const [lr3Ready, lr3Deleted, lr3Full] = fixture('lr3-robots');

test('Litter-Robot 3: a ready robot', () => {
  const robot = parseRobot(FAMILIES.LR3, lr3Ready);
  assert.equal(robot.serial, 'LR3C012345');
  assert.equal(robot.id, 'a0123b4567cd8e');
  assert.equal(robot.name, 'Test');
  assert.equal(robot.status, STATUS.READY);
  assert.equal(robot.online, true);
  assert.equal(robot.cycles, 15);
  assert.equal(robot.drawerLevel, 50); // 15 of 30 cycles
  assert.equal(robot.drawerFull, false);
  assert.equal(robot.waitMinutes, 7);
  assert.equal(robot.nightLight, true);
  assert.equal(robot.panelLock, false);
  assert.equal(robot.sleepMode, true);
  assert.equal(robot.litterLevel, null, 'no litter sensor on a LR3');
  assert.equal(robot.lastSeen, Date.UTC(2021, 1, 1, 0, 30));
});

test('Litter-Robot 3: "2 cycles left" caps the capacity, like pylitterbot', () => {
  const robot = parseRobot(FAMILIES.LR3, lr3Full);
  assert.equal(robot.status, STATUS.DRAWER_FULL_1);
  assert.equal(robot.cycleCapacity, 30); // 28 + 2
  assert.equal(robot.drawerLevel, 93);
  assert.equal(robot.drawerFull, true, 'drawer full indicator and more than 9 cycles');
});

test('Litter-Robot 3: full drawer, hexadecimal delay, power lost, deleted robot', () => {
  assert.equal(parseRobot(FAMILIES.LR3, { ...lr3Ready, unitStatus: 'DFS' }).drawerLevel, 100);
  assert.equal(
    parseRobot(FAMILIES.LR3, { ...lr3Ready, cleanCycleWaitTimeMinutes: 'F' }).waitMinutes,
    15,
  );
  const unplugged = parseRobot(FAMILIES.LR3, { ...lr3Ready, powerStatus: 'NC' });
  assert.equal(unplugged.status, STATUS.OFFLINE);
  assert.equal(unplugged.online, false);
  assert.equal(parseRobot(FAMILIES.LR3, lr3Deleted), null, 'no serial: skipped');
  assert.equal(parseRobot(FAMILIES.LR3, { ...lr3Ready, unitStatus: 'XYZ' }).status, STATUS.UNKNOWN);
});

test('Litter-Robot 3: the Home Assistant fixture', () => {
  const robot = parseRobot(FAMILIES.LR3, fixture('lr3-robot-ha'));
  assert.equal(robot.status, STATUS.READY);
  assert.equal(robot.sleepMode, true);
  assert.equal(robot.drawerLevel, 50);
});

test('Litter-Robot 4: the pylitterbot and Home Assistant fixtures', () => {
  const robot = parseRobot(FAMILIES.LR4, fixture('lr4-robot-pylitterbot'));
  assert.equal(robot.serial, 'LR4C000001');
  assert.equal(robot.status, STATUS.READY);
  assert.equal(robot.drawerLevel, 91);
  assert.equal(robot.litterLevel, 40);
  assert.equal(robot.weightLb, 7.93);
  assert.equal(robot.cycles, 93);
  assert.equal(robot.waitMinutes, 7);
  assert.equal(robot.nightLightMode, 'AUTO');
  assert.equal(robot.nightLight, true);
  assert.equal(robot.panelLock, false);
  assert.equal(robot.sleepMode, true);

  const ha = parseRobot(FAMILIES.LR4, fixture('lr4-robot'));
  assert.equal(ha.serial, 'LR4C010001');
  assert.equal(ha.id, 'LR4C010001', 'no unitId in this answer: the serial stands in');
  assert.equal(ha.weightLb, 12);
  assert.equal(ha.litterLevel, 70);
  assert.equal(ha.nightLightMode, 'OFF');
});

test('Litter-Robot 4: the status follows pylitterbot', () => {
  const base = fixture('lr4-robot-pylitterbot');
  const status = (changes) => parseRobot(FAMILIES.LR4, { ...base, ...changes }).status;
  assert.equal(status({ isOnline: false }), STATUS.OFFLINE);
  assert.equal(status({ unitPowerStatus: 'OFF' }), STATUS.OFF);
  assert.equal(status({ robotCycleState: 'CYCLE_STATE_PAUSE' }), STATUS.PAUSED);
  assert.equal(
    status({ robotCycleState: 'CYCLE_STATE_CAT_DETECT' }),
    STATUS.CAT_SENSOR_INTERRUPTED,
  );
  assert.equal(status({ robotStatus: 'ROBOT_CLEAN' }), STATUS.CLEAN_CYCLE);
  assert.equal(status({ robotStatus: 'ROBOT_CAT_DETECT_DELAY' }), STATUS.CAT_SENSOR_TIMING);
  assert.equal(status({ displayCode: 'DC_CAT_DETECT' }), STATUS.CAT_DETECTED);
  assert.equal(status({ isDFIFull: true }), STATUS.DRAWER_FULL);
  assert.equal(status({ robotStatus: 'ROBOT_SOMETHING_NEW' }), STATUS.UNKNOWN);
  assert.equal(parseRobot(FAMILIES.LR4, { ...base, catWeight: 0 }).weightLb, null);
});

test('Feeder-Robot: food level, feedings, states', () => {
  const raw = fixture('feeder-robot');
  const feeder = parseRobot(FAMILIES.FEEDER, raw);
  assert.equal(feeder.serial, 'RF1C000001');
  assert.equal(feeder.id, '1');
  assert.equal(feeder.status, FEEDER_STATUS.READY);
  assert.equal(feeder.foodLevel, 10); // sensor step 2
  assert.equal(feeder.nightLight, true);
  assert.equal(feeder.panelLock, false);
  assert.deepEqual(
    feeder.feedings.map((f) => [f.kind, f.name, f.portions]),
    [
      ['meal', 'Lunch', 2],
      ['meal', 'Breakfast', 1],
      ['snack', null, 1],
      ['snack', null, 1],
    ],
  );
  const lunch = Date.parse('2022-09-08T18:00:00Z');
  assert.equal(portionsToday(feeder.feedings, lunch + 60_000), 3);

  const with_ = (info) =>
    parseRobot(FAMILIES.FEEDER, {
      ...raw,
      state: { ...raw.state, info: { ...raw.state.info, ...info } },
    });
  assert.equal(with_({ online: false }).status, FEEDER_STATUS.OFFLINE);
  assert.equal(with_({ motorJammed: true }).status, FEEDER_STATUS.JAMMED);
  assert.equal(with_({ chuteFull: true }).status, FEEDER_STATUS.CHUTE_FULL);
  assert.equal(with_({ acPower: false, dcPower: true }).status, FEEDER_STATUS.ON_BATTERY);
  assert.equal(with_({ level: 9 }).foodLevel, 100);
});

test('errors by kind, for the trigger', () => {
  assert.equal(errorKindOf(STATUS.OVER_TORQUE_FAULT), ERROR_KIND.MOTOR);
  assert.equal(errorKindOf(STATUS.STARTUP_PINCH_DETECT), ERROR_KIND.PINCH);
  assert.equal(errorKindOf(STATUS.CAT_SENSOR_FAULT), ERROR_KIND.CAT_SENSOR);
  assert.equal(errorKindOf(STATUS.BONNET_REMOVED), ERROR_KIND.BONNET);
  assert.equal(errorKindOf(STATUS.OFFLINE), ERROR_KIND.OFFLINE);
  assert.equal(errorKindOf(FEEDER_STATUS.JAMMED), ERROR_KIND.FEEDER_JAM);
  for (const ok of [STATUS.READY, STATUS.CLEAN_CYCLE, STATUS.DRAWER_FULL, STATUS.PAUSED]) {
    assert.equal(errorKindOf(ok), null, ok);
  }
});

test('timestamps and weights', () => {
  assert.equal(parseTimestamp('2021-02-01T00:30:00.000000'), Date.UTC(2021, 1, 1, 0, 30));
  assert.equal(parseTimestamp('2022-07-20T00:13:00.000000Z'), Date.UTC(2022, 6, 20, 0, 13));
  assert.equal(parseTimestamp('2022-09-08T18:00:00.000000+00:00'), Date.UTC(2022, 8, 8, 18));
  assert.equal(parseTimestamp(1612132200), 1612132200000);
  assert.equal(parseTimestamp(''), null);
  assert.equal(parseTimestamp('soon'), null);
  assert.equal(lbToKg(7.93), 3.6);
  assert.equal(lbToGrams(7.93), 3597);
});
