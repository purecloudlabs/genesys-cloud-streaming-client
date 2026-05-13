"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.definitions = void 0;
const jxt_1 = require("stanza/jxt");
const Namespaces_1 = require("stanza/Namespaces");
const NS_JINGLE_SIGNALING = 'urn:xmpp:jingle-message:0';
const proposeDefinition = {
    aliases: ['message.propose'],
    element: 'propose',
    fields: {
        conversationId: (0, jxt_1.attribute)('inin-cid'),
        persistentConversationId: (0, jxt_1.attribute)('inin-persistent-cid'),
        sdpOverXmpp: (0, jxt_1.booleanAttribute)('inin-sdp-over-xmpp'),
        privAnswerMode: (0, jxt_1.attribute)('inin-priv-answer-mode'),
        originalRoomJid: (0, jxt_1.attribute)('inin-ofrom'),
        autoAnswer: (0, jxt_1.booleanAttribute)('inin-autoanswer'),
        fromUserId: (0, jxt_1.attribute)('inin-user-id'),
        sessionId: (0, jxt_1.attribute)('id'),
        meetingId: (0, jxt_1.attribute)('inin-meeting-id')
    },
    namespace: NS_JINGLE_SIGNALING
};
const proceedDefinition = {
    aliases: ['message.proceed'],
    element: 'proceed',
    fields: {
        sessionId: (0, jxt_1.attribute)('id')
    },
    namespace: NS_JINGLE_SIGNALING
};
const sessionAcceptedDefinition = {
    aliases: ['message.accept'],
    element: 'accept',
    fields: {
        sessionId: (0, jxt_1.attribute)('id')
    },
    namespace: NS_JINGLE_SIGNALING
};
const sessionRejectedDefinition = {
    aliases: ['message.reject'],
    element: 'reject',
    fields: {
        sessionId: (0, jxt_1.attribute)('id')
    },
    namespace: NS_JINGLE_SIGNALING
};
const sessionRetractedDefinition = {
    aliases: ['message.retract'],
    element: 'retract',
    fields: {
        sessionId: (0, jxt_1.attribute)('id')
    },
    namespace: NS_JINGLE_SIGNALING
};
const screenStartDefinition = {
    aliases: ['iq.jingle.screenstart'],
    element: 'screen-start',
    namespace: Namespaces_1.NS_JINGLE_RTP_INFO_1
};
const screenStopDefinition = {
    aliases: ['iq.jingle.screenstop'],
    element: 'screen-stop',
    namespace: Namespaces_1.NS_JINGLE_RTP_INFO_1
};
// this allows parsing xml that looks something like this:
/*
  <iq xmlns="jabber:client" [other stuff]>
    <genesys-webrtc xmlns="genesys">{ "id": "whatver", "anyOtherFieldICareAbout": true }</genesys-webrtc>
  </iq>
*/
const genesysWebrtc = {
    path: 'iq',
    namespace: Namespaces_1.NS_CLIENT,
    element: 'iq',
    fields: {
        genesysWebrtc: (0, jxt_1.childJSON)('genesys', 'genesys-webrtc')
    }
};
const mediaMessage = {
    path: 'message',
    namespace: Namespaces_1.NS_CLIENT,
    element: 'message',
    fields: {
        mediaMessage: (0, jxt_1.childJSON)('genesys', 'media-message')
    }
};
const upgradeMediaPresenceDefinition = {
    aliases: ['presence.media'],
    element: 'x',
    fields: {
        conversationId: (0, jxt_1.attribute)('conversationId'),
        sourceCommunicationId: (0, jxt_1.attribute)('sourceCommunicationId'),
        screenShare: (0, jxt_1.childAttribute)(null, 'mediastream', 'screenShare'),
        video: (0, jxt_1.childAttribute)(null, 'mediastream', 'video'),
        audio: (0, jxt_1.childAttribute)(null, 'mediastream', 'audio'),
        listener: (0, jxt_1.childAttribute)(null, 'mediastream', 'listener'),
        screenRecording: (0, jxt_1.childAttribute)(null, 'mediastream', 'screenRecording'),
        videoGuest: (0, jxt_1.childAttribute)(null, 'mediastream', 'videoGuest')
    },
    namespace: 'orgspan:mediastream'
};
exports.definitions = [
    proposeDefinition,
    proceedDefinition,
    sessionAcceptedDefinition,
    sessionRejectedDefinition,
    sessionRetractedDefinition,
    screenStartDefinition,
    screenStopDefinition,
    upgradeMediaPresenceDefinition,
    genesysWebrtc,
    mediaMessage
];
