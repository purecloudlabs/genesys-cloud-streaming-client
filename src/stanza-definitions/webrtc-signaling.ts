import { DefinitionOptions, attribute, childBoolean, booleanAttribute } from 'stanza/jxt';

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
  namespace: 'urn:xmpp:jingle-message:0'
};

const proceedDefinition: DefinitionOptions = {
  aliases: ['message.proceed'],
  element: 'proceed',
  fields: {
    sessionId: attribute('id')
  },
  namespace: 'urn:xmpp:jingle-message:0'
};

const sessionAcceptedDefinition: DefinitionOptions = {
  aliases: ['message.accept'],
  element: 'accept',
  fields: {
    sessionId: attribute('id')
  },
  namespace: 'urn:xmpp:jingle-message:0'
};

export const definitions = [
  proposeDefinition,
  proceedDefinition,
  sessionAcceptedDefinition
];
