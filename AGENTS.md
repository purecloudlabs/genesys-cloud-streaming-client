# AGENTS.md

Guidance for AI agents (and humans) working in this repo. This file is the hub.
It links out to the detailed docs under `ai/`.

## What this is

`genesys-cloud-streaming-client` — a **TypeScript library** for the Genesys Cloud
streaming APIs (websocket/XMPP). It creates a notification channel over HTTP,
opens an XMPP websocket on it with `stanza`, and exposes extensions for
notification topics, WebRTC (jingle) sessions, messenger, and alerting leader.
It runs in browsers and Node. `genesys-cloud-webrtc-sdk` is its main consumer.
Tests are Jest + ts-jest under jsdom.

## Versioning & branching

- **Hosted on GitHub** (`purecloudlabs/genesys-cloud-streaming-client`); use `gh`
  for PRs. Published to the **public npm registry**.
- **Gitflow.** `develop` is the integration branch; ticket branches are named for
  the Jira key (`STREAM-1234`), cut from and PR back into **`develop`**. Release
  branches are cut from `develop`, named for the version (`release/vX.Y.Z`), and
  PR into `master`. After merging a release into `master`, `master` is merged
  back into `develop`.
- **Semver** in `package.json`. Breaking API changes bump MAJOR, features MINOR,
  fixes PATCH.
- **Update `CHANGELOG.md`** on every PR (Keep a Changelog format, under
  `Unreleased`, linking the Jira key).
- **Commit format:** `[STREAM-1234] One or two sentence description.`
- Jira project: **STREAM**.

## Build / test / lint

```bash
npm install

npm test             # lint + unit tests
npm run test:ci      # lint + unit tests + integration tests (what CI runs)
npm run test:unit    # unit tests (test/unit, 100% coverage gate)
npm run test:it      # integration tests only (test/integration/**/*.it.test.ts)
npm run build        # ts-node scripts/build
npm run lint         # ESLint over src

# Run a subset
npx jest test/unit/<file> --collectCoverage=false
npx jest --config jest.it.config.js --runInBand test/integration/<file>
```

## Conventions

- **Architecture / mental model:** [ai/architecture.md](ai/architecture.md) —
  module map, connect sequence, reconnect behavior, extensions, outward
  boundaries. Read this before changing `client.ts` or connection code.
- **Coding conventions:** [ai/conventions.md](ai/conventions.md) — errors, HTTP,
  logging, events, extensions.
- **Testing standards:** [ai/test-standards.md](ai/test-standards.md) — unit vs
  integration tests and the `test/integration` harness. Read before adding or
  changing tests.
- **Workflow:** [ai/contributing-workflow.md](ai/contributing-workflow.md) —
  branches, PRs, releases, CI.
- **Public API reference:** [doc/documentation.md](doc/documentation.md).
- **PR base branch is `develop`**, not `master`.

## Gotchas

- **Unit coverage is gated at 100%** (`jest.config.js`). New code needs unit
  tests that cover every branch.
- **A new `stanza` client is created for every connection attempt** and is never
  reused (see the comment at the top of `src/connection-manager.ts`). Don't hold
  on to an old instance.
- **Extensions are looked up by name** (`notifications`, `webrtcSessions`,
  `messenger`, `alertingLeader`). Each is exposed as `client.<name>` (public
  API) and `client._<name>` (the extension itself).
- **`stanza` events are proxied.** `Client` swallows stanza's `connected`, treats
  `session:started` as "connected", and renames `disconnected` to
  `stanzaDisconnected`.
- **`apiHost` may include a scheme.** If it starts with `http`, `HttpClient` uses
  it as-is; otherwise it builds `https://api.<host>`. The integration tests rely
  on this to point the client at a local server.
- **The `src/client.ts` version string is `__STREAMING_CLIENT_VERSION__`.** The
  build replaces it. Don't hardcode a version.
- **Jest runs with `--runInBand`** because tests share module-level mocks.
- **`test/*.js` and `test/scripts/*`** are manual scripts run against a real
  environment. They are not part of any test suite.
