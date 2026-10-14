# Whisker fixtures

Real answers of the Whisker cloud, as published in the tests of the two
reference projects. Their identifiers are already the dummy ones of those
projects (serials `LR3C012345`, `LR4C000001`, `RF1C000001`…); nothing here
comes from a real account.

| File                         | Source                                                                                                                              | License    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `lr3-robots.json`            | [pylitterbot](https://github.com/natekspencer/pylitterbot) `tests/common.py`: `ROBOT_DATA`, `ROBOT_DELETED_DATA`, `ROBOT_FULL_DATA` | MIT        |
| `lr3-robot-ha.json`          | [Home Assistant](https://github.com/home-assistant/core) `tests/components/litterrobot/fixtures/litter_robot_3_data.json`           | Apache-2.0 |
| `lr4-robot.json`             | Home Assistant `tests/components/litterrobot/fixtures/litter_robot_4_data.json`                                                     | Apache-2.0 |
| `lr4-robot-pylitterbot.json` | pylitterbot `tests/common.py`: `LITTER_ROBOT_4_DATA`                                                                                | MIT        |
| `feeder-robot.json`          | pylitterbot `tests/common.py`: `FEEDER_ROBOT_DATA`                                                                                  | MIT        |

`../cognito/srp-vectors.json`: one Cognito SRP exchange computed by
[pycognito](https://github.com/NabuCasa/pycognito) (Apache-2.0) `aws_srp.py`
with a fixed secret, a fixed server value and a fixed clock, to check
`src/whisker/srp.js` against the implementation pylitterbot relies on.
