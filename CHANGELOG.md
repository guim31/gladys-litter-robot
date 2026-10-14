# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Whisker account sign-in (e-mail and password, Amazon Cognito SRP like the
  Whisker app), with the session tokens kept under `/data`.
- One device per robot of the account: Litter-Robot 3 Connect, Litter-Robot 4
  and Feeder-Robot, with their state in words, waste drawer, litter and food
  levels, cat weight (Litter-Robot 4), cycle counters, last visit and last
  meal, and the commands: start a cleaning, reset the drawer gauge
  (Litter-Robot 3), cleaning delay, night light, panel lock, dispense a
  portion.
- Live updates of the Litter-Robot 4 and the Feeder-Robot (the GraphQL
  subscriptions of the Whisker app), and a reading of every robot at a
  configurable interval (5 minutes by default).
- Scene triggers "Cat visit" (with the last weight and the visits of the day),
  "Waste drawer full" and "Robot error"; scene actions "Start a Litter-Robot
  cleaning" and "Dispense a Feeder-Robot portion", with a daily limit against
  scenes that loop.
- The "Litter-Robot" dashboard widget: drawer and litter levels, visits of the
  day, last visit and weight, Clean and Drawer emptied buttons.
- Texts, feature names and documentation in English, French, German and
  Spanish.

[Unreleased]: https://github.com/guim31/gladys-litter-robot/commits/main
