#Changelog
## v11.0.2
* Included channelId in error logs

## v11.0.1
* Added changelog file
* Fixed an issue with topics not being combined correctly - [PR #43](https://github.com/purecloudlabs/purecloud-streaming-client/pull/43)

## v11.0.0
* Added a new function `rtcSessionAccepted` to send an 'accept' event
* No longer sending 'proceed' and 'accept' in the same call to `acceptRtcSession`

#### Breaking Changes
* In previous versions, calling `acceptRtcSession` on the `webrtcsessions` extension would send both a 'proceed' and 'accept' stanza in one call. This caused race a condition when multiple clients using autoAnswer were open.  They would call `acceptRtcSession` at the same time which sent the other client an 'accept' stanza, resulting in neither client actually handling the incoming session. As a result, we recommend not calling `rtcSessionAccepted` until the session has actually been received.
