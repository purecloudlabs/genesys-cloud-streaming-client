# Genesys Cloud Streaming Client (SDK)

The Genesys Cloud Streaming Client serves as the Javascript Web SDK. It handles
establishing and maintaining a websocket connection to the Genesys Cloud streaming
services. This project uses our new XMPP based signaling for real time APIs.

Features:

- [x] PubSub (notifications)
- [ ] WebRTC
    - [x] Softphone
    - [ ] Screen Recording※
    - [ ] Video/Screen Share※
    - [ ] ACD Screen Share※
- [ ] Chat※

\* Coming soon; Until supported in this project, WebRTC softphone applications can be built with
the [Genesys Cloud WebRTC SDK](https://github.com/mypurecloud/genesys-cloud-webrtc-sdk).

※ Not yet roadmapped

## Usage

The SDK is based on a simple structure of a core client object with a few properties
and methods, and multiple extensions, each providing their own functionality.

Some extensions are bundled with the client, and others can be added at runtime.
See [Extensions](extensions.md) for details on implementing or adding an extension (or to
  request one be added to core).

After creating an instance of the client, your client can add event handlers for
various events and messages. `connected` and `disconnected`, are examples
of client events. Extensions are also based on event emitters.

## API

###### Behavior notes

- The client will automatically reconnect when possible. Authentication errors are
one example of a disconnect that will not trigger a reconnect.

- The client will emit a `connected` event when the connection is established and
authenticated.

- The websocket host service may periodically request the client reconnect to facilitate connection
draining for a deployment, or load balancing. The client has the ability to delay that reconnect up
to 10 minutes to allow the application to finish any active task which would be disrupted by a reconnect.
To subscribe to this event, use the `requestReconnect` event name, which emits with a callback. The
callback accepts an object with either `pending` or `done` property indicating that the reconnect should
be delayed or can proceed. If the callback is not called within one second, the disconnect will proceed.
If the callback is called with `{ pending: true }` then the disconnect will proceed after the callback
is called with `{ done: true }` or 10 minutes, whichever is sooner. Example:

```js
client.on('requestReconnect', function (callback) {
  // e.g., no calls are alerting
  if (this.canReconnectSafely()) {
    callback({ done: true });
  } else {
    callback({ pending: true });
    // e.g., an event when all calls have disconnected
    this.on('canReconnectSafely', function () {
      callback({ done: true });
    });
  }
});
```

#### Constructor

`new GenesysCloudStreamingClient(options)`

- parameters
  - `Object options` with properties:
    - `String authToken`: Required; access token for the user (not required if using guest authentication JWT)
    - `String host`: Required; `wss://streaming.` + `mypurecloud.com || mypurecloud.ie ||
        mypurecloud.jp || mypurecloud.de || mypurecloud.com.au`
    - `String jid` : Required; JabberId for the user (get from `api/v2/users/me`) (not required if using guest authentication JWT)
    - `String jwt` : Optional (Required for guest authentication); Json Web Token fetched from public API for acess
        to a particular feature in guest mode (see documentation for Screen Share or Web Chat for details)
    - `Boolean optOutOfWebrtcStatsTelemetry` : Optional; if true, streaming-client will not send webrtc stats to server (packet loss, bitrate, jitter, etc...)

#### Methods

`client.connect() : Promise<void>` - Initialize the WebSocket connection for streaming
connectivity with Genesys Cloud. `connect` must be called before any events will trigger.

`client.reconnect() : Promise<void>` - Disconnect (if connected) and reconnect to
the streaming service

`client.disconnect() : Promise<void>` - Disconnect from the streaming
service

`client.on(eventName, handler) : void` - register an event handler for the client

- parameters
  - `String eventName` - event name to watch
      - Events Supported:
        - 'connected' - when the streaming service is connected AND authenticated
        - 'disconnected' - when the streaming service is disconnected
  - `Function handler` - handler to evoke when event is emitted

`client.once(eventName, handler) : void` - like `on` but handler will be called only once

#### Extensions

> For details on implementing new extensions, see [extensions.md].

The following extensions are currently bundled with the client:

 - Ping (for keepalive on the socket)
 - Reconnector (for automatic reconnecting)
 - [Notifications](notifications.md)
 - [WebRTC Sessions](webrtc-sessions.md)
