import Disco from 'stanza/plugins/disco';
import Extdisco from 'stanza/plugins/extdisco';
import Logging from 'stanza/plugins/logging';
import Pubsub from 'stanza/plugins/pubsub';
import Ping from 'stanza/plugins/ping';
import fetch from 'whatwg-fetch/fetch'; // eslint-disable-line
import { Client } from 'stanza/browser-module';

export { JID } from 'xmpp-jid';
export { Client } from 'stanza/browser-module';

// HACK: for some reason, in production builds of angular, the imports for these plugins are getting messed.
// A lot of time has been sunk into figuring out why/how to fix it properly, but to no avail. This is a
// harmless hack that works around the issue.
function getActualFunction (dep) {
  if (dep.default) {
    return dep.default;
  }

  return dep;
}

export function createClient (opts) {
  var client = new Client(opts);
  [
    Disco, // must be first

    Extdisco,
    Logging,
    Pubsub,
    Ping
  ].map(plugin => client.use(getActualFunction(plugin)));

  return client;
}
