// -----------------------------------------------------------------------------
// Every text the integration sends to Gladys outside the manifest: feature
// names, robot states, connection status, the "Test the connection" report,
// the errors of the commands and the scene actions. Four languages, the four
// of the Gladys interface; German says "du", Spanish "usted". The language is
// the one chosen in the configuration (Gladys does not tell a device
// integration the user's language). test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './whisker/http.js';
import { ERROR_KIND, FEEDER_STATUS, STATUS } from './whisker/model.js';

export const LANGUAGE_FALLBACK = 'en';
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

/** A table of { en, fr, de, es } built from one function per language. */
export const render = (table, ...args) =>
  Object.fromEntries(Object.entries(table).map(([language, fn]) => [language, fn(...args)]));

// --- Robot states ------------------------------------------------------------

export const STATUS_TEXT = {
  [STATUS.BONNET_REMOVED]: {
    en: 'Bonnet removed',
    fr: 'Capot retiré',
    de: 'Haube abgenommen',
    es: 'Cubierta retirada',
  },
  [STATUS.CLEAN_CYCLE_COMPLETE]: {
    en: 'Cleaning complete',
    fr: 'Nettoyage terminé',
    de: 'Reinigung abgeschlossen',
    es: 'Limpieza terminada',
  },
  [STATUS.CLEAN_CYCLE]: {
    en: 'Cleaning in progress',
    fr: 'Nettoyage en cours',
    de: 'Reinigung läuft',
    es: 'Limpieza en curso',
  },
  [STATUS.CAT_DETECTED]: {
    en: 'Cat detected',
    fr: 'Chat détecté',
    de: 'Katze erkannt',
    es: 'Gato detectado',
  },
  [STATUS.CAT_SENSOR_FAULT]: {
    en: 'Cat sensor fault',
    fr: 'Défaut du capteur de chat',
    de: 'Fehler des Katzensensors',
    es: 'Fallo del sensor de gato',
  },
  [STATUS.CAT_SENSOR_INTERRUPTED]: {
    en: 'Cat sensor interrupted',
    fr: 'Capteur de chat interrompu',
    de: 'Katzensensor unterbrochen',
    es: 'Sensor de gato interrumpido',
  },
  [STATUS.CAT_SENSOR_TIMING]: {
    en: 'Waiting before cleaning',
    fr: 'Attente avant nettoyage',
    de: 'Warte vor der Reinigung',
    es: 'Esperando para limpiar',
  },
  [STATUS.DRAWER_FULL_1]: {
    en: 'Drawer almost full (2 cycles left)',
    fr: 'Tiroir presque plein (2 cycles restants)',
    de: 'Schublade fast voll (noch 2 Zyklen)',
    es: 'Cajón casi lleno (quedan 2 ciclos)',
  },
  [STATUS.DRAWER_FULL_2]: {
    en: 'Drawer almost full (1 cycle left)',
    fr: 'Tiroir presque plein (1 cycle restant)',
    de: 'Schublade fast voll (noch 1 Zyklus)',
    es: 'Cajón casi lleno (queda 1 ciclo)',
  },
  [STATUS.DRAWER_FULL]: {
    en: 'Drawer full',
    fr: 'Tiroir plein',
    de: 'Schublade voll',
    es: 'Cajón lleno',
  },
  [STATUS.DUMP_HOME_POSITION_FAULT]: {
    en: 'Dump and home position fault',
    fr: 'Défaut positions vidage et repos',
    de: 'Fehler der Entleer- und Ausgangsposition',
    es: 'Fallo posiciones de vaciado y reposo',
  },
  [STATUS.DUMP_POSITION_FAULT]: {
    en: 'Dump position fault',
    fr: 'Défaut de la position de vidage',
    de: 'Fehler der Entleerposition',
    es: 'Fallo de la posición de vaciado',
  },
  [STATUS.EMPTY_CYCLE]: {
    en: 'Emptying cycle',
    fr: 'Cycle de vidage',
    de: 'Entleerungszyklus',
    es: 'Ciclo de vaciado',
  },
  [STATUS.HOME_POSITION_FAULT]: {
    en: 'Home position fault',
    fr: 'Défaut de la position de repos',
    de: 'Fehler der Ausgangsposition',
    es: 'Fallo de la posición de reposo',
  },
  [STATUS.OFF]: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
  [STATUS.OFFLINE]: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  [STATUS.OVER_TORQUE_FAULT]: {
    en: 'Motor overload',
    fr: 'Surcharge du moteur',
    de: 'Motorüberlastung',
    es: 'Sobrecarga del motor',
  },
  [STATUS.PAUSED]: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  [STATUS.PINCH_DETECT]: {
    en: 'Pinch detected',
    fr: 'Pincement détecté',
    de: 'Einklemmen erkannt',
    es: 'Pinzamiento detectado',
  },
  [STATUS.POWER_DOWN]: {
    en: 'Powering down',
    fr: 'Extinction en cours',
    de: 'Wird ausgeschaltet',
    es: 'Apagándose',
  },
  [STATUS.POWER_UP]: {
    en: 'Starting up',
    fr: 'Démarrage en cours',
    de: 'Wird gestartet',
    es: 'Arrancando',
  },
  [STATUS.READY]: { en: 'Ready', fr: 'Prêt', de: 'Bereit', es: 'Listo' },
  [STATUS.STARTUP_CAT_SENSOR_FAULT]: {
    en: 'Cat sensor fault at startup',
    fr: 'Défaut du capteur de chat au démarrage',
    de: 'Fehler des Katzensensors beim Start',
    es: 'Fallo del sensor de gato al arrancar',
  },
  [STATUS.STARTUP_DRAWER_FULL]: {
    en: 'Drawer full at startup',
    fr: 'Tiroir plein au démarrage',
    de: 'Schublade beim Start voll',
    es: 'Cajón lleno al arrancar',
  },
  [STATUS.STARTUP_PINCH_DETECT]: {
    en: 'Pinch detected at startup',
    fr: 'Pincement détecté au démarrage',
    de: 'Einklemmen beim Start erkannt',
    es: 'Pinzamiento detectado al arrancar',
  },
  [STATUS.UNKNOWN]: {
    en: 'Unknown state',
    fr: 'État inconnu',
    de: 'Unbekannter Zustand',
    es: 'Estado desconocido',
  },
  [FEEDER_STATUS.READY]: { en: 'Ready', fr: 'Prêt', de: 'Bereit', es: 'Listo' },
  [FEEDER_STATUS.JAMMED]: {
    en: 'Motor jammed',
    fr: 'Moteur bloqué',
    de: 'Motor blockiert',
    es: 'Motor atascado',
  },
  [FEEDER_STATUS.CHUTE_FULL]: {
    en: 'Chute full',
    fr: 'Goulotte pleine',
    de: 'Ausgabeschacht voll',
    es: 'Conducto lleno',
  },
  [FEEDER_STATUS.ON_BATTERY]: {
    en: 'On battery',
    fr: 'Sur batterie',
    de: 'Im Akkubetrieb',
    es: 'Con batería',
  },
};

