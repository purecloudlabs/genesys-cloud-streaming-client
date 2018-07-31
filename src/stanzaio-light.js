'use strict';

import { JID } from 'xmpp-jid';
import Client from 'stanza.io/lib/client';

exports.JID = JID;
exports.Client = Client;

exports.createClient = function (opts) {
  var client = new exports.Client(opts);
  [
    require('stanza.io/lib/plugins/disco'), // must be first

    // TODO: figure out which of these we don't need.
    require('stanza.io/lib/plugins/extdisco'),
    require('stanza.io/lib/plugins/hashes'),
    require('stanza.io/lib/plugins/json'),
    require('stanza.io/lib/plugins/logging'),
    require('stanza.io/lib/plugins/ping'),
    require('stanza.io/lib/plugins/pubsub')
  ].map(client.use.bind(client));

  return client;
};
