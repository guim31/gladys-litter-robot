// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `litter_robot`.
//
// The use case: from the hallway tablet, see whether the drawer must be
// emptied and when the cat last went, and start a cleaning after scooping or
// when guests arrive. So: the drawer level, the litter level (LR4) and the
// visits of the day as tiles; the state, the last visit and the last weight
// as status rows; a "Clean" button (with confirmation: the globe turns), and
// on a Litter-Robot 3 a "Drawer emptied" button that sets its counter back
// to zero.
//
// One robot: the one chosen in the widget settings, else the first
// Litter-Robot of the account. The figures are sent as values, not bound to
// device features, so the widget works before the device is added.
// Budget (8 components, 6 tiles, 2 texts, 1 status, 4 buttons): at most
// 3 tiles, 1 text, 1 status, 2 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceIds, robotName } from './devices.js';
import { WIDGET_KEY, isLitterRobot } from './hub.js';
import { DONE_TEXT, formatDateTime, formatTime, pick, render, statusText } from './texts.js';
import { FAMILIES } from './whisker/client.js';
import { STATUS, errorKindOf, lbToKg, startOfDay } from './whisker/model.js';

// Action keys of the buttons: permanent once published, and unique (the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  CLEAN: 'clean',
  RESET_DRAWER: 'reset_drawer',
});