/** The state of a robot, in words. */
export const statusText = (status, language) =>
  pick(STATUS_TEXT[status] ?? STATUS_TEXT[STATUS.UNKNOWN], language);

// What the "Error" trigger says about each kind of problem.
export const ERROR_KIND_TEXT = {
  [ERROR_KIND.MOTOR]: {
    en: 'Globe motor fault',
    fr: 'Défaut du moteur du globe',
    de: 'Fehler des Trommelmotors',
    es: 'Fallo del motor del globo',
  },
  [ERROR_KIND.PINCH]: {
    en: 'Pinch detected',
    fr: 'Pincement détecté',
    de: 'Einklemmen erkannt',
    es: 'Pinzamiento detectado',
  },
  [ERROR_KIND.CAT_SENSOR]: {
    en: 'Cat sensor fault',
    fr: 'Défaut du capteur de chat',
    de: 'Fehler des Katzensensors',
    es: 'Fallo del sensor de gato',
  },
  [ERROR_KIND.BONNET]: {
    en: 'Bonnet removed',
    fr: 'Capot retiré',
    de: 'Haube abgenommen',
    es: 'Cubierta retirada',
  },
  [ERROR_KIND.OFFLINE]: {
    en: 'Robot offline',
    fr: 'Robot hors ligne',
    de: 'Roboter offline',
    es: 'Robot sin conexión',
  },
  [ERROR_KIND.FEEDER_JAM]: {
    en: 'Feeder motor jammed',
    fr: 'Moteur du distributeur bloqué',
    de: 'Motor des Futterautomaten blockiert',
    es: 'Motor del comedero atascado',
  },
};

