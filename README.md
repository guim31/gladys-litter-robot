# Litter-Robot for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that follows and controls the **Whisker** robots through the Whisker cloud,
with the account of the Whisker app: the **Litter-Robot 3 Connect**, the
**Litter-Robot 4** self-cleaning litter boxes and the **Feeder-Robot**
automatic feeder.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against the real answers of the Whisker cloud published in
> the tests of [pylitterbot](https://github.com/natekspencer/pylitterbot) and
> of Home Assistant, not against a real robot nor a real account. Please
> report what works and what does not in the
> [issues](https://github.com/guim31/gladys-litter-robot/issues).

**Not affiliated with Whisker.** Litter-Robot, Feeder-Robot and Whisker are
trademarks of Automated Pet Care Products, LLC (Whisker); this project is
neither endorsed nor supported by them.

## Features

- **Sign-in with the Whisker account** (e-mail and password, Amazon Cognito
  SRP like the Whisker app); the session tokens are kept under `/data`, the
  password never leaves the configuration.
- **One device per robot**:
  - Litter-Robot 3 Connect: state in words, waste drawer (%), cycles since
    emptied, start a cleaning, reset the drawer gauge, cleaning delay
    (3/7/15 min), night light, panel lock, sleep mode, last visit;
  - Litter-Robot 4: state, waste drawer and litter level (%), cat weight
    (grams, SmartWeight), total cycles, start a cleaning, cleaning delay
    (3 to 30 min), night light mode (off/on/automatic), panel lock, sleep
    mode, last visit;
  - Feeder-Robot: state, food level (%), portions of the day, last meal,
    dispense a portion, automatic night light, panel lock.
- **Live updates** of the Litter-Robot 4 and the Feeder-Robot (the GraphQL
  subscriptions of the Whisker app), and a reading of every robot by the
  container's own timer (5 minutes by default), so nothing depends on the
  polling of the Gladys core.
- **Scene triggers**: _Cat visit_ (with the last weight recorded and the
  visits of the day), _Waste drawer full_ (once per filling), _Robot error_
  (motor, pinch, cat sensor, bonnet, offline, jammed feeder).
- **Scene actions**: _Start a Litter-Robot cleaning_ (refused while a cat is
  detected) and _Dispense a Feeder-Robot portion_, with a daily limit and a
  minute between two portions, so that a scene that loops cannot empty the
  hopper.
- **Dashboard widget** "Litter-Robot": drawer and litter levels, visits of
  the day, state, last visit and weight, **Clean** and **Drawer emptied**
  buttons (with confirmation).
- A **Test the connection** button, a connection status that says what is
  wrong (password refused, second factor, outage), and a cloud/unreachable
  badge per device.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions),
  with access to the internet.
- A Litter-Robot 3 **Connect**, a Litter-Robot 4 and/or a Feeder-Robot set up
  in the Whisker app, and the e-mail and password of that account. An account
  asking for a second factor at sign-in is not supported.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-litter-robot`
   (or install **Litter-Robot** from the catalog once it is listed).
2. In **Configuration**, enter the e-mail and the password of your Whisker
   account, save, then click **Test the connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

| Robot                  | Reading                                         | Live updates                      | Commands                       |
| ---------------------- | ----------------------------------------------- | --------------------------------- | ------------------------------ |
| Litter-Robot 3 Connect | REST `v2.api.whisker.iothings.site`             | none (read at the interval)       | `dispatch-commands`, `PATCH`   |
| Litter-Robot 4         | GraphQL `lr4.iothings.site/graphql`             | AppSync subscription (graphql-ws) | `sendLitterRobot4Command`      |
| Feeder-Robot           | GraphQL (Hasura) `cognito.hasura.iothings.site` | Hasura subscription (graphql-ws)  | Whisker API Gateway `/command` |

- **Pace**: every robot family the account holds is read at the configured
  interval (2 to 15 minutes, 5 by default like Home Assistant), one more time
  a few seconds after a command, and every family is listed again once an
  hour to find a new robot. Whisker publishes no quota for this API (the one
  of its app); a refused password is never retried on a timer and a
  throttled account waits 15 minutes.
- **Cat visits** are seen when a litter box starts its countdown before
  cleaning; one that fell between two readings is caught by the cycle
  counter (a cleaning started by Gladys is not a visit).
- **States** are published only when they change (the SDK's deduplication),
  re-sent every 6 hours so that a stable value stays dated in Gladys, and
  all re-sent when a device is added.
- **Logs** stay quiet at the default level: the start, the connection, the
  outages and their end, one line per user command and per robot fault.
  `LOG_LEVEL=debug` shows the rest; never a password, an e-mail or a token.

The code: `src/whisker/` speaks to the cloud (`srp.js` and `cognito.js` for
the sign-in, `client.js` for the three APIs, `realtime.js` for the
subscriptions, `model.js` for the parsing); `src/hub.js` holds the robots, the
timer, the triggers and the commands; `src/devices.js`, `src/widgets.js` and
`src/scenes.js` are the Gladys side.

## What could not be checked

There was neither a robot, nor a Whisker account, nor a Gladys instance to
develop this integration. Checked: the Cognito SRP computation against
pycognito (the library pylitterbot uses), a sign-in attempt with a fake
account against the real Cognito endpoint (cleanly refused), the parsing of
the published API answers, and the whole Gladys side against the SDK's fake
Gladys. Not checked: a real sign-in, the commands on a real robot, the live
subscriptions, the timing of the states a real robot goes through during a
visit. `scripts/probe.mjs` exercises the real client read-only:

```bash
node scripts/probe.mjs                                  # fake account: expects a clean refusal
WHISKER_EMAIL=… WHISKER_PASSWORD=… node scripts/probe.mjs  # a real account: lists the robots
```

## Limitations

- Cloud only: without internet, nothing can be read or controlled.
- No Litter-Robot 5, no pet profiles: the weight is the robot's last reading,
  not a weight per cat.
- The visits are those seen since the integration was installed; the history
  of the Whisker app is not read.
- No live updates for the Litter-Robot 3 (read at the interval).
- No editing of the sleep schedule or of the meal plan (Whisker app).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Whisker cloud (`test/helpers/fakeWhisker.js`) with a real SRP
server side, fed with the published answers of `test/fixtures/whisker/`. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

Versions are published by the **Release** workflow (Actions → Release → Run
workflow): it bumps `package.json` and the manifest `version` and
`docker_image`, rolls `CHANGELOG.md`, tags and builds the multi-arch image.
A hand-pushed `vX.Y.Z` tag also builds, but then bump the three versions
together and commit them before tagging.

## Credits

- [pylitterbot](https://github.com/natekspencer/pylitterbot) by Nathan
  Spencer and contributors (MIT): the endpoints, queries, commands, status
  rules and the real answers used as fixtures.
- Home Assistant's
  [`litterrobot`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/litterrobot)
  integration (Apache-2.0): the choice of entities and two fixtures.
- [pycognito](https://github.com/NabuCasa/pycognito) (Apache-2.0): the SRP
  algorithm re-implemented in `src/whisker/srp.js`, and its test vectors.
- The architecture and the conformity tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled),
  [gladys-pihole](https://github.com/guim31/gladys-pihole) and
  [gladys-subsonic](https://github.com/guim31/gladys-subsonic).

## License

Apache-2.0
