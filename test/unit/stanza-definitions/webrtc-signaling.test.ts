import { definitions } from '../../../src/stanza-definitions/webrtc-signaling';
import { v4 } from 'uuid';
import { createClient } from 'stanza';

const stanza = createClient({});
stanza.stanzas.define(definitions);

describe('upgradeMediaPresenceDefinition', () => {
  it('should convert object to xml', () => {
    const mediaPresence = {
      type: 'upgradeMedia' as any,
      to: 'tojid@conference.com',
      id: v4(),
      from: 'fromjid@conference.com',
      media: {
        conversationId: 'myconversationid',
        sourceCommunicationId: 'mysourcecommid',
        audio: true
      }
    };

    const converted = stanza.stanzas.export('presence', mediaPresence);
    const expected = `<presence xmlns="jabber:client" type="upgradeMedia" to="${mediaPresence.to}" id="${mediaPresence.id}" from="${mediaPresence.from}"><x xmlns="orgspan:mediastream" conversationId="${mediaPresence.media.conversationId}" sourceCommunicationId="${mediaPresence.media.sourceCommunicationId}"><mediastream audio="true"/></x></presence>`;
    expect(converted!.toString()).toEqual(expected);
  });
});