// --- Feature names ---------------------------------------------------------------
// Frozen in Gladys when the user adds the device: the language of the
// configuration at that moment.

export const FEATURE_KEYS = Object.freeze({
  STATUS: 'status',
  WASTE_DRAWER: 'waste_drawer',
  DRAWER_CYCLES: 'drawer_cycles',
  TOTAL_CYCLES: 'total_cycles',
  LITTER_LEVEL: 'litter_level',
  CAT_WEIGHT: 'cat_weight',
  CLEAN: 'clean',
  RESET_DRAWER: 'reset_drawer',
  WAIT_TIME: 'wait_time',
  NIGHT_LIGHT: 'night_light',
  NIGHT_LIGHT_MODE: 'night_light_mode',
  PANEL_LOCK: 'panel_lock',
  SLEEP_MODE: 'sleep_mode',
  LAST_VISIT: 'last_visit',
  FOOD_LEVEL: 'food_level',
  PORTIONS_TODAY: 'portions_today',
  LAST_MEAL: 'last_meal',
  SNACK: 'snack',
  AUTO_NIGHT_LIGHT: 'auto_night_light',
});

const K = FEATURE_KEYS;

export const NAMES = {
  en: {
    [K.STATUS]: 'Status',
    [K.WASTE_DRAWER]: 'Waste drawer',
    [K.DRAWER_CYCLES]: 'Cycles since emptied',
    [K.TOTAL_CYCLES]: 'Cleaning cycles (total)',
    [K.LITTER_LEVEL]: 'Litter level',
    [K.CAT_WEIGHT]: 'Cat weight (g)',
    [K.CLEAN]: 'Start cleaning',
    [K.RESET_DRAWER]: 'Reset drawer gauge',
    [K.WAIT_TIME]: 'Cleaning delay',
    [K.NIGHT_LIGHT]: 'Night light',
    [K.NIGHT_LIGHT_MODE]: 'Night light mode',
    [K.PANEL_LOCK]: 'Panel lock',
    [K.SLEEP_MODE]: 'Sleep mode',
    [K.LAST_VISIT]: 'Last visit',
    [K.FOOD_LEVEL]: 'Food level',
    [K.PORTIONS_TODAY]: 'Portions today',
    [K.LAST_MEAL]: 'Last meal',
    [K.SNACK]: 'Dispense a portion',
    [K.AUTO_NIGHT_LIGHT]: 'Automatic night light',
  },
  fr: {
    [K.STATUS]: 'État',
    [K.WASTE_DRAWER]: 'Tiroir à déchets',
    [K.DRAWER_CYCLES]: 'Cycles depuis le vidage',
    [K.TOTAL_CYCLES]: 'Cycles de nettoyage (total)',
    [K.LITTER_LEVEL]: 'Niveau de litière',
    [K.CAT_WEIGHT]: 'Poids du chat (g)',
    [K.CLEAN]: 'Lancer un nettoyage',
    [K.RESET_DRAWER]: 'Remettre le tiroir à zéro',
    [K.WAIT_TIME]: 'Délai de nettoyage',
    [K.NIGHT_LIGHT]: 'Veilleuse',
    [K.NIGHT_LIGHT_MODE]: 'Mode de la veilleuse',
    [K.PANEL_LOCK]: 'Verrouillage du panneau',
    [K.SLEEP_MODE]: 'Mode nuit',
    [K.LAST_VISIT]: 'Dernière visite',
    [K.FOOD_LEVEL]: 'Niveau de croquettes',
    [K.PORTIONS_TODAY]: "Portions aujourd'hui",
    [K.LAST_MEAL]: 'Dernier repas',
    [K.SNACK]: 'Distribuer une portion',
    [K.AUTO_NIGHT_LIGHT]: 'Veilleuse automatique',
  },
  de: {
    [K.STATUS]: 'Zustand',
    [K.WASTE_DRAWER]: 'Abfallschublade',
    [K.DRAWER_CYCLES]: 'Zyklen seit dem Leeren',
    [K.TOTAL_CYCLES]: 'Reinigungszyklen (gesamt)',
    [K.LITTER_LEVEL]: 'Streuhöhe',
    [K.CAT_WEIGHT]: 'Gewicht der Katze (g)',
    [K.CLEAN]: 'Reinigung starten',
    [K.RESET_DRAWER]: 'Schubladenanzeige zurücksetzen',
    [K.WAIT_TIME]: 'Reinigungsverzögerung',
    [K.NIGHT_LIGHT]: 'Nachtlicht',
    [K.NIGHT_LIGHT_MODE]: 'Nachtlichtmodus',
    [K.PANEL_LOCK]: 'Tastensperre',
    [K.SLEEP_MODE]: 'Schlafmodus',
    [K.LAST_VISIT]: 'Letzter Besuch',
    [K.FOOD_LEVEL]: 'Futterstand',
    [K.PORTIONS_TODAY]: 'Portionen heute',
    [K.LAST_MEAL]: 'Letzte Mahlzeit',
    [K.SNACK]: 'Eine Portion ausgeben',
    [K.AUTO_NIGHT_LIGHT]: 'Automatisches Nachtlicht',
  },
  es: {
    [K.STATUS]: 'Estado',
    [K.WASTE_DRAWER]: 'Cajón de residuos',
    [K.DRAWER_CYCLES]: 'Ciclos desde el vaciado',
    [K.TOTAL_CYCLES]: 'Ciclos de limpieza (total)',
    [K.LITTER_LEVEL]: 'Nivel de arena',
    [K.CAT_WEIGHT]: 'Peso del gato (g)',
    [K.CLEAN]: 'Iniciar limpieza',
    [K.RESET_DRAWER]: 'Restablecer el cajón',
    [K.WAIT_TIME]: 'Retraso de limpieza',
    [K.NIGHT_LIGHT]: 'Luz nocturna',
    [K.NIGHT_LIGHT_MODE]: 'Modo de la luz nocturna',
    [K.PANEL_LOCK]: 'Bloqueo del panel',
    [K.SLEEP_MODE]: 'Modo noche',
    [K.LAST_VISIT]: 'Última visita',
    [K.FOOD_LEVEL]: 'Nivel de pienso',
    [K.PORTIONS_TODAY]: 'Raciones de hoy',
    [K.LAST_MEAL]: 'Última comida',
    [K.SNACK]: 'Dispensar una ración',
    [K.AUTO_NIGHT_LIGHT]: 'Luz nocturna automática',
  },
};

