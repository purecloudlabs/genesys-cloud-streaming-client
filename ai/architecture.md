# Architecture — genesys-cloud-streaming-client

A **TypeScript library** that keeps one authenticated streaming connection to
Genesys Cloud alive. The caller builds a `Client`, calls `connect()`, and then
uses extensions to subscribe to notification topics, run WebRTC sessions, and
send messages. This doc is the mental model an agent needs before changing code.

## Where it runs

Browsers (bundled by webpack or rollup) and Node. Under Node, `window` and
`crypto` are provided by the consumer. `src/polyfills.ts` fills small gaps.
Auth is a bearer `authToken`, or a `jwt` for background-assistant (screen
recording) connections. A client with neither is a guest.

## The two outward boundaries

Everything the client does outside its own process goes through one of these:

| Boundary | Used for | Code |
|----------|----------|------|
| **Platform HTTP API** (`https://api.<apiHost>/api/v2/...`) | `users/me`, create notification channel, bulk subscribe, ICE/diagnostic calls, alerting leader | `src/http-client.ts` (axios) |
| **Websocket / XMPP** (`wss://streaming.<host>/stream/channels/<channelId>`) | Session auth, pubsub notifications, jingle (WebRTC) signaling, pings | `stanza` via `src/connection-manager.ts` |

The integration tests fake exactly these two. See [test-standards.md](test-standards.md).

## Module map

| Path | Responsibility |
|------|----------------|
| `src/index.ts` | Exports `Client` (default), `HttpClient`, error classes, types. |
| `src/client.ts` | `Client`: connect and reconnect, backoff, extension wiring, stanza event proxying. The center of the library. |
| `src/connection-manager.ts` | `ConnectionManager`: builds a brand-new `stanza` client per attempt, resolves on `session:started`, rejects on SASL failure, disconnect, or 15s timeout. |
| `src/http-client.ts` | `HttpClient`: `requestApi` (one request) and `requestApiWithRetry` (retry rules below). |
| `src/notifications.ts` | `Notifications` extension: `subscribe`, `unsubscribe`, `bulkSubscribe`, topic handlers, resubscribe after a hard reconnect. |
| `src/webrtc.ts` | `WebrtcExtension`: jingle sessions, ICE server refresh, stats, session events. The largest file. |
| `src/messenger.ts` | `MessengerExtension`: broadcast messages over the data channel. |
| `src/alerting-leader.ts` | `AlertingLeaderExtension`: claims "alerting leader" for a user across tabs. |
| `src/ping.ts` | `Ping`: client-side XMPP pings. Disconnects after missed pings. |
| `src/server-monitor.ts` | `ServerMonitor`: with server-side pings, disconnects if no stanza arrives within 35s. |
| `src/connection-transfer.ts` | Hands a connection to a new client instance. |
| `src/stats-formatter.ts` | Formats WebRTC stats for upload. |
| `src/utils.ts` | `StreamingClientError`, `retryPromise`, `timeoutPromise`, `delay`, `parseJwt`. |
| `src/stanza-definitions/` | Custom XMPP stanza schemas (webrtc signaling, XEP-0051). |
| `src/types/` | Interfaces, enums (`StreamingClientErrorTypes`), media session classes, `NamedAgent`. |
| `scripts/build.ts` | Builds the `npm`, `es`, and browser bundles and injects the version. |
| `test/` | `unit/`, `integration/`, `helpers/`, and manual `scripts/`. |

## Extensions

`Client` has a static `extensions` map: `notifications`, `webrtcSessions`,
`messenger`, `alertingLeader`. For each one, the constructor creates the
extension, gives it a token bucket (rate limit), listens for its `send` event,
and sets `client.<name>` to the extension's `expose` object and
`client._<name>` to the extension. `Client.extend()` adds more.

An extension implements `StreamingClientExtension`
(`src/types/streaming-client-extension.ts`):

- `configureNewStanzaInstance(stanza)` runs on every new connection, before it
  is marked connected. `WebrtcExtension` sets up jingle and ICE servers here.
- `handleStanzaInstanceChange(stanza)` runs after that. `Notifications` resubscribes
  here when the channel changed.
- `handleIq` / `handleMessage` receive stanzas.

## Connect sequence (`Client.connect()`)

1. `connect()` wraps `makeConnectionAttempt()` in `exponential-backoff`
   (`maxConnectionAttempts`, `keepTryingOnFailure`, `connectOnlyIfNotConnected`).
