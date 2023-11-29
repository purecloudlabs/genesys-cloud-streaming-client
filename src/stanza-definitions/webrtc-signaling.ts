import { DefinitionOptions, attribute, booleanAttribute, childAttribute, childJSON } from 'stanza/jxt';
import { NS_CLIENT, NS_JINGLE_RTP_INFO_1 } from 'stanza/Namespaces';
import { Stanzas } from 'stanza';
import { GenesysMediaMessage, GenesysWebrtcJsonRpcMessage } from '../types/interfaces';

const NS_JINGLE_SIGNALING = 'urn:xmpp:jingle-message:0';

export interface Propose {
  sessionId: string;
  conversationId: string;
  autoAnswer: boolean;
  persistentConversationId?: string;
  originalRoomJid?: string;
  fromUserId?: string;
  sdpOverXmpp?: boolean;
}

const proposeDefinition: DefinitionOptions = {
  aliases: ['message.propose'],
  element: 'propose',
  fields: {
    conversationId: attribute('inin-cid'),
    persistentConversationId: attribute('inin-persistent-cid'),
    sdpOverXmpp: booleanAttribute('inin-sdp-over-xmpp'),
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

// this allows you to declare IQ types like this:
/*
  const iq: IQ = {
    type: 'set',
    genesysWebrtc: {...}
  }
*/
declare module 'stanza/protocol' {
  export interface IQPayload {
    genesysWebrtc?: GenesysWebrtcJsonRpcMessage;
  }

  export interface ReceivedMessage {
    mediaMessage?: GenesysMediaMessage;
  }

  export interface AgentEvents {
    /* tslint:disable-next-line no-unnecessary-qualifier */
    'iq:set:genesysWebrtc': Stanzas.ReceivedIQ & { genesysWebrtc: GenesysWebrtcJsonRpcMessage };
  }
}

// this allows parsing xml that looks something like this:
/*
  <iq xmlns="jabber:client" [other stuff]>
    <genesys-webrtc xmlns="genesys">{ "id": "whatver", "anyOtherFieldICareAbout": true }</genesys-webrtc>
  </iq>
*/
const genesysWebrtc: DefinitionOptions = {
  path: 'iq',
  namespace: NS_CLIENT,
  element: 'iq',
  fields: {
    genesysWebrtc: childJSON('genesys', 'genesys-webrtc')
  }
};

const mediaMessage: DefinitionOptions = {
  path: 'message',
  namespace: NS_CLIENT,
  element: 'message',
  fields: {
    mediaMessage: childJSON('genesys', 'media-message')
  }
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
    screenRecording: childAttribute(null, 'mediastream', 'screenRecording')
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
  upgradeMediaPresenceDefinition,
  genesysWebrtc,
  mediaMessage
];