// Labels of the options of the select features.
export const OPTION_TEXT = {
  OFF: { en: 'Off', fr: 'Éteinte', de: 'Aus', es: 'Apagada' },
  ON: { en: 'On', fr: 'Allumée', de: 'An', es: 'Encendida' },
  AUTO: { en: 'Automatic', fr: 'Automatique', de: 'Automatisch', es: 'Automática' },
};

// Words of the "Last meal" text feature.
export const MEAL_TEXT = {
  snack: { en: 'Extra portion', fr: 'Portion en plus', de: 'Extraportion', es: 'Ración extra' },
  meal: { en: 'Meal', fr: 'Repas', de: 'Mahlzeit', es: 'Comida' },
  portions: {
    en: (n) => `${n} portion${n === 1 ? '' : 's'}`,
    fr: (n) => `${n} portion${n === 1 ? '' : 's'}`,
    de: (n) => `${n} Portion${n === 1 ? '' : 'en'}`,
    es: (n) => (n === 1 ? '1 ración' : `${n} raciones`),
  },
};

const LOCALES = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/** "Tue, Oct 14, 3:32 PM", in the container time zone (Gladys' one, TZ). */
export function formatDateTime(time, language) {
  return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(time));
}

/** "3:32 PM" or "15:32". */
export function formatTime(time, language) {
  return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(time));
}

