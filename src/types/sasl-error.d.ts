import { SASLFailureCondition } from 'stanza/Constants';
export default class SaslError extends Error {
    condition: SASLFailureCondition;
    channelId: string;
    stanzaInstanceId: string;
    name: string;
    constructor(condition: SASLFailureCondition, channelId: string, stanzaInstanceId: string);
}
