# Test Standards — genesys-cloud-streaming-client

Repo-specific testing standards. This is a **TypeScript library** tested with
**Jest + ts-jest** under **jsdom**. There are two kinds of tests, and they do
different jobs. Get the distinction right before writing either.

Test realistic use cases. Skip contrived edge cases, and tests that only restate
the implementation.

---

## Unit tests — white box

- Live in `test/unit/**` and run with `npm run test:unit` (`jest.config.js`,
  `--runInBand`). `test/integration` is not matched.
- **Can see inside the code.** A unit test builds one class in isolation and
  mocks its collaborators (`jest.mock`, `jest.spyOn`, fake `stanza` instances).
- **Coverage is gated at 100%** for branches, functions, lines and statements.
  Unit tests are what meet the gate. Integration tests don't count toward it.
- The right tool for:
  - **Pure logic:** `utils`, `stats-formatter`, topic parsing and merging.
  - **Branchy internals:** backoff and SASL handling in `client.ts`, retry rules
    in `http-client.ts`.
  - **The media layer** an integration test can't drive: `webrtc.ts`,
    `stanza-media-session`, `genesys-cloud-media-session` (real peer connections,
    stats, timers).
- Shared helpers: `test/helpers/testing-utils.ts` (`wait`, `flushPromises`).
  `test/helpers/setup-browser-env.js` sets `window`, `fetch`, and `crypto`.

## Integration tests (IT) — the real client, real together

- Live in `test/integration/**/*.it.test.ts` and run with `npm run test:it`
  (`jest.it.config.js`, which writes its own junit file to
  `test-results/integration`). `npm run test:ci` runs them after lint and the unit tests; `npm test` does not. Name
  each file for a flow (`connect`, `notifications`).
- **Black box.** An IT does not look inside the library. It builds a real
  `Client`, drives it through a public method (`connect()`, `disconnect()`,
  `notifications.subscribe()`, `bulkSubscribe()`) or an outside event, and
  asserts on what leaves the client and on what the caller can observe.
- **Everything inside the library runs for real:** `Client`, `ConnectionManager`,
  `HttpClient` (real axios), the extensions, `Ping`, `ServerMonitor`, backoff.
- **Only the two outward boundaries are faked** (see
  [architecture.md](architecture.md)):

  | Fake | Replaces | Use it to |
  |------|----------|-----------|
  | `MockApiServer` (`test/integration/support/mock-api-server.ts`) | The platform HTTP API | A real `node:http` server on an ephemeral port. `stub(method, pathRegex, response)` answers a route (the response can be a function of the request and the hit count), `received(method?, pathRegex?)` returns the requests it got (path, query, headers, body). Unstubbed routes answer 404. |
  | `FakeStanza` + `xmpp` (`test/integration/support/fake-xmpp.ts`) | `stanza.createClient()` | The websocket/XMPP peer. Set `xmpp.connectBehavior` (`start-session`, `sasl-failure`, `never`), read `xmpp.instances` / `xmpp.last` for the websocket URL, jid, credentials, pings and subscribed nodes, and call `pushPubsub(topic, payload)` or `serverDrops()` to act as the server. |

- **The rule that falls out of this:** if you spy on or stub a method of the
  library's own classes, stop. That is a unit test. Change what the boundary
  returns instead (`api.stub(...)`, `xmpp.connectBehavior = ...`).

### Four signs an "IT" is really a unit test

1. It spies a method of the thing under test.
2. It stubs the very collaborator that does the thing it claims to check.
3. The assertion still passes when the production code it targets is deleted.
4. A unit test already covers the same branch.

### Writing one

