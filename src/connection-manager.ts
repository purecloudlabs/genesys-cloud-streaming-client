// so the idea here is any time stanza gets disconnected, we are effectively going to kill that instance of
// stanza and never reuse it. We may reuse the config for a given stanza client, but every connection attempt
// will merit its own brand new client. The purpose of this is because the stanza.connect() is not transactional
// and failed connection attempts trigger `disconnect` events either by timeout or some actual error. This is
// a problem because it effectively means we can get multiple disconnect events for a single connection attempt
// which makes trying to reconnect a stanza instance an tricky endeavor because we don't know if a disconnect
// event applies to a past connection attempt or if it applies to the most recent connection attempt. For this
// reason, we want a vanilla instance of stanza every time we call `connect` so wires don't get crossed.

import Logger from 'genesys-cloud-client-logger';
import { AgentConfig, createClient } from 'stanza';
import { SASL } from 'stanza/protocol';
import { v4 } from 'uuid';
import { IClientConfig } from './types/interfaces';
import { NamedAgent } from './types/named-agent';
import SaslError from './types/sasl-error';
import { parseJwt, timeoutPromise } from './utils';

export class ConnectionManager {
  constructor (private logger: Logger, private config: IClientConfig) {}

  setConfig (config: IClientConfig) {
    this.config = config;
  }

  async getNewStanzaConnection (): Promise<NamedAgent> {
    const options = this.getStanzaOptions();
    const stanza = createClient({}) as unknown as NamedAgent;

    // this is a hack because stanza messes up the auth mechanism priority.
    (stanza.sasl as any).mechanisms.find(mech => mech.name === 'ANONYMOUS').priority = 0;
    (stanza.sasl as any).mechanisms = (stanza.sasl as any).mechanisms.sort((a, b) => b.priority - a.priority);

    // we are going to give the stanza instance an id for tracking and logging purposes
    stanza.id = v4();
    const channelId = stanza.channelId = this.config.channelId;

    let boundCheckForErrorStanza: (rawString: string) => void;
    let boundSessionStarted: () => void;
    let boundSessionSasl: (err: any) => void;
    let boundSessionDisconnected: () => void;

    const connectionAttemptPromise = timeoutPromise((resolve, reject) => {
      boundCheckForErrorStanza = this.checkForErrorStanza.bind(this, stanza);
      stanza.on('raw:incoming', boundCheckForErrorStanza);

      boundSessionStarted = this.handleSessionStarted.bind(this, stanza, resolve);
      stanza.on('session:started', boundSessionStarted);

      boundSessionSasl = this.handleSessionSasl.bind(this, stanza, reject);
      stanza.on('sasl', boundSessionSasl);

      boundSessionDisconnected = this.handleSessionDisconnected.bind(this, stanza, reject);
      stanza.on('disconnected', boundSessionDisconnected);

      stanza.updateConfig(options);
      stanza.connect();
    }, 15 * 1000, 'connecting to streaming service', { channelId, stanzaInstanceId: stanza.id });

    connectionAttemptPromise.catch(() => stanza.disconnect());

    return connectionAttemptPromise.finally(() => {
      stanza.off('raw:incoming', boundCheckForErrorStanza);
      stanza.off('session:started', boundSessionStarted);
      stanza.off('sasl', boundSessionSasl);
      stanza.off('disconnected', boundSessionDisconnected);
    });
  }

  private handleSessionStarted (stanza: NamedAgent, resolve: (instance: NamedAgent) => void): void {
    this.logger.info('new stanza instance connected', { stanzaInstanceId: stanza.id, channelId: stanza.channelId });
    resolve(stanza);
  }

  private handleSessionSasl (stanza: NamedAgent, reject: (err: any) => void, sasl: SASL): void {
    if (sasl.type === 'failure') {
      reject(new SaslError(sasl.condition, stanza.channelId as string, stanza.id));
    }
  }

  private handleSessionDisconnected (stanza: NamedAgent, reject: () => void): void {
    this.logger.error('stanza disconnected', { stanzaInstanceId: stanza.id, channelId: stanza.channelId });
    reject();
  }

  private checkForErrorStanza (stanza: NamedAgent, rawStanza: string): void {
    if (rawStanza.includes('error')) {
      this.logger.error('Received a stanza during setup that tripped the error filter', { rawStanza, stanzaInstanceId: stanza.id, channelId: stanza.channelId });
    }
  }

  private getStanzaOptions (): AgentConfig {
    if (this.config.jwt) {
      return this.getJwtOptions();
    }

    return this.getStandardOptions();
  }

  private getJwtOptions (): AgentConfig {
    const config = this.config;
    const jwt = parseJwt(config.jwt!);
    let jidDomain: string;
    try {
      jidDomain = jwt.data.jid.split('@')[1].replace('conference.', '');
    } catch (e) {
      throw new Error('failed to parse jid');
    }
    let wsHost = config.host.replace(/\/$/, '');
    return {
      resource: config.jidResource,
      transports: {
        websocket: `${wsHost}/stream/jwt/${config.jwt}`
      },
      server: jidDomain
    };
  }

  private getStandardOptions (): AgentConfig {
    const config = this.config;
    let wsHost = config.host.replace(/\/$/, '');
    return {
      jid: config.jid,
      resource: config.jidResource,
      credentials: {
        username: config.jid,
        password: `authKey:${config.authToken}`
      },
      transports: {
        websocket: `${wsHost}/stream/channels/${config.channelId}`
      }
    };
  }
}