// --- Connection status and errors -------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  notConfigured: {
    en: 'Enter the e-mail and password of your Whisker account in the configuration.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte Whisker dans la configuration.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines Whisker-Kontos in der Konfiguration ein.',
    es: 'Introduzca el correo electrónico y la contraseña de su cuenta Whisker en la configuración.',
  },
  noRobot: {
    en: 'Connected, but this Whisker account has no Litter-Robot 3, Litter-Robot 4 or Feeder-Robot.',
    fr: 'Connecté, mais ce compte Whisker n’a ni Litter-Robot 3, ni Litter-Robot 4, ni Feeder-Robot.',
    de: 'Verbunden, aber dieses Whisker-Konto hat keinen Litter-Robot 3, Litter-Robot 4 oder Feeder-Robot.',
    es: 'Conectado, pero esta cuenta Whisker no tiene ningún Litter-Robot 3, Litter-Robot 4 ni Feeder-Robot.',
  },
};

// One explanation per error kind (src/whisker/http.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.AUTH]: {
    en: 'E-mail or password refused by Whisker: check them, then save.',
    fr: 'E-mail ou mot de passe refusé par Whisker : vérifiez-les, puis enregistrez.',
    de: 'E-Mail oder Passwort von Whisker abgelehnt: Prüfe sie und speichere dann.',
    es: 'Whisker ha rechazado el correo o la contraseña: compruébelos y guarde.',
  },
  [ERROR_KINDS.MFA]: {
    en: 'Your Whisker account asks for an extra step: sign in once in the Whisker app.',
    fr: 'Votre compte Whisker demande une étape de plus : connectez-vous une fois dans l’application Whisker.',
    de: 'Dein Whisker-Konto verlangt einen weiteren Schritt: Melde dich einmal in der Whisker-App an.',
    es: 'Su cuenta Whisker pide un paso más: inicie sesión una vez en la aplicación Whisker.',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'Whisker refuses too many attempts for now: next try in a few minutes.',
    fr: 'Whisker refuse les tentatives trop nombreuses : nouvel essai dans quelques minutes.',
    de: 'Whisker lehnt zu viele Versuche ab: neuer Versuch in einigen Minuten.',
    es: 'Whisker rechaza demasiados intentos: nuevo intento dentro de unos minutos.',
  },
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'The Whisker cloud does not answer: next try at the next refresh.',
    fr: 'Le cloud Whisker ne répond pas : nouvel essai au prochain rafraîchissement.',
    de: 'Die Whisker-Cloud antwortet nicht: neuer Versuch bei der nächsten Aktualisierung.',
    es: 'La nube de Whisker no responde: nuevo intento en la próxima actualización.',
  },
  [ERROR_KINDS.API]: {
    en: 'Unexpected answer from the Whisker cloud, see the integration logs.',
    fr: 'Réponse inattendue du cloud Whisker, voir les logs de l’intégration.',
    de: 'Unerwartete Antwort der Whisker-Cloud, sieh in den Protokollen der Integration nach.',
    es: 'Respuesta inesperada de la nube de Whisker, consulte los registros de la integración.',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    connected: (count) => `Connected to Whisker: ${count} robot(s).`,
    live: 'live updates',
    polled: 'read every few minutes',
  },
  fr: {
    connected: (count) => `Connecté à Whisker : ${count} robot(s).`,
    live: 'mises à jour en direct',
    polled: 'lu toutes les quelques minutes',
  },
  de: {
    connected: (count) => `Mit Whisker verbunden: ${count} Roboter.`,
    live: 'Live-Aktualisierung',
    polled: 'alle paar Minuten gelesen',
  },
  es: {
    connected: (count) => `Conectado a Whisker: ${count} robot(s).`,
    live: 'actualización en directo',
    polled: 'leído cada pocos minutos',
  },
};

