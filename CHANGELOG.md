#Changelog

## v11.0.1
* Added changelog file

## v11.0.0
* Added a new function to send an 'accept' event
* No longer sending 'proceed' and 'accept' in the same call to `acceptRtcSession`

#### Breaking Changes
* In previous versions, calling `acceptRtcSession` on the `webrtcsessions` extension would send both a 'proceed' and 'accept' event in one call.  Beginning in version 11, the 'accept' has been moved to a separate function.  To do both a 'proceed' and an 'accept' you will need to call `webrtcsessions.acceptRtcSession` to send the proceed, and `webrtcsessions.rtcSessionAccepted` to send the accept.