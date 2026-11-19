# Contributing Workflow — genesys-cloud-streaming-client

How changes get made and shipped in this repo. These are repo-specific
facts; follow them exactly.

## Hosting & registry

- **GitHub** (`purecloudlabs/genesys-cloud-streaming-client`). Use `gh` for PRs.
- **npm:** published to the public registry as `genesys-cloud-streaming-client`.
  Install with `npm install`.
- **Node:** see `.nvmrc`. CI tests Node 16, 18, 20 and 22 on Linux, Windows and
  macOS.

## Branching & PRs

- **Base branch is `develop`**, not `master`. Open PRs against `develop`, except
  release PRs, which go into `master`.
- Branch name = Jira key (`STREAM-1234`). Jira project: **STREAM**.
- Commit format: `[STREAM-1234] One or two sentence description.`
- Add an entry to `CHANGELOG.md` under `Unreleased`, linking the Jira ticket.

## Before you push

```bash
npm run test:ci   # lint + unit tests + integration tests
```

- Unit coverage is gated at 100%.
- Run `npm run test:it` when you touch connect, reconnect, HTTP, or
  notification code.
- For tests, follow [test-standards.md](test-standards.md).

## CI (GitHub Actions)

- `.github/workflows/build.yml` runs on every push: `lint`, `security-audit`
  (`npm audit --audit-level=critical --omit=dev`), and `test` (`npm run test:ci`,
  which includes the integration tests). A failed test run uploads its report.
- `.github/workflows/matrix.yml` runs build and test across the Node and OS matrix
  on pushes to `master` and `develop`.
- **Knex reporting:** this repo does not build on Jenkins, so there is no
  `testResultToKnex` block here. Reporting of test results to Knex, with unit and
  integration reported separately, happens in the Bitbucket wrapper pipeline.
  Unit junit goes to `test-results/unit/test-results.xml` and integration junit to
  `test-results/integration/test-results.xml`. Keep them in separate files so the
  wrapper can report each one with its own type.

## Releases

1. Cut a release branch (`release/vX.Y.Z`) from `develop`.
2. On it, move `Unreleased` changelog entries under the new version and bump
   `package.json` (commit `Prep vX.Y.Z`).
3. PR it into `master`. After it merges and publishes, merge `master` back into
   `develop`.

## Docs to read first

- [AGENTS.md](../AGENTS.md) — the hub (commands, gotchas).
- [architecture.md](architecture.md) — module map, connect sequence, reconnect.
- [conventions.md](conventions.md) — errors, HTTP, logging, extensions.
- [test-standards.md](test-standards.md) — unit vs IT, the `test/integration` harness.
- [../doc/documentation.md](../doc/documentation.md) — public API reference.
