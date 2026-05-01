# WebRTC Sessions

The WebRTC Sessions extension manages real-time communication sessions (softphone,
screen recording, screen share, video, etc.) over the streaming client's XMPP
connection.

Access it via `client.webrtcSessions`.

## Events

Listen for events using `client.webrtcSessions.on(event, handler)`:

| Event | Description |
|-------|-------------|
| `requestIncomingRtcSession` | An incoming call proposal was received (Jingle Message Initiation) |
| `cancelIncomingRtcSession` | The caller retracted the proposal before it was answered |
| `handledIncomingRtcSession` | The session was answered on another client |
| `outgoingRtcSessionProceed` | The remote party accepted the call proposal |
| `outgoingRtcSessionRejected` | The remote party rejected the call proposal |
| `incomingRtcSession` | A Jingle session was created for an incoming call |
| `outgoingRtcSession` | A Jingle session was created for an outgoing call |
| `rtcSessionError` | An error occurred during session negotiation |
| `requestWebrtcDump` | A WebRTC dump was requested by another participant |

## Methods

`client.webrtcSessions.acceptRtcSession(sessionId: string): void`
Accept an incoming session by its session ID.

`client.webrtcSessions.rejectRtcSession(sessionId: string, ignore?: boolean): void`
Reject an incoming session. If `ignore` is `true`, the rejection is silent.

`client.webrtcSessions.cancelRtcSession(sessionId: string): void`
Cancel an outgoing session that has not yet been accepted.

`client.webrtcSessions.rtcSessionAccepted(sessionId: string): void`
Notify the extension that a session was accepted (used for coordination across clients).

`client.webrtcSessions.initiateRtcSession(opts): Promise<void>`
Initiate an outgoing RTC session.

`client.webrtcSessions.refreshIceServers(): Promise<any[]>`
Fetch fresh ICE/TURN server credentials.

`client.webrtcSessions.notifyScreenShareStart(session): void`
Send a notification that screen sharing has started for the given session.

`client.webrtcSessions.notifyScreenShareStop(session): void`
Send a notification that screen sharing has stopped for the given session.

`client.webrtcSessions.getSessionTypeByJid(jid: string): SessionTypes`
Determine the session type (softphone, screenRecording, etc.) from a JID.

`client.webrtcSessions.getSessionManager(): SessionManager | undefined`
Get the underlying Jingle `SessionManager` instance, if available.

`client.webrtcSessions.getAllSessions(): IMediaSession[]`
Get all active media sessions.

## Session Types

The following session types are supported:

- `softphone` — Voice calls
- `screenRecording` — Screen recording sessions
- `screenShare` — ACD screen share sessions
- `collaborateVideo` — Video/collaborate sessions
- `liveScreenMonitoring` — Live screen monitoring
- `unknown` — Unrecognized session type
