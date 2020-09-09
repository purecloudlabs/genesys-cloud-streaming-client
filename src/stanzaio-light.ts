import Disco from 'stanza/plugins/disco';
import Pubsub from 'stanza/plugins/pubsub';
import Jingle from 'stanza/plugins/jingle';

import { createClient as createStanzaClient, Agent } from 'stanza';

// HACK: for some reason, in production builds of angular, the imports for these plugins are getting messed.
// A lot of time has been sunk into figuring out why/how to fix it properly, but to no avail. This is a
// harmless hack that works around the issue.
export function getActualFunction (dep) {
  if (dep.default) {
    return dep.default;
  }

  return dep;
}

export function createClient (opts): Agent {
  const client = createStanzaClient(opts);
  [
    Disco, // must be first
    Jingle,
    Pubsub
  ].map(plugin => client.use(getActualFunction(plugin)));

  return client;
}
