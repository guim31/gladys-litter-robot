# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the e-mail and password of the Whisker account live in the
  Gladys configuration of the integration. The password is sent only to the
  Amazon Cognito sign-in service of Whisker, through the SRP protocol (the
  password itself never leaves the container).
- **Stored in `/data`** (`litter-robot.json`, mode 600): the Cognito session
  tokens (id, access, refresh), a SHA-256 hash of the e-mail to tie them to
  the account, the cat visits of the day and the times of the portions
  dispensed by Gladys. Never the password.
- **Network**: outgoing HTTPS and WebSocket connections to the Whisker cloud
  only (`cognito-idp.us-east-1.amazonaws.com`, `*.iothings.site`, two Amazon
  API Gateway hosts of Whisker), and to the Gladys host API. No port is
  opened, nothing is reachable from the local network.
- **Logs**: never the password, the e-mail nor a token, at any level
  (`test/logs.test.js`).

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Whisker cloud and the robots.