export const TEXT = {
  notConfigured: {
    en: 'Enter your Whisker account in the configuration of the integration.',
    fr: "Saisissez votre compte Whisker dans la configuration de l'intégration.",
    de: 'Gib dein Whisker-Konto in der Konfiguration der Integration ein.',
    es: 'Introduzca su cuenta Whisker en la configuración de la integración.',
  },
  noRobot: {
    en: 'No Litter-Robot on this Whisker account (yet).',
    fr: "Aucun Litter-Robot sur ce compte Whisker (pour l'instant).",
    de: 'Kein Litter-Robot in diesem Whisker-Konto (noch nicht).',
    es: 'No hay ningún Litter-Robot en esta cuenta Whisker (todavía).',
  },
  unknown: {
    en: 'This robot is no longer on the account: choose another one in the widget settings.',
    fr: "Ce robot n'est plus sur le compte : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieser Roboter ist nicht mehr im Konto: Wähle einen anderen in den Widget-Einstellungen.',
    es: 'Este robot ya no está en la cuenta: elija otro en la configuración del widget.',
  },
  accountError: {
    en: 'The Whisker account does not answer: see the Configuration screen of the integration.',
    fr: "Le compte Whisker ne répond pas : voir l'écran Configuration de l'intégration.",
    de: 'Das Whisker-Konto antwortet nicht: Sieh dir die Konfiguration der Integration an.',
    es: 'La cuenta Whisker no responde: consulte la pantalla de configuración de la integración.',
  },
  drawer: { en: 'Drawer', fr: 'Tiroir', de: 'Schublade', es: 'Cajón' },
  litter: { en: 'Litter', fr: 'Litière', de: 'Streu', es: 'Arena' },
  visits: { en: 'Visits today', fr: 'Visites du jour', de: 'Besuche heute', es: 'Visitas hoy' },
  state: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  lastVisit: {
    en: 'Last visit',
    fr: 'Dernière visite',
    de: 'Letzter Besuch',
    es: 'Última visita',
  },
  noVisit: {
    en: 'None seen yet',
    fr: 'Aucune vue encore',
    de: 'Noch keiner gesehen',
    es: 'Ninguna vista aún',
  },
  weight: { en: 'Last weight', fr: 'Dernier poids', de: 'Letztes Gewicht', es: 'Último peso' },
  clean: { en: 'Clean', fr: 'Nettoyer', de: 'Reinigen', es: 'Limpiar' },
  resetDrawer: {
    en: 'Drawer emptied',
    fr: 'Tiroir vidé',
    de: 'Schublade geleert',
    es: 'Cajón vaciado',
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The Litter-Robot the widget shows: the chosen one, else the first. */
export function chosenRecord(hub, settings) {
  const litter = [...hub.records.values()].filter((record) => isLitterRobot(record.snapshot));
  if (settings?.device) {
    return hub.recordOf(settings.device) ?? null;
  }
  return litter[0] ?? null;
}

const levelColor = (level, full) =>
  full || level >= 90
    ? WIDGET_COLORS.DANGER
    : level >= 70
      ? WIDGET_COLORS.WARNING
      : WIDGET_COLORS.SUCCESS;

function stateColor(snapshot) {
  if (errorKindOf(snapshot.status)) {
    return WIDGET_COLORS.DANGER;
  }
  if (
    snapshot.drawerFull ||
    [STATUS.DRAWER_FULL_1, STATUS.DRAWER_FULL_2].includes(snapshot.status)
  ) {
    return WIDGET_COLORS.WARNING;
  }
  return snapshot.status === STATUS.READY ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.INFO;
}

/** The content for one robot (pure: tested without a hub). */
export function buildContent({ snapshot, visits, language, weightUnit, now, accountError }) {
  const components = [];
  if (accountError) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: fit(t(TEXT.accountError, language), 80),
    });
  }
  if (typeof snapshot.drawerLevel === 'number') {
    components.push({
      type: 'value',
      value: snapshot.drawerLevel,
      unit: '%',
      label: t(TEXT.drawer, language),
      icon: 'trash-2',
      color: levelColor(snapshot.drawerLevel, snapshot.drawerFull),
    });
  }
  if (typeof snapshot.litterLevel === 'number') {
    components.push({
      type: 'value',
      value: snapshot.litterLevel,
      unit: '%',
      label: t(TEXT.litter, language),
      icon: 'layers',
      color: snapshot.litterLevel <= 20 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({
    type: 'value',
    value: visits.today,
    label: t(TEXT.visits, language),
    icon: 'log-in',
  });

  const items = [
    {
      label: fit(robotName(snapshot), 40),
      icon: 'activity',
      value: fit(statusText(snapshot.status, language), 40),
      color: stateColor(snapshot),
    },
    {
      label: t(TEXT.lastVisit, language),
      icon: 'clock',
      value: visits.last
        ? fit(
            visits.last >= startOfDay(now)
              ? formatTime(visits.last, language)
              : formatDateTime(visits.last, language),
            40,
          )
        : t(TEXT.noVisit, language),
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (snapshot.weightLb !== null && snapshot.weightLb !== undefined) {
    items.push({
      label: t(TEXT.weight, language),
      icon: 'bar-chart-2',
      value:
        weightUnit === 'lb'
          ? `${snapshot.weightLb.toFixed(1)} lb`
          : `${lbToKg(snapshot.weightLb)
              .toFixed(1)
              .replace('.', language === 'en' ? '.' : ',')} kg`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });

  components.push({
    type: 'button',
    label: t(TEXT.clean, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.CLEAN, confirm: true },
  });
  if (snapshot.family === FAMILIES.LR3) {
    components.push({
      type: 'button',
      label: t(TEXT.resetDrawer, language),
      icon: 'inbox',
      style: 'secondary',
      action: { key: ACTIONS.RESET_DRAWER, confirm: true },
    });
  }
  // A cleaning or a countdown moves fast: refresh sooner.
  const busy = [STATUS.CLEAN_CYCLE, STATUS.CAT_SENSOR_TIMING, STATUS.CAT_DETECTED].includes(
    snapshot.status,
  );
  return { ttl_seconds: busy ? 30 : 120, components };
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.notConfigured, language);
  }
  const record = chosenRecord(hub, settings);
  if (!record) {
    return message(settings?.device ? TEXT.unknown : TEXT.noRobot, language);
  }
  return buildContent({
    snapshot: record.snapshot,
    visits: hub.visits(record.snapshot.serial),
    language,
    weightUnit: hub.config.weightUnit,
    now: hub.now(),
    accountError: hub.error !== null,
  });
}

async function action(hub, { actionKey, settings }) {
  const record = chosenRecord(hub, settings);
  // No robot: the hub answers with the right message.
  const externalId = record
    ? deviceIds(hub.gladys, record.snapshot).device
    : (settings?.device ?? null);
  if (actionKey === ACTIONS.CLEAN) {
    const done = await hub.clean(externalId);
    return { message: render(DONE_TEXT.cleaning, robotName(done.snapshot)) };
  }
  if (actionKey === ACTIONS.RESET_DRAWER) {
    const done = await hub.resetDrawer(externalId);
    return { message: render(DONE_TEXT.drawerReset, robotName(done.snapshot)) };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
