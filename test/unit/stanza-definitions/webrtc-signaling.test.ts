import { definitions } from '../../../src/stanza-definitions/webrtc-signaling';
import { RecordingConsent } from '../../../src/webrtc';
import { createClient } from 'stanza';

const stanza = createClient({});
stanza.stanzas.define(definitions);

describe('upgradeMediaPresenceDefinition', () => {
  it('should convert object to xml', () => {
    const mediaPresence = {
      type: 'upgradeMedia' as any,
      to: 'tojid@conference.com',
      id: globalThis.crypto.randomUUID(),
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

  it.each<RecordingConsent>([
    'consented',
    'declined',
    'notCollected',
    'recordingNotAllowed'
  ])('should serialize recordingConsent "%s" onto the x element', (consent) => {
    const mediaPresence = {
      type: 'upgradeMedia' as any,
      to: 'tojid@conference.com',
      id: globalThis.crypto.randomUUID(),
      from: 'fromjid@conference.com',
      media: {
        conversationId: 'myconversationid',
        sourceCommunicationId: 'mysourcecommid',
        recordingConsent: consent,
        audio: true
      }
    };

    const converted = stanza.stanzas.export('presence', mediaPresence);
    const expected = `<presence xmlns="jabber:client" type="upgradeMedia" to="${mediaPresence.to}" id="${mediaPresence.id}" from="${mediaPresence.from}"><x xmlns="orgspan:mediastream" conversationId="${mediaPresence.media.conversationId}" sourceCommunicationId="${mediaPresence.media.sourceCommunicationId}" recordingConsent="${consent}"><mediastream audio="true"/></x></presence>`;
    expect(converted!.toString()).toEqual(expected);
  });

  it('should emit no recordingConsent attribute when not supplied', () => {
    const mediaPresence = {
      type: 'upgradeMedia' as any,
      to: 'tojid@conference.com',
      id: globalThis.crypto.randomUUID(),
      from: 'fromjid@conference.com',
      media: {
        conversationId: 'myconversationid',
        sourceCommunicationId: 'mysourcecommid',
        audio: true
      }
    };

    const converted = stanza.stanzas.export('presence', mediaPresence);
    expect(converted!.toString()).not.toContain('recordingConsent');
  });

  it('should round-trip recordingConsent when parsing xml', () => {
    const xml = `<presence xmlns="jabber:client" type="upgradeMedia" to="tojid@conference.com" id="someid" from="fromjid@conference.com"><x xmlns="orgspan:mediastream" conversationId="myconversationid" sourceCommunicationId="mysourcecommid" recordingConsent="declined"><mediastream audio="true"/></x></presence>`;
    const parsed: any = stanza.stanzas.parse(xml, 'presence');
    expect(parsed.media.recordingConsent).toEqual('declined');
  });

  it('should leave recordingConsent undefined when parsing xml without the attribute', () => {
    const xml = `<presence xmlns="jabber:client" type="upgradeMedia" to="tojid@conference.com" id="someid" from="fromjid@conference.com"><x xmlns="orgspan:mediastream" conversationId="myconversationid" sourceCommunicationId="mysourcecommid"><mediastream audio="true"/></x></presence>`;
    const parsed: any = stanza.stanzas.parse(xml, 'presence');
    expect(parsed.media.recordingConsent).toBeUndefined();
  });
});
