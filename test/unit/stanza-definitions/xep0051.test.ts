import { createClient } from 'stanza';
import { XMLElement } from 'stanza/jxt';

import { connectionTransfer } from '../../../src/stanza-definitions/xep0051';

describe('connectionTransferDefinition', () => {
  it('should convert xml to object', () => {
    const domain = new XMLElement('domain');
    const server = new XMLElement('server');
    const query = new XMLElement('query', { xmlns: 'urn:xmpp:cxfr' }, [domain, server]);
    const iq = new XMLElement('iq', { xmlns: 'jabber:client', type: 'set' }, [query]);

    const stanza = createClient({});
    stanza.stanzas.define(connectionTransfer);

    const converted = stanza.stanzas.import(iq);
    expect(converted?.connectionTransfer).toBeTruthy();
  });
});
