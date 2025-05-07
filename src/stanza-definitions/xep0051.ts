import { Stanzas } from 'stanza';
import { childText, DefinitionOptions } from 'stanza/jxt';

// XEP-0051: Connection Transfer
// Source: https://xmpp.org/extensions/xep-0051.html
// Version: 0.2.1 (2022-03-08)
// ---------------------------
// We don't currently use domain or server

const NS_CONNECTION_TRANSFER = 'urn:xmpp:cxfr';

declare module 'stanza' {
  export interface AgentEvents {
    'iq:set:connectionTransfer': Stanzas.ReceivedIQ & { query: ConnectionTransfer };
  }
}

declare module 'stanza/protocol' {
  export interface IQPayload {
    query?: ConnectionTransfer;
  }
}

export interface ConnectionTransfer {
  domain?: string;
  server?: string;
}

/*
  <iq xmlns="jabber:client" id="<someId>" to="<toJID>" type="set">
    <query xmlns="urn:xmpp:cxfr">
      <domain>jabber.org</domain>
      <server>123.123.123.122</server>
    </query>
  </iq>
*/
export const connectionTransfer: DefinitionOptions = {
  path: 'iq.query',
  namespace: NS_CONNECTION_TRANSFER,
  element: 'query',
  fields: {
    domain: childText(null, 'domain'),
    server: childText(null, 'server')
  }
};
