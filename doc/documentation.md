# PureCloud Streaming Client (SDK)

The PureCloud Streaming Client serves as the Javascript Web SDK. It handles
establishing and maintaining a websocket connection to the PureCloud streaming
services. This project uses our new XMPP based signaling for real time APIs.

Features:

- [x] PubSub (notifications)
- [ ] WebRTC
    - [ ] Softphone*
    - [ ] Screen Recording※
    - [ ] Video/Screen Share※
    - [ ] ACD Screen Share※
- [ ] Chat※

\* Coming soon; Until supported in this project, WebRTC softphone applications can be built with
the [PureCloud WebRTC SDK](https://github.com/mypurecloud/purecloud-webrtc-sdk).

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

#### Constructor

`new PureCloudStreamingClient(options)`

- parameters
  - `Object options` with properties:
    - `String authToken`: Required; access token for the user
    - `String host`: Required; `wss://streaming.` + `mypurecloud.com || mypurecloud.ie ||
        mypurecloud.jp || mypurecloud.de || mypurecloud.com.au`
    - `String jid` : Required; JabberId for the user (get `from api/v2/users/me`)

#### Methods

`client.connect(options) : Promise<void>` - Initialize the WebSocket connection for streaming
connectivity with PureCloud. Initialize must be called before any events will trigger.

- parameters
  - `Object options` with properties same as the constructor. Will override any
  constructor options

`client.reconnect() : Promise<void>` - Disconnect (if connected) and reconnect to
the streaming service

`client.disconnect() : Promise<void>` - Disconnect from  the streaming
service

`client.on(eventName, handler) : void` - register an event handler for the client

- parameters
  - `String eventName` - event name to watch
      - Events Supported:
        - 'connected' - when the streaming service is connected AND authenticated
        - 'disconnected' - when the streaming service is disconnected
  - `Function handler` - handler to evoke when event is emitted

#### Extensions

> For details on implementing new extensions, see [extensions.md].

The following extensions are currently bundled with the client:

 - [Notifications](notifications.md)
 - [WebRTC Sessions](webrtc-sessions.md)
