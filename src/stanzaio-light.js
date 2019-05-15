'use strict';

import { JID } from 'xmpp-jid';
import Client from 'stanza/client';
import Disco from 'stanza/plugins/disco';
import Extdisco from 'stanza/plugins/extdisco';
import Logging from 'stanza/plugins/logging';
import Pubsub from 'stanza/plugins/pubsub';
import Ping from 'stanza/plugins/ping';

exports.JID = JID;
exports.Client = Client;

exports.createClient = function (opts) {
  var client = new exports.Client(opts);
  [
    Disco, // must be first

    Extdisco,
    Logging,
    Pubsub,
    Ping
  ].map(client.use.bind(client));

  return client;
};
