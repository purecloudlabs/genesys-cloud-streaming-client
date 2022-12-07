import { SASLFailureCondition } from 'stanza/Constants';

export default class SaslError extends Error {
  name = 'SaslError';

  constructor (public condition: SASLFailureCondition, public channelId: string, public stanzaInstanceId: string) {
    super();
  }
}
