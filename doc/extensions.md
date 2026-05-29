# Extensions

The streaming client is built around a core `Client` object with multiple extensions,
each providing their own functionality. Extensions are event-emitter-based and are
registered on the client at construction time.

## Bundled Extensions

The following extensions ship with the client and are available immediately:

| Extension | Property | Description |
|-----------|----------|-------------|
| Ping | `client._ping` | Client-side keepalive pings (used when server-side pings are unavailable) |
| ServerMonitor | — | Server-side keepalive monitoring |
| ConnectionTransfer | — | Automatic reconnection when the WebSocket host requests a transfer |
| Messenger | `client.messenger` | Media message broadcasting between clients on the same user |
| Notifications | `client.notifications` | PubSub topic subscription and notification handling ([docs](notifications.md)) |
| WebRTC Sessions | `client.webrtcSessions` | WebRTC session management for softphone and other media ([docs](webrtc-sessions.md)) |

## Adding a Custom Extension

Extensions are added via the static `Client.extend()` method **before** creating an
instance:

```ts
import StreamingClient from 'genesys-cloud-streaming-client';

StreamingClient.extend('myExtension', MyExtension);

const client = new StreamingClient({ /* options */ });
// client.myExtension is now available
```

A custom extension must implement the `StreamingClientExtension` interface:

```ts
interface StreamingClientExtension {
  handleIq?: (iq: any) => void;
  handleMessage?: (msg: any) => void;
  handleStanzaInstanceChange: (stanzaInstance: NamedAgent) => void;
  configureNewStanzaInstance?: (stanzaInstance: NamedAgent) => Promise<void>;
  expose: any;
}
```

- `handleStanzaInstanceChange` — called whenever the underlying XMPP connection changes
  (e.g., after a reconnect). Update any internal references to the stanza instance here.
- `handleIq` / `handleMessage` — optional handlers for incoming IQ stanzas and messages.
- `configureNewStanzaInstance` — optional async setup when a new connection is established.
- `expose` — the public API object that gets attached to the client instance (e.g.,
  `client.myExtension`).

### Rate Limiting

Each extension is assigned a default token bucket for rate limiting outbound stanzas
(20 stanzas per second, bursting to 45). You can override this by setting
`extension.tokenBucket` in your extension's constructor.
