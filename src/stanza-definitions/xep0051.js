"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectionTransfer = void 0;
const jxt_1 = require("stanza/jxt");
// XEP-0051: Connection Transfer
// Source: https://xmpp.org/extensions/xep-0051.html
// Version: 0.2.1 (2022-03-08)
// ---------------------------
// We don't currently use domain or server
const NS_CONNECTION_TRANSFER = 'urn:xmpp:cxfr';
/*
  <iq xmlns="jabber:client" id="<someId>" to="<toJID>" type="set">
    <query xmlns="urn:xmpp:cxfr">
      <domain>jabber.org</domain>
      <server>123.123.123.122</server>
    </query>
  </iq>
*/
exports.connectionTransfer = {
    path: 'iq.query',
    aliases: ['iq.connectionTransfer'],
    namespace: NS_CONNECTION_TRANSFER,
    element: 'query',
    fields: {
        domain: (0, jxt_1.childText)(null, 'domain'),
        server: (0, jxt_1.childText)(null, 'server')
    }
};
