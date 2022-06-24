# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
# [Unreleased](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v14.1.0...HEAD)

### Fixed
* [PCM-1943](https://inindca.atlassian.net/browse/PCM-1943) – Reverted faulty connect/retry logic introduced with [PCM-1908](https://inindca.atlassian.net/browse/PCM-1908) (v14.0.0)

### Added
* [PCM-1935](https://inindca.atlassian.net/browse/PCM-1935) – added build, deploy, and publish notifications to the Jenkinsfile

# [v14.1.0](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v14.0.1...v14.1.0)
### Added
* [PCM-1819](https://inindca.atlassian.net/browse/PCM-1819) Added separate backgroundassistant endpoints that will be used when using a screen recording jwt

# [v14.0.1](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v14.0.0...v14.0.1)

### Fixed
* [PCM-1926](https://inindca.atlassian.net/browse/PCM-1926) – make sure that the `data` (ie. body) is sent with HTTP post & put requests.

### Added
* Added instance level version property. The streaming-client version can now be accessed statically or on constructed instances.

# [v14.0.0](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.4.1...v14.0.0)
### Breaking Changes
* HttpClient response objects now use `data` instead of `body`. For example, if you make a request like this:
```ts
const response = await HttpClient.requestApi('/users/', { method: 'get' })

// old way which is no longer valid:
const users = response.body;

// new way:
const users = response.data;
```
### Added
* [PCM-1837](https://inindca.atlassian.net/browse/PCM-1837) – add `setAccessToken(token)` function
* [PCM-1844](https://inindca.atlassian.net/browse/PCM-1844) – stop sending logs on disconnect:
  * add `stopServerLogging()` & `startServerLogging()` functions to allow consumers to stop sending server
    logs that are sent via the client-logger.
  * on `client.disconnect()`, logs will stop being sent to the server.
  * on `client.connect()`, logs will start being sent to the server again.

### Changed
* [PCM-1842](https://inindca.atlassian.net/browse/PCM-1842) – migrate to the new pipeline. Also versioning cdn urls with major and exact versions. For example:
    * `/v13.5.0/streaming-client.browser.js` (exact version)
    * `/v13/streaming-client.browser.js` (locked to latest for a specific major version)
* [PCM-1842](https://inindca.atlassian.net/browse/PCM-1842)/[PCM-1560](https://inindca.atlassian.net/browse/PCM-1560) – Upgrade to new pipeline

### Fixed
* [ACE-2053](https://inindca.atlassian.net/browse/ACE-2053) – Remove superagent which is no longer maintained in order to get away from the 'formidable' snyke vulnerability.
* [PCM-1908](https://inindca.atlassian.net/browse/PCM-1908) – fixing some `.connect()` functionality:
    * `autoReconnect` no longer default to `true` but will be set to true after successfully connecting once
    * when `connect()` times out, it will call through to stop any pending WS connect that stanza my still be attempting
    * `connect()` will now reject when stanza emits a `--transport-disconnected` event which is what stanza emits when there
        was a WS connection that failed or terminated. Note that stanza does not sufface the error, so we will be rejecting
        with a generic error.
* Addressed snyk and npm audit issues
* [PCM-1862](https://inindca.atlassian.net/browse/PCM-1862) - remove individual topics from the tracked lists (subscriptions) after their last handlers have been removed. Fixed `_notifications.resubscribe()` to not treat individual topics as bulk topics

# [v13.4.1](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.4.0...v13.4.1)
### Added
* [PCM-1773](https://inindca.atlassian.net/browse/PCM-1773) – Added an es bundle for consumers that cannot bundle mixed node_modules.
  `package.json` entry point is `rollup:bundle` as to not coflict with the SDK's `es:bundle`. This is effectively not "turning on" this feature.
  But can still be opt-in. Generally, if this is needed, consumers should be utilizing the SDK's bundled es modules.
* [PCM-1770](https://inindca.atlassian.net/browse/PCM-1770) – Converted `SessionTypes` to an `enum` but still left the union type as to not break consumers' typings.
* Renamed `ISessionInfo` to `IPendingSession` (but kept `ISessionInfo` for backwards compatibility).
# [v13.4.0](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.3.7...v13.4.0
### Added
* [PCM-1753](https://inindca.atlassian.net/browse/PCM-1753) – Add an option for log formatters

# [v13.3.7](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.3.6...v13.3.7)
### Fixed
* [PCM-1760](https://inindca.atlassian.net/browse/PCM-1760) – GenesysCloudMediaSessions are now passed the correct sessionType
# [v13.3.6](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.3.5...v13.3.6)
* repeat of 13.3.5
# [v13.3.5](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.3.4...v13.3.5)
### Changed
* [PCM-1758](https://inindca.atlassian.net/browse/PCM-1758) – Auto send proceeds after the initial proceed when we get proposes


# [v13.3.4](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.3.3...v13.3.4)
### Changed
* [PCM-1754](https://inindca.atlassian.net/browse/PCM-1754) – Added several webrtc related logs

# [v13.3.3](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.3.2...v13.3.3)
### Fixed
* [PCM-1752](https://inindca.atlassian.net/browse/PCM-1752) - Tag all the messages from the webrtc sessions with conversationId, sessionType, and sessionId.
* [PCM-1749](https://inindca.atlassian.net/browse/PCM-1749) - Streaming client will now automatically update ice servers every 6 hours. Also added some minor logging enhancements.

# [v13.3.2](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.3.1...v13.3.2)
### Fixed
* [PCM-1749](https://inindca.atlassian.net/browse/PCM-1749) - Periodically refresh the ice servers so the turn creds are up to date.

### Added
* Bumped from stanza `^12.13.x` to `^12.17.x`
* [PCM-1737](https://inindca.atlassian.net/browse/PCM-1737) – Pulled in [GenesysCloudClientLogger](https://github.com/purecloudlabs/genesys-cloud-client-logger/).
    * Streaming-client will now construct its own logger to send logs to the server. Opt out of this by using `optOutOfWebrtcStatsTelemetry = true`.
    * Added the following options to constructor config: `logLevel`, `appId`, and `logger`. `appId` should be a unique identifier of the parent app to be able to tie individual clients to each other in the logs.

# [v13.3.1](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.3.0...v13.3.1)
### Fixed
* [PCM-1726](https://inindca.atlassian.net/browse/PCM-1726) - Removed `package.json#browser` (it still gets built and is available at `dist/streaming-client.browser.js`) since streaming-client is only designed for the web anyway. Keeping the build to `commonJS` and `ES Modules` (`cjs` & `es` in `dist/`). Also, corrected `package.json#module` to point to the built file (previously was pointing at the incorrect file name).
### Added
* [PCM-1727](https://inindca.atlassian.net/browse/PCM-1727) – Added optional config options `appName` and `appVersion` to pass into the constructor. Streaming-client will send these values to the stats pushed to new relic.

# [v13.3.0](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.2.9...v13.3.0)
### Added
* [PCM-1715](https://inindca.atlassian.net/browse/PCM-1715) - Updated to override how `stanza` currently ends sessions to prevent race condition. Now sending `session-terminate` and if after two seconds the peer connection is still open, manually closing it.

### Fixed
* [PCM-1722](https://inindca.atlassian.net/browse/PCM-1722) - Fixed issue where file path in `package.json` did not match the actual built file path and where file path for `module` pointed to a file that did not exist.

# [v13.2.9](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.2.8...v13.2.9)
### Fixed
* [PCM-1712](https://inindca.atlassian.net/browse/PCM-1712) - Fixed more cases of browser throttling due to setTimeout

# [v13.2.8](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.2.7...v13.2.8)
### Fixed
* [PCM-1692](https://inindca.atlassian.net/browse/PCM-1692) - Bump `async` to `3.2.1` (dep of `stanza`) to fix background tab throttling of WebSocket messages. This is causing webrtc sessions to not connect because `transport-info`s were being throttled.
* [PCM-1701](https://inindca.atlassian.net/browse/PCM-1701) - Do not add/use Google STUN servers by default (ie. override `stanza`'s default behavior of adding these to the config).
* [PCM-1529](https://inindca.atlassian.net/browse/PCM-1529) - Soft reconnects will actually attempt to connect a WebSocket

# [v13.2.7](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.2.6...v13.2.7)
### Added
* [PCM-1624](https://inindca.atlassian.net/browse/PCM-1624) - Added logging for failed HTTP requests to console - not sending to Sumo.

# [v13.2.6](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.2.5...v13.2.6)
### Fixed
* fixed unit tests in later versions of node
### Added
* added more logging around webrtc signaling

# [v13.2.5](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.2.4...v13.2.5)
* [PCM-1615](https://inindca.atlassian.net/browse/PCM-1615) – Fixed Force TURN for Firefox browser

# [v13.2.4](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.2.3...v13.2.4)
* [PCM-1547](https://inindca.atlassian.net/browse/PCM-1547) - Fixed 1:1 video alert toast hanging after answer timeout and fixed invites hanging when accepting 1:1 video call with two clients open.
* [PCM-1561](https://inindca.atlassian.net/browse/PCM-1561) - Added logging for ICE and connection state changes.

# [v13.2.3](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.2.2...v13.2.3)
### Fixed
* [PCM-1572](https://inindca.atlassian.net/browse/PCM-1572) – changed http request to `subscriptions` to not retry on failures.
* Removed PII logging from failed HTTP requests

# [v13.2.2](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.2.1...v13.2.2)
### Fixed
* [PCM-1552](https://inindca.atlassian.net/browse/PCM-1552) – reworked ping timer logic to avoid chrome v88 timer throttling (read here: https://developer.chrome.com/blog/timer-throttling-in-chrome-88/)
* [PCM-1558](https://inindca.atlassian.net/browse/PCM-1558) – removed IP addresses from stats sent to New Relic. Removed `fromJid` from being logged.
* [PCM-1557](https://inindca.atlassian.net/browse/PCM-1557) – set `iceTransportPolicy` to use force TURN if only TURN servers are received

### Added
* [PCM-1560](https://inindca.atlassian.net/browse/PCM-1560) – added spigot tests to replace valve

# [v13.2.1](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.2.0...v13.2.1)
### Fixed
* [PCM-1518](https://inindca.atlassian.net/browse/PCM-1518) – optimize stats to not send as often
### Added
* `noAuthHeader` to `HttpClient.requestApi`'s `RequestApiOptions` so callers can opt-out of using an `authorization` header.

# [v13.2.0](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.1.1...v13.2.0)
### Changed
* [PCM-1540](https://inindca.atlassian.net/browse/PCM-1540) - formatting http errors from superagent better

# [v13.1.1](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.1.0...v13.1.1)
### Fixed
* [PCM-1516](https://inindca.atlassian.net/browse/PCM-1516) – hard reconnects were not retried making network losses fatal
* [PCM-1525](https://inindca.atlassian.net/browse/PCM-1525) - fix xml attr for conversationId for upgrademedia stanza

# [v13.1.0](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.0.5...v13.1.0)
### Added
* Added the ability to specific the jid resource as a config option

# [v13.0.5](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.0.4...v13.0.5)
### Fixed
* fix the main and module references in package.json

# [v13.0.4](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.0.3...v13.0.4)
### Fixed
* notifications.unsubscribe will clean up all handlers if a handler isn't provided

# [v13.0.3](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.0.2...v13.0.3)
### Fixed
* Fixed iceTransportPolicy (forced turn) on webrtc-sessions

# [v13.0.2](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.0.1...v13.0.2)
### Fixed
* Fixed the screenstart and screenstop stanzas

# [v13.0.1](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v12.0.1...v13.0.1)
### Breaking Changes
* xmppSubscribe and xmppUnsubscribe now return a promise and no longer take a callback
* most of the methods in webrtcSessions have changed to return promises
* wild-card event listeners are no longer a thing

### Added
* For improvement metrics, we now send time series stats data to Genesys Cloud API. Added `optOutOfWebrtcStatsTelemetry` property to client config

### Changed
* genesys-cloud-webrtc-sessions is no more. A replacement now exists directly in streaming-client
* upgraded to stanza12
* streaming-client is now in typescript

# [v12.0.2](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v12.0.1...v12.0.2)
### Changed
* update webrtc-session library
* put in a hack to handle to webpack weirdness for angular builds

# [v12.0.1](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v12.0.0...v12.0.1)
### Changed
* modified commonjs webpack build/transpile to a commonjs compatible file
* fixed package.json main field to point to new commonjs built file
* updates some dependencies


# [v12.0.0](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v11.3.1...v12.0.0)
### Breaking Changes
* package and library renamed to genesys-cloud-streaming-client
* changed package.json main field to point to es6 source file

### Added
* debug level logging on ajax requests

### Changed
* updated auth failure log to pass channelId into the details object - [PR#57](https://github.com/purecloudlabs/purecloud-streaming-client/pull/57)
* updated to use genesys-cloud-streaming-client-webrtc-sessions

# [v11.3.1](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v11.3.0...v11.3.1)
### Changed
* version bump of purecloud-streaming-client-webrtc-sessions to 7.2.81

# [v11.3.0](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v11.2.0...v11.3.0)
### Added
* [ENGAGEUI-3797] add functionality for optionally setting topic priorities and prioritizing topic list

# [v11.2.0](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v11.1.3...v11.2.0)
### Added
* Limit topic subscriptions and log dropped topics
* Log more info with missed pings/pongs
### Changed
* version bump of purecloud-streaming-client-webrtc-sessions to 7.2.80

# [v11.1.3](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v11.1.2...v11.1.3)
### Added
* add logging for explicit actions

# [v11.1.2](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v11.0.2...v11.1.2)
### Added
* bump genesys-cloud-streaming-client-webrtc-sessions to 7.2.29
* Added a config option to disable reconnecting when receiving a no_longer_subscribed message

# [v11.0.2](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v11.0.1...v11.0.2)
### Added
* Included channelId in error logs

# [v11.0.1](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v11.0.0...v11.0.1)
### Added
* Added changelog file
### Fixed
* Fixed an issue with topics not being combined correctly - [PR #43](https://github.com/purecloudlabs/genesys-cloud-streaming-client/pull/43)

# [v11.0.0](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v10.0.1...v11.0.0)
#### Breaking Changes
* In previous versions, calling `acceptRtcSession` on the `webrtcsessions` extension would send both a 'proceed' and 'accept' stanza in one call. This caused race a condition when multiple clients using autoAnswer were open.  They would call `acceptRtcSession` at the same time which sent the other client an 'accept' stanza, resulting in neither client actually handling the incoming session. As a result, we recommend not calling `rtcSessionAccepted` until the session has actually been received.
### Added
* Added a new function `rtcSessionAccepted` to send an 'accept' event
### Changed
* No longer sending 'proceed' and 'accept' in the same call to `acceptRtcSession`