// Errors and results of the commands (device buttons, widget, scene actions).
export const ACTION_TEXT = {
  notConnected: {
    en: 'Not connected to the Whisker account yet.',
    fr: 'Pas encore connecté au compte Whisker.',
    de: 'Noch nicht mit dem Whisker-Konto verbunden.',
    es: 'Todavía no hay conexión con la cuenta Whisker.',
  },
  unknownRobot: {
    en: 'This robot is no longer on the Whisker account.',
    fr: 'Ce robot n’est plus sur le compte Whisker.',
    de: 'Dieser Roboter ist nicht mehr im Whisker-Konto.',
    es: 'Este robot ya no está en la cuenta Whisker.',
  },
  notLitterRobot: {
    en: 'Choose a Litter-Robot.',
    fr: 'Choisissez un Litter-Robot.',
    de: 'Wähle einen Litter-Robot.',
    es: 'Elija un Litter-Robot.',
  },
  notFeeder: {
    en: 'Choose a Feeder-Robot.',
    fr: 'Choisissez un Feeder-Robot.',
    de: 'Wähle einen Feeder-Robot.',
    es: 'Elija un Feeder-Robot.',
  },
  offline: {
    en: 'The robot is offline.',
    fr: 'Le robot est hors ligne.',
    de: 'Der Roboter ist offline.',
    es: 'El robot no tiene conexión.',
  },
  catInside: {
    en: 'A cat is in the Litter-Robot: no cleaning now.',
    fr: 'Un chat est dans le Litter-Robot : pas de nettoyage maintenant.',
    de: 'Eine Katze ist im Litter-Robot: Jetzt keine Reinigung.',
    es: 'Hay un gato en el Litter-Robot: ahora no se limpia.',
  },
  notLr3: {
    en: 'Only a Litter-Robot 3 counts its drawer: the Litter-Robot 4 measures it.',
    fr: 'Seul le Litter-Robot 3 compte son tiroir : le Litter-Robot 4 le mesure.',
    de: 'Nur der Litter-Robot 3 zählt seine Schublade: Der Litter-Robot 4 misst sie.',
    es: 'Solo el Litter-Robot 3 cuenta su cajón: el Litter-Robot 4 lo mide.',
  },
  badValue: {
    en: 'Value not supported by this robot.',
    fr: 'Valeur non prise en charge par ce robot.',
    de: 'Wert wird von diesem Roboter nicht unterstützt.',
    es: 'Valor no admitido por este robot.',
  },
  snackLimit: {
    en: (limit) => `Limit reached: ${limit} portion(s) dispensed by Gladys over 24 hours.`,
    fr: (limit) => `Limite atteinte : ${limit} portion(s) distribuée(s) par Gladys sur 24 heures.`,
    de: (limit) => `Grenze erreicht: ${limit} Portion(en) von Gladys in 24 Stunden ausgegeben.`,
    es: (limit) => `Límite alcanzado: ${limit} ración(es) dispensada(s) por Gladys en 24 horas.`,
  },
  snackTooSoon: {
    en: 'A portion was dispensed less than a minute ago.',
    fr: 'Une portion a été distribuée il y a moins d’une minute.',
    de: 'Vor weniger als einer Minute wurde eine Portion ausgegeben.',
    es: 'Se dispensó una ración hace menos de un minuto.',
  },
};

// Toasts of the widget buttons (≤ 200 characters).
export const DONE_TEXT = {
  cleaning: {
    en: (name) => `Cleaning started on ${name}.`,
    fr: (name) => `Nettoyage lancé sur ${name}.`,
    de: (name) => `Reinigung auf ${name} gestartet.`,
    es: (name) => `Limpieza iniciada en ${name}.`,
  },
  drawerReset: {
    en: (name) => `Drawer gauge of ${name} set back to zero.`,
    fr: (name) => `Tiroir de ${name} remis à zéro.`,
    de: (name) => `Schubladenanzeige von ${name} zurückgesetzt.`,
    es: (name) => `Cajón de ${name} restablecido.`,
  },
};