2. An attempt first fires a background `users/me` check (advisory, never blocks).
3. **`prepareForConnect()`**. If a hard reconnect is needed (the first time, or
   after a bad channel): get `userId` and `jid` from `users/me` (skipped if the
   caller passed both), then `POST notifications/channels?connectionType=streaming`
   for a `channelId`. A JWT connection skips both.
4. **`ConnectionManager.getNewStanzaConnection()`** creates a `stanza` client,
   points it at the websocket for that channel, and waits for `session:started`.
5. Event handlers and the stanza event proxy are attached, and extensions are
   configured (see above).
6. **Connection monitoring starts.** Server-side pings (`enable.server.side.pings`
   subscription plus `ServerMonitor`) when enabled and supported, otherwise `Ping`.
7. `connected = true` and the client emits `connected`.

## Errors from `connect()`

`connect()` rejects with a `StreamingClientError` whose `type` is:

| Type | When |
|------|------|
| `invalid_token` | HTTP 401/403 from the API, or a non-retryable SASL failure. Not retried. |
| `user_cancelled` | `disconnect()` was called mid-attempt. |
| `generic` | Anything else (network errors, timeouts, unknown). `details` holds the original error. |

Retryable failures (5xx, network errors, retryable SASL conditions, timeouts)
back off and try again. A `retry-after` header is honored.

## Reconnect and disconnect

- Each `stanza` event is proxied: `connected` is swallowed, `session:started`
  stands for "connected", and `disconnected` becomes `stanzaDisconnected`.
- On `stanzaDisconnected` the client marks itself disconnected, stops monitors,
  and, if `autoReconnect` is on, calls `connect()` again. A soft reconnect reuses
  the channel (up to 10 times, `MAX_CHANNEL_REUSES`). After that, or on
  `notify:no_longer_subscribed` / `notify:duplicate_id`, it forces a hard
  reconnect with a new channel.
- `disconnect()` cancels in-flight attempts and retries, stops pings, and closes
  the websocket.

## HTTP retry rules (`HttpClient.requestApiWithRetry`)

Retries on status 408, 413, 429, 500, 502, 503, 504, and network codes
`ECONNABORTED`, `ECONNRESET`, `ERR_NETWORK`, `ETIMEDOUT`. A `retry-after` header
overrides the interval. Default `maxAttempts` is 10. The bulk subscribe uses 4.
Other statuses (including 401 and 403) reject immediately.

## Notifications

`subscribe(topic, handler)` records the handler and triggers a debounced (100ms)
bulk resubscribe: `PUT` (replace) or `POST` to
`notifications/channels/<channelId>/subscriptions`. Pushed notifications arrive
as `pubsub:event` and go to handlers registered for that topic. After a hard
reconnect the new channel is resubscribed automatically.

## Alerting leader

`AlertingLeaderExtension` (`src/alerting-leader.ts`) lets several clients for one
user (browser tabs, apps) agree on which one alerts for an incoming interaction.
It only runs when the caller passes `alertableInteractionTypes` (`voice`). It is
internal to Genesys apps.

On each new connection (`handleStanzaInstanceChange`), using the stanza
connection id (`transport.stream.id`) as the connection id:

1. `GET users/alertingleader` early, without waiting. A 400 means the org has no
   alerting leader, so the client acts as the leader.
2. Subscribe to `v2.users.<userId>.alertingleader` (internal subscription).
3. `PATCH apps/users/<userId>/connections/<connectionId>` with `{ alertable: true }`.
   It retries for up to 8s because the backend may not know the connection yet
   (STREAM-1204). It honors `retry-after` on a 429 if it fits the window.
4. `GET users/alertingleader` again (with retry). This cancels the early request.

Status is `{ voice: { alerting, configured, clientType? } }`. `alerting` is true
when the leader's `connectionId` equals this connection's. The extension emits
`alertingLeaderChanged` after the GET and after every pushed leader change.
If setup throws, it fails open: `{ alerting: true, configured: false }`, so users
don't miss calls.

`claimAlertingLeader()` is debounced (300ms) and does `PUT users/alertingleader`
with `{ connectionId }`. It rejects with a `generic` `StreamingClientError` when
the client has no alertable types or the request fails.

## Where to start for common changes

| Change | Start in |
|--------|----------|
| Connect, reconnect, backoff | `client.ts`, `connection-manager.ts` |
| An HTTP call or retry rule | `http-client.ts`, caller in `client.ts` or an extension |
| Topic subscriptions | `notifications.ts` |
| WebRTC session or ICE behavior | `webrtc.ts`, `types/*-media-session.ts` |
| Alerting leader | `alerting-leader.ts` |
| A new stanza | `stanza-definitions/` |
| A new extension | `types/streaming-client-extension.ts`, then the `extensions` map in `client.ts` |
