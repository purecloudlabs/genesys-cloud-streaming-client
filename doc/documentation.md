# Genesys Cloud Streaming Client (SDK)

The Genesys Cloud Streaming Client serves as the Javascript Web SDK. It handles
establishing and maintaining a websocket connection to the Genesys Cloud streaming
services. This project uses our new XMPP based signaling for real time APIs.

Features:

- [x] PubSub (notifications)
- [x] WebRTC
    - [x] Softphone
    - [x] Screen Recording
    - [ ] Video/Screen Share※
    - [ ] ACD Screen Share※
- [x] Messenger (media message broadcasting)

※ Not yet roadmapped

## Installation

```bash
npm install genesys-cloud-streaming-client
```

## Browser Usage & Polyfills

The streaming client uses Node.js built-in modules (`events`, `global`) that are not
available natively in the browser. If you are using a bundler (Vite, Webpack, etc.),
you will need to add polyfills for these.

### `global`

The client references `global`, which does not exist in browsers. Alias it to `window`:

**Vite** (`vite.config.ts`):
```ts
export default defineConfig({
  define: {
    global: 'window',
  },
});
```

**Webpack** (`webpack.config.js`):
```js
const webpack = require('webpack');

module.exports = {
  plugins: [
    new webpack.ProvidePlugin({
      global: ['window'],
    }),
  ],
};
```

### `events` (EventEmitter)

The client extends Node's `EventEmitter`. You need to polyfill the `events` module
for browser environments.

**Vite** — install the `events` polyfill and configure the alias:
```bash
npm install events
```
```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      events: 'events',
    },
  },
  define: {
    global: 'window',
  },
});
```

**Webpack** — Webpack 4 included this polyfill automatically. For Webpack 5, install
and configure it:
```bash
npm install events
```
```js
// webpack.config.js
module.exports = {
  resolve: {
    fallback: {
      events: require.resolve('events/'),
    },
  },
};
```

### `process`

Some dependencies reference `process`. If you see errors about `process is not defined`,
add a polyfill:

**Vite**:
```bash
npm install process
```
```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    global: 'window',
    'process.env': {},
  },
});
```

**Webpack**:
```js
const webpack = require('webpack');

module.exports = {
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
    }),
  ],
};
```

## Usage

The SDK is based on a simple structure of a core client object with a few properties
and methods, and multiple extensions, each providing their own functionality.

Some extensions are bundled with the client, and others can be added at runtime.
See [Extensions](extensions.md) for details on implementing or adding an extension (or to
  request one be added to core).

After creating an instance of the client, your client can add event handlers for
various events and messages. `connected` and `disconnected` are examples
of client events. Extensions are also based on event emitters.

### Importing

The client is exported as a default export named `Client`. Import it like so:

**ES Modules / TypeScript:**
```ts
import StreamingClient from 'genesys-cloud-streaming-client';
```

**CommonJS:**
```js
const StreamingClient = require('genesys-cloud-streaming-client').default;
```

> Note: The class is exported as `Client` but you can name the import whatever you
> like. `StreamingClient` is the conventional name used in consuming applications.
> Older documentation may reference `GenesysCloudStreamingClient` — that name is only
> used by the UMD browser bundle (loaded via `<script>` tag) and is not the correct
> import name for module-based usage.

### Quick Start

```ts
import StreamingClient from 'genesys-cloud-streaming-client';

const client = new StreamingClient({
  host: 'wss://streaming.mypurecloud.com',
  authToken: 'your-access-token',
});

client.on('connected', () => {
  console.log('Streaming client connected');
});

client.on('disconnected', ({ reconnecting }) => {
  console.log('Disconnected. Reconnecting:', reconnecting);
});

await client.connect();
```

## API

###### Behavior notes

- The client will automatically reconnect when possible. Authentication errors are
one example of a disconnect that will not trigger a reconnect.

- The client will emit a `connected` event when the connection is established and
authenticated.

- The websocket host service may periodically request the client to reconnect to facilitate
connection draining for a deployment, or load balancing. If this occurs, the client will
automatically attempt to reconnect.

#### Constructor

`new StreamingClient(options)`

