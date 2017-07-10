'use strict';

const exposeWebrtcEvents = {
  events: {
    REQUEST_WEBRTC_DUMP: 'requestWebrtcDump', // dump triggered by someone in room

    /* jingle messaging */
    REQUEST_INCOMING_RTCSESSION: 'requestIncomingRtcSession', // incoming call
    CANCEL_INCOMING_RTCSESSION: 'cancelIncomingRtcSession', // retracted (caller hungup before you answered)
    HANDLED_INCOMING_RTCSESSION: 'handledIncomingRtcSession', // you answered on another client
    OUTGOING_RTCSESSION_PROCEED: 'outgoingRtcSessionProceed', // target answered, wants to continue
    OUTGOING_RTCSESSION_REJECTED: 'outgoingRtcSessionRejected', // target rejected the call

    /* jingle */
    RTC_ICESERVERS: 'rtcIceServers', // ice servers have been discovered
    INCOMING_RTCSESSION: 'incomingRtcSession', // jingle session created for incoming call
    OUTGOING_RTCSESSION: 'outgoingRtcSession', // jingle session created for outgoing call
    RTCSESSION_ERROR: 'rtcSessionError', // jingle error occurred
    TRACE_RTCSESSION: 'traceRtcSession', // trace messages for logging, etc
    UPGRADE_MEDIA_ERROR: 'upgradeMediaError', // error occurred joining conference

    /* other  */
    UPDATE_MEDIA_PRESENCE: 'updateMediaPresence',
    LASTN_CHANGE: 'lastNChange'
  }
};

module.exports = {
  exposeWebrtcEvents
};