```ts
import { Client } from '../../src/client';
import { buildClient, installHttpMockServer, seedConnect, uid } from './support/harness';
import { xmpp } from './support/fake-xmpp';

jest.mock('stanza', () => require('./support/fake-xmpp').stanzaModuleMock());

describe('Notifications', () => {
  const api = installHttpMockServer();          // server + axios adapter + per-test reset
  let client: Client;

  beforeEach(async () => {
    const seeded = seedConnect(api);            // stubs users/me and channel creation
    client = buildClient(api, seeded.authToken);
    await client.connect({ keepTryingOnFailure: false, maxConnectionAttempts: 1 });
  });

  afterEach(() => client.disconnect());

  it('delivers a pushed notification to the handler for that topic only', async () => {
    const topic = uid('v2.users.push.test');
    api.stub('post', /\/subscriptions$/, { status: 200, body: { entities: [] } });
    const handler = jest.fn();
    await client.notifications.subscribe(topic, handler, true);

    xmpp.last!.pushPubsub(topic, { id: 'event' });

    expect(handler).toHaveBeenCalledWith({ id: 'event' });
  });
});
```

- Assert on outward signals: requests the server received (path, query,
  `authorization`, body), the websocket URL, jid and credentials on
  `xmpp.last.config`, events the client emitted, and the error `type` of a
  rejected promise.
- Fail on purpose by overriding a route (`api.stub('post', /channels$/, { status: 401 })`)
  or the XMPP behavior. On a failure path, also check what must not happen (no
  `connected` event, no websocket created, no retry of a 401).
- Assert the error **type** (`rejects.toHaveProperty('type', StreamingClientErrorTypes.invalid_token)`),
  not the message text.
- Use `uid(prefix)` for ids, topics and tokens. Tests share no state.
- Before you finish, break the code you are testing and check the test fails.
  An IT that still passes with the code broken tests nothing. Always restore the
  code afterwards.

### Gotchas

- **jsdom and axios.** The library needs `window`, but jsdom's XHR can't reach a
  real socket. `installHttpMockServer()` keeps jsdom and sets
  `axios.defaults.adapter = 'http'` for the suite. Don't switch the suite to
  `@jest-environment node`: that removes `window`.
- **`apiHost` takes a full URL.** `buildClient()` passes `api.baseUrl`
  (`http://127.0.0.1:<port>`), and `HttpClient` uses it as-is.
- **Always `disconnect()` in `afterEach`.** An open client keeps ping timers and
  the ICE refresh interval alive, which leaves Jest handles open.
- **Retries use real time.** A bulk subscribe retry waits 2s between attempts.
  Keep retry tests to one retry, or pass a short interval.
- **Don't wait with `sleep`.** Await the promise you care about, or
  `once(client, 'event')` from the harness. Use `flushPromises` for microtasks.
- `--runInBand` is required: the `stanza` mock and the axios adapter are
  module-level.
- The background `users/me` connectivity check runs on every connect attempt, so
  a test that counts `users/me` requests must account for it.

### Known limits

- **No real XMPP or WebSocket.** `FakeStanza` does not parse XML. Stanza
  definitions (`src/stanza-definitions`) are unit-tested.
- **WebRTC sessions are not covered by ITs.** `webrtc.ts` only bottoms out in a
  real `RTCPeerConnection` and media stack. `FakeStanza.jingle` is a stub that
  lets `connect()` finish. Session flows stay unit-tested. Building a fake peer
  connection is the next step if end-to-end coverage is needed.
- **Reconnect timing, ping timeouts and `ServerMonitor`** depend on long timers
  and are unit-tested with fake timers.
- **Messenger and alerting leader** have no ITs yet.

---

## Running

```bash
npm test                                                       # lint + unit
npm run test:ci                                                # lint + unit + integration
npm run test:unit                                              # unit tests
npm run test:it                                                # integration tests
npx jest test/unit/client.test.ts --collectCoverage=false      # one unit file
npx jest --config jest.it.config.js --runInBand test/integration/connect.it.test.ts   # one IT file
npm run test:watch                                             # unit watch mode
```

Junit output goes to `test-results/unit/test-results.xml` and
`test-results/integration/test-results.xml`. Reporting to Knex is done by the
Bitbucket wrapper pipeline, not this repo (see
[contributing-workflow.md](contributing-workflow.md)).