- parameters
  - `Object options` (`IClientOptions`) with properties:
    - `String host`: Required; WebSocket host URL. Example: `wss://streaming.mypurecloud.com`
        (other regions: `mypurecloud.ie`, `mypurecloud.jp`, `mypurecloud.de`, `mypurecloud.com.au`)
    - `String authToken`: Required (unless using guest JWT); access token for the user
    - `String apiHost`: Optional; API host override. Defaults to `host` with `wss://streaming.` stripped
        (e.g., `mypurecloud.com`). Useful if your API host differs from the streaming host.
    - `String jid`: Optional; JabberId for the user (retrieved from `api/v2/users/me` automatically
        if not provided). Not required if using guest authentication JWT.
    - `String jidResource`: Optional; identifier for the full JID, constructed as
        `{usersBareJid}/{jidResource}`. Helpful for identifying specific clients. A random UUID
        is generated if not provided.
    - `String jwt`: Optional (Required for guest authentication); JSON Web Token fetched from
        public API for access to a particular feature in guest mode (see documentation for
        Screen Share or Web Chat for details)
    - `Boolean optOutOfWebrtcStatsTelemetry`: Optional; if `true`, streaming-client will not
        send webrtc stats to server (packet loss, bitrate, jitter, etc.)
    - `ILogger logger`: Optional; secondary logger used in conjunction with the built-in logger
    - `LogLevel logLevel`: Optional; minimum level of logs sent to the server
    - `LogFormatterFn[] logFormatters`: Optional; see
        https://github.com/purecloudlabs/genesys-cloud-client-logger#how-formatters-work
    - `Boolean useServerSidePings`: Optional (default `true`); if `true`, streaming-client
        requests the server to send `ping` stanzas. If `false` (or unsupported by the server),
        streaming-client sends `ping` stanzas itself.
    - `Boolean reconnectOnNoLongerSubscribed`: Optional (default `true`); if `false`, the client
        will not auto-reconnect when it receives a `no_longer_subscribed` notification.
    - `String appName`: Optional; name of the consuming application (used for logging/diagnostics)
    - `String appVersion`: Optional; version of the consuming application
    - `Boolean allowIPv6`: Optional (default `false`); if `true`, IPv6 ICE candidates will be
        included during WebRTC session negotiation. By default, IPv6 candidates are filtered out.
    - `String appId`: Optional; ID of the consuming application

#### Methods

`client.connect(options?) : Promise<void>` — Initialize the WebSocket connection for streaming
connectivity with Genesys Cloud. `connect` must be called before any events will trigger.

- parameters (all optional)
  - `Object options` (`StreamingClientConnectOptions`) with properties:
    - `Number maxConnectionAttempts`: how many attempts before giving up (default: `1`)
    - `Number maxDelayBetweenConnectionAttempts`: max delay in ms for exponential backoff
        (default: `90000`)
    - `Boolean keepTryingOnFailure`: **deprecated** (since v15.1.1) — use `maxConnectionAttempts: Infinity` instead

`client.disconnect() : Promise<void>` — Disconnect from the streaming service.

`client.checkNetworkConnectivity() : Promise<boolean>` — Performs an active network
connectivity check. First checks `navigator.onLine` as a quick hint, then makes a
request to the API to verify real connectivity. Returns `true` if connectivity is
confirmed, `false` otherwise. Emits `networkConnectivityWarning` on failure. This is
called automatically during connection attempts but can also be called directly.
In JWT-only mode (no auth token), the active API check is skipped and only
`navigator.onLine` is used.

`client.on(eventName, handler) : void` — Register an event handler for the client.

- parameters
  - `String eventName` — event name to watch
      - Events Supported:
        - `'connected'` — when the streaming service is connected AND authenticated
        - `'disconnected'` — when the streaming service is disconnected. Handler receives
            `{ reconnecting: boolean, error?: Error }`
        - `'networkConnectivityWarning'` — emitted when a network connectivity issue is detected
  - `Function handler` — handler to invoke when event is emitted

`client.once(eventName, handler) : void` — Like `on` but handler will be called only once.

`client.setAccessToken(token) : void` — Sets the client's and the logger's access token.
Useful for refreshing tokens without reconnecting.

`client.stopServerLogging() : void` — Flush pending logs and stop sending logs to the server.

`client.startServerLogging() : void` — Resume sending logs to the server.

#### Extensions

> For details on implementing new extensions, see [extensions.md].

The following extensions are currently bundled with the client:

 - Ping (for keepalive on the socket sent from the client)
 - ServerMonitor (for keepalive on the socket sent from the server)
 - ConnectionTransfer (for automatic reconnecting when the WebSocket host requests the client to reconnect)
 - Messenger (for media message broadcasting between clients)
 - [Notifications](notifications.md)
 - [WebRTC Sessions](webrtc-sessions.md)

## Known Issues and Workarounds

### Axios
We recently updated axios in this library as well as in our dependencies. In the 1.x.x version of axios, they changed the
module type from CommonJS to ECMAScript. Since Jest runs in a node environment, we need to specify the node version
of axios when testing. This can be done by adjusting the `moduleNameMapper` for jest. If your jest config is in your
`package.json`:
```json
"jest": {
  "moduleNameMapper": {
    "axios": "axios/dist/node/axios.cjs"
  }
}
```

or if your config is in a `jest.config.js`:
```js
module.exports = {
  moduleNameMapper: {
    "axios": "axios/dist/node/axios.cjs"
  },
};
```

NOTE: if you have conflicting versions of axios, you will probably have to specify the axios version present *inside* the streaming-client repo:
```json
"moduleNameMapper": {
  "axios": "genesys-cloud-streaming-client/node_modules/axios/dist/node/axios.cjs"
}
```

### crypto.getRandomValues()
We recently updated UUID in our dependencies. Starting in V8 of UUID, crypto is required. This is native in the browser and in node, however
Jest runs the *browser* code in *node* environments. Because of this we need to map node's crypto to window.crypto. You can do this by adding
the following to your `setup-tests.ts` file for jest. Also, this is apparently fixed in jest V29 and later.
```ts
const nodeCrypto = require('crypto');
Object.defineProperty(window, 'crypto', {
  value: {
    getRandomValues: function (buffer: any) {
      return nodeCrypto.randomFillSync(buffer);
    }
  }
});
```
