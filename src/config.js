// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// How often the robots are read again, in minutes: the safety net of the
// real-time subscriptions, and the only source for a Litter-Robot 3.
export const REFRESH_MINUTES = ['2', '5', '10', '15'];

export const WEIGHT_UNITS = ['kg', 'lb'];

// Portions Gladys may dispense per Feeder-Robot over 24 hours (scene action,
// device button): a scene that loops cannot empty the hopper.
export const SNACK_DAILY_LIMITS = ['1', '2', '3', '4', '6', '8'];

export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  refresh_minutes: '5',
  weight_unit: 'kg',
  snack_daily_limit: '4',
  language: 'fr',
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  return {
    // Cognito user names are case-insensitive e-mails: trimmed only.
    email: typeof source.email === 'string' ? source.email.trim() : '',
    // Kept as typed: spaces may be part of a password.
    password: typeof source.password === 'string' ? source.password : '',
    refreshMs: Number(pick('refresh_minutes', REFRESH_MINUTES)) * 60_000,
    weightUnit: pick('weight_unit', WEIGHT_UNITS),
    snackDailyLimit: Number(pick('snack_daily_limit', SNACK_DAILY_LIMITS)),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** Both credentials are filled in. */
export const isConfigured = (config) => config.email !== '' && config.password !== '';
