# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

# [Unreleased](https://github.com/purecloudlabs/genesys-cloud-streaming-client/compare/v13.0.5...HEAD)

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
