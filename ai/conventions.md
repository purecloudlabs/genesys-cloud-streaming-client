# Coding Conventions — genesys-cloud-streaming-client

Patterns an agent should follow to match existing code. They are observed from
the source. Mirror them rather than introducing new styles.

## Style

- ESLint (semistandard config) over `src`. Run `npm run lint`, or
  `npm run lint:fix` for simple fixes.
- Space before function parentheses (`connect (opts)`), semicolons, single quotes.
- `.editorconfig` sets indentation. Don't reformat unrelated code.

## Errors

- Surface failures to callers as `StreamingClientError(type, messageOrError, details)`
  from `src/utils.ts`. `type` is a `StreamingClientErrorTypes` value
  (`generic`, `invalid_token`, `userCancelled`). Put the original error in `details`.
- `StreamingSubscriptionError` is for a topic the server rejected.
- Timeouts use `timeoutPromise(fn, ms, message, details)`, which rejects with a
  `TimeoutError`.
- Decide retry-ability in one place: `backoffConnectRetryHandler` in `client.ts`
  for connects, `requestApiWithRetry` for HTTP.

## HTTP

- Never call `axios` directly. Use `client.http.requestApi(...)` or
  `requestApiWithRetry(...)` with `RequestApiOptions` (`method`, `host`, `authToken`,
  `logger`, ...). They add the bearer token and correlation-id logging.
- Pass `host: this.config.apiHost` and a path without a leading slash
  (`notifications/channels`). `HttpClient` builds the URL.
- Custom headers set on the client apply to every request.

## Logging

- Log through `client.logger` (from `genesys-cloud-client-logger`), never `console`.
- Put structured data in the second argument, not in the message string.
  Include `stanzaInstanceId` and `channelId` when a connection is involved.
- Use `{ skipServer: true }` for debug noise that shouldn't be uploaded.
- Never log tokens. `HttpClient` redacts the `Authorization` header on errors.

## Events

- `Client` and the extensions are `EventEmitter`s. Public events include
  `connected`, `disconnected`, `notify`, `sessionManagerChange`.
- The websocket library's events are proxied in `proxyStanzaEvents`. If you add a
  stanza event that callers need, forward it there.
- Remove listeners you add (`off`) when the connection they belong to is gone, so
  handlers don't stack across reconnects.

## Extensions

- Implement `StreamingClientExtension`. Put per-connection setup in
  `configureNewStanzaInstance`, and swap-in logic in `handleStanzaInstanceChange`.
- Expose only the public API through `expose`. Keep the rest on the extension.
- Send with `this.emit('send', data, isMessage)` so the client's token bucket
  rate-limits it. Don't call the stanza instance directly to send.

## Types

- Public types live in `src/types/interfaces.ts` and are re-exported from
  `src/index.ts`. Adding an export there is a public API change.
- Use `NamedAgent` (not the raw `stanza` `Agent`) for connection instances.

## Changelog and docs

- Add a `CHANGELOG.md` entry under `Unreleased` for every PR.
- Public API changes also update `doc/documentation.md` (or the matching
  `doc/*.md`).
