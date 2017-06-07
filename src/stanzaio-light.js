'use strict';

exports.JID = require('xmpp-jid').JID;
exports.Client = require('stanza.io/lib/client');

exports.createClient = function (opts) {
  var client = new exports.Client(opts);
  [
    require('stanza.io/lib/plugins/disco'), // must be first

        // TODO: figure out which of these we don't need.
    require('stanza.io/lib/plugins/attention'),
    require('stanza.io/lib/plugins/avatar'),
    require('stanza.io/lib/plugins/blocking'),
    require('stanza.io/lib/plugins/bob'),
    require('stanza.io/lib/plugins/bookmarks'),
    require('stanza.io/lib/plugins/carbons'),
    require('stanza.io/lib/plugins/chatstates'),
    require('stanza.io/lib/plugins/correction'),
    require('stanza.io/lib/plugins/csi'),
    require('stanza.io/lib/plugins/dataforms'),
    require('stanza.io/lib/plugins/delayed'),
    require('stanza.io/lib/plugins/escaping'),
    require('stanza.io/lib/plugins/extdisco'),
    require('stanza.io/lib/plugins/forwarding'),
    require('stanza.io/lib/plugins/geoloc'),
    require('stanza.io/lib/plugins/hashes'),
    require('stanza.io/lib/plugins/idle'),
    require('stanza.io/lib/plugins/invisible'),
    require('stanza.io/lib/plugins/jidprep'),
    require('stanza.io/lib/plugins/json'),
    require('stanza.io/lib/plugins/keepalive'),
    require('stanza.io/lib/plugins/logging'),
    require('stanza.io/lib/plugins/mam'),
    require('stanza.io/lib/plugins/muc'),
    require('stanza.io/lib/plugins/mood'),
    require('stanza.io/lib/plugins/nick'),
    require('stanza.io/lib/plugins/oob'),
    require('stanza.io/lib/plugins/ping'),
    require('stanza.io/lib/plugins/private'),
    require('stanza.io/lib/plugins/psa'),
    require('stanza.io/lib/plugins/pubsub'),
    require('stanza.io/lib/plugins/reach'),
    require('stanza.io/lib/plugins/receipts'),
    require('stanza.io/lib/plugins/register'),
    require('stanza.io/lib/plugins/roster'),
    require('stanza.io/lib/plugins/rtt'),
    require('stanza.io/lib/plugins/shim'),
    require('stanza.io/lib/plugins/time'),
    require('stanza.io/lib/plugins/vcard'),
    require('stanza.io/lib/plugins/version')
  ].map(client.use.bind(client));

  return client;
};
