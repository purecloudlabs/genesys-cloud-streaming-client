import { DefinitionOptions, attribute, booleanAttribute, childAttribute } from 'stanza/jxt';
import { NS_JINGLE_RTP_INFO_1 } from 'stanza/Namespaces';

const NS_JINGLE_SIGNALING = 'urn:xmpp:jingle-message:0';

export interface Propose {
  sessionId: string;
  conversationId: string;
  autoAnswer: boolean;
  persistentConversationId?: string;
  originalRoomJid?: string;
  fromUserId?: string;
}

const proposeDefinition: DefinitionOptions = {
  aliases: ['message.propose'],
  element: 'propose',
  fields: {
    conversationId: attribute('inin-cid'),
    persistentConversationId: attribute('inin-persistent-cid'),
    originalRoomJid: attribute('inin-ofrom'),
    autoAnswer: booleanAttribute('inin-autoanswer'),
    fromUserId: attribute('inin-user-id'),
    sessionId: attribute('id')
  },
  namespace: NS_JINGLE_SIGNALING
};

const proceedDefinition: DefinitionOptions = {
  aliases: ['message.proceed'],
  element: 'proceed',
  fields: {
    sessionId: attribute('id')
  },
  namespace: NS_JINGLE_SIGNALING
};

const sessionAcceptedDefinition: DefinitionOptions = {
  aliases: ['message.accept'],
  element: 'accept',
  fields: {
    sessionId: attribute('id')
  },
  namespace: NS_JINGLE_SIGNALING
};

const sessionRejectedDefinition: DefinitionOptions = {
  aliases: ['message.reject'],
  element: 'reject',
  fields: {
    sessionId: attribute('id')
  },
  namespace: NS_JINGLE_SIGNALING
};

const sessionRetractedDefinition: DefinitionOptions = {
  aliases: ['message.retract'],
  element: 'retract',
  fields: {
    sessionId: attribute('id')
  },
  namespace: NS_JINGLE_SIGNALING
};

const screenStartDefinition: DefinitionOptions = {
  aliases: ['iq.jingle.screenstart'],
  element: 'screen-start',
  namespace: NS_JINGLE_RTP_INFO_1
};

const screenStopDefinition: DefinitionOptions = {
  aliases: ['iq.jingle.screenstop'],
  element: 'screen-stop',
  namespace: NS_JINGLE_RTP_INFO_1
};

const upgradeMediaPresenceDefinition: DefinitionOptions = {
  aliases: ['presence.media'],
  element: 'x',
  fields: {
    conversationId: attribute('conversationId'),
    sourceCommunicationId: attribute('sourceCommunicationId'),
    screenShare: childAttribute(null, 'mediastream', 'screenShare'),
    video: childAttribute(null, 'mediastream', 'video'),
    audio: childAttribute(null, 'mediastream', 'audio'),
    listener: childAttribute(null, 'mediastream', 'listener'),
    screenRecording: childAttribute(null, 'mediastream', 'screenRecording'),
  },
  namespace: 'orgspan:mediastream'
};

export const definitions = [
  proposeDefinition,
  proceedDefinition,
  sessionAcceptedDefinition,
  sessionRejectedDefinition,
  sessionRetractedDefinition,
  screenStartDefinition,
  screenStopDefinition,
  upgradeMediaPresenceDefinition
];
