// -----------------------------------------------------------------------------
// Configuration normalization: defaults, trimming, unknown values.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig } from '../src/config.js';

test('defaults: French, 5 minutes, kilograms, 4 portions, not configured', () => {
  const config = normalizeConfig();
  assert.deepEqual(config, {
    email: '',
    password: '',
    refreshMs: 5 * 60_000,
    weightUnit: 'kg',
    snackDailyLimit: 4,
    language: 'fr',
  });
  assert.equal(isConfigured(config), false);
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), config);
});

test('the e-mail is trimmed, the password kept as typed', () => {
  const config = normalizeConfig({ email: '  cat@example.com ', password: ' p a s s ' });
  assert.equal(config.email, 'cat@example.com');
  assert.equal(config.password, ' p a s s ');
  assert.equal(isConfigured(config), true);
});

test('unknown values fall back to the defaults; numbers given as numbers are read', () => {
  const config = normalizeConfig({
    refresh_minutes: 1,
    weight_unit: 'stone',
    snack_daily_limit: 8,
    language: 'it',
  });
  assert.equal(config.refreshMs, 5 * 60_000);
  assert.equal(config.weightUnit, 'kg');
  assert.equal(config.snackDailyLimit, 8);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ refresh_minutes: '15' }).refreshMs, 15 * 60_000);
  assert.equal(normalizeConfig(null).email, '');
});
