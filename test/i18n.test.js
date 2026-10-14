// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, and the four documentation files, with the same sections. German says
// "du", never the polite "Sie"; Spanish says "usted". (Adapted from
// guim31/gladys-wled and guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  DONE_TEXT,
  ERROR_KIND_TEXT,
  ERROR_TEXT,
  INIT_FAILED,
  MEAL_TEXT,
  NAMES,
  OPTION_TEXT,
  REPORT_TEXT,
  STATUS_TEXT,
} from '../src/texts.js';
import { ERROR_KINDS } from '../src/whisker/http.js';
import { ERROR_KIND, FEEDER_STATUS, STATUS } from '../src/whisker/model.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  status: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

/** A multi-language object whose texts may be functions: rendered with sample values. */
const rendered = (value) =>
  Object.fromEntries(
    Object.entries(value).map(([lang, text]) => [
      lang,
      typeof text === 'function' ? text(2) : text,
    ]),
  );

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 70, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language, 3 to 30 characters', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('every message table of the code has the four languages', () => {
  const longWidgetTexts = new Set(['notConfigured', 'noRobot', 'unknown', 'accountError']);
  const statusTexts = new Set(['noVisit', 'lastVisit', 'weight']);
  const each = (table, name, max) =>
    Object.entries(table).flatMap(([key, value]) =>
      problems(rendered(value), `${name}.${key}`, typeof max === 'function' ? max(key) : max),
    );
  const found = [
    ...problems(INIT_FAILED, 'INIT_FAILED', MAX.message),
    ...each(CONNECTION_TEXT, 'CONNECTION_TEXT', MAX.message),
    ...each(ACTION_TEXT, 'ACTION_TEXT', MAX.message),
    ...each(ERROR_TEXT, 'ERROR_TEXT', MAX.message),
    ...each(DONE_TEXT, 'DONE_TEXT', MAX.message),
    ...each(STATUS_TEXT, 'STATUS_TEXT', MAX.status),
    ...each(ERROR_KIND_TEXT, 'ERROR_KIND_TEXT', MAX.status),
    ...each(OPTION_TEXT, 'OPTION_TEXT', MAX.short),
    ...each(MEAL_TEXT, 'MEAL_TEXT', MAX.short),
    ...each(TEXT, 'TEXT', (key) =>
      longWidgetTexts.has(key) ? MAX.message : statusTexts.has(key) ? MAX.status : MAX.short,
    ),
  ];
  assert.deepEqual(found, []);
  assert.deepEqual(sorted(Object.keys(ERROR_TEXT)), sorted(Object.values(ERROR_KINDS)));
  assert.deepEqual(sorted(Object.keys(ERROR_KIND_TEXT)), sorted(Object.values(ERROR_KIND)));
  for (const status of [...Object.values(STATUS), ...Object.values(FEEDER_STATUS)]) {
    assert.ok(STATUS_TEXT[status], `no text for the state ${status}`);
  }
});

test('the error kinds read the same in the manifest filter and in the trigger message', () => {
  const options = manifest.scene_triggers
    .find((trigger) => trigger.key === 'robot_error')
    .fields.find((field) => field.key === 'kind').options;
  for (const option of options) {
    assert.deepEqual(option.label, ERROR_KIND_TEXT[option.value], option.value);
  }
});

test('the feature names exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
});

test('the reports exist in every language', () => {
  const render = (value) => (typeof value === 'function' ? value(3) : value);
  assert.deepEqual(tableProblems(REPORT_TEXT, 'REPORT_TEXT', MAX.message, render), []);
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre IP', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[0].fields[0].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[0].fields[0].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentation files exist, with the same sections', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(headings(docs[lang]), headings(docs.en), `docs/${lang}.md sections`);
  }
  assert.ok(headings(docs.en).length >= 12);
});

test('the documentation names every trigger, action, widget button and feature', () => {
  for (const lang of LANGS) {
    const doc = docs[lang];
    for (const item of [
      ...manifest.scene_triggers,
      ...manifest.scene_actions,
      ...manifest.actions,
    ]) {
      assert.ok(doc.includes(item.label[lang]), `docs/${lang}.md: "${item.label[lang]}"`);
    }
    for (const key of ['clean', 'resetDrawer', 'drawer', 'visits', 'lastVisit', 'weight']) {
      assert.ok(doc.includes(TEXT[key][lang]), `docs/${lang}.md: "${TEXT[key][lang]}"`);
    }
    for (const name of Object.values(NAMES[lang])) {
      assert.ok(doc.includes(name), `docs/${lang}.md: feature "${name}"`);
    }
    for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
      assert.ok(doc.includes(field.label[lang]), `docs/${lang}.md: option "${field.label[lang]}"`);
    }
  }
});

test('the German documentation says "du", the Spanish one "usted"', () => {
  const polite = docs.de
    .split('\n')
    .filter((line) => !line.startsWith('`') && POLITE_GERMAN.test(line));
  assert.deepEqual(polite, []);
  assert.doesNotMatch(
    docs.es,
    /(?<!\p{L})(tienes|puedes|tu cuenta|elige)(?!\p{L})/iu,
    'no "tú" in Spanish',
  );
});

test('the documentation says it was developed without the hardware, and not affiliated', () => {
  assert.match(docs.en, /Developed without the hardware: feedback welcome/);
  assert.match(docs.en, /not\s+affiliated with Whisker/);
  for (const lang of LANGS) {
    assert.match(docs[lang], /github\.com\/guim31\/gladys-litter-robot\/issues/);
  }
});
