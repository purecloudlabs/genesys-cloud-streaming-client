import axios from 'axios';
import { AlertableInteractionTypes, IClientOptions, RequestApiOptions, StreamingClientExtension, StreamingClientErrorTypes } from './types/interfaces';
import { Client } from './client';
import { EventEmitter } from 'events';
import { NamedAgent } from './types/named-agent';
import { StreamingClientError, retryPromise } from './utils';

export class AlertingLeaderExtension extends EventEmitter implements StreamingClientExtension {
  private connectionId?: string;
  private alertableInteractionTypes: AlertableInteractionTypes[];
  private currentLeaderConnectionId?: string;
  private abortController?: AbortController;

  constructor (private client: Client, options: IClientOptions) {
    super();

    this.alertableInteractionTypes = options.alertableInteractionTypes ?? [];
  }

  handleStanzaInstanceChange (stanzaInstance: NamedAgent) {
    this.connectionId = stanzaInstance.transport?.stream?.id;

    this.setupAlertingLeader();
  }

  private async setupAlertingLeader () {
    if (this.alertableInteractionTypes.length !== 0) {
      try {
        await this.subscribeToAlertingLeader();
        await this.markAsAlertable();
        await this.getAlertingLeader();
      } catch (err) {
        // Fail 'open' so users don't miss calls
        this.emit('alertingLeaderChanged', { voice: { alerting: true, configured: false } });
      }
    }
  }

  private async subscribeToAlertingLeader (): Promise<any> {
    const topic = `v2.users.${this.client.config.userId}.alertingleader`;
    this.client.on(`notify:${topic}`, (event) => {
      this.abortController?.abort();

      if (event.connectionId) {
        this.currentLeaderConnectionId = event.connectionId;
        const shouldAlert = this.currentLeaderConnectionId === this.connectionId;
        const payload = {
          voice: {
            alerting: shouldAlert,
            configured: true
          }
        };
        this.emit('alertingLeaderChanged', payload);
      }
    });
    return this.client._notifications._subscribeInternal(topic);
  }

  private async markAsAlertable (): Promise<any> {
    const userId = this.client.config.userId;
    const connectionsRequestOptions: RequestApiOptions = {
      method: 'patch',
      host: this.client.config.apiHost,
      authToken: this.client.config.authToken,
      logger: this.client.logger,
      data: {
        alertable: true
      }
    };

    // STREAM-1204
    // There's a race condition between the backend service knowing about the connection
    // and us marking the connection as alertable. For now, we'll just retry with some delay.
    const maxRetries = 16;
    let retryCount = 0;
    const retry = retryPromise(
      () => this.client.http.requestApi(`apps/users/${userId}/connections/${this.connectionId}`, connectionsRequestOptions),
      () => {
        retryCount++;
        if (retryCount >= maxRetries) {
          this.client.logger.info('Max retries reached for marking connection as alertable');
          return false;
        }
        return true;
      },
      500,
      this.client.logger
    );

    return retry.promise
      .catch(() => {
        this.client.logger.warn('Could not mark this connection as alertable; this client may not alert for incoming interactions');
      });
  }

  private async getAlertingLeader (): Promise<void> {
    this.abortController = new AbortController();
    const leaderRequestOptions: RequestApiOptions = {
      method: 'get',
      host: this.client.config.apiHost,
      authToken: this.client.config.authToken,
      logger: this.client.logger,
      signal: this.abortController.signal
    };

    try {
      const currentLeader = await this.client.http.requestApi('users/alertingleader', leaderRequestOptions);
      this.currentLeaderConnectionId = currentLeader.data.connectionId;
      const shouldAlert = this.currentLeaderConnectionId === this.connectionId;

      this.emit('alertingLeaderChanged', { voice: { alerting: shouldAlert, configured: true } });
    } catch (err) {
      if (axios.isCancel(err)) {
        return;
      }

      throw err;
    }
  }

  private async claimAlertingLeader (): Promise<void> {
    if (this.alertableInteractionTypes.length === 0) {
      this.client.logger.info('This client is not configured for any alertable interactions and will not attempt to claim alerting leader');

      throw new StreamingClientError(StreamingClientErrorTypes.generic, 'Unable to claim alerting leader; this client is not configured for any alertable interactions');
    }

    const leaderRequestOptions: RequestApiOptions = {
      method: 'put',
      host: this.client.config.apiHost,
      authToken: this.client.config.authToken,
      logger: this.client.logger,
      data: {
        connectionId: this.connectionId
      }
    };

    return this.client.http.requestApi('users/alertingleader', leaderRequestOptions)
      .catch((err) => {
        this.client.logger.warn('Unable to claim alerting leader; this client may not alert for incoming interactions');

        throw new StreamingClientError(StreamingClientErrorTypes.generic, 'Unable to claim alerting leader', err);
      });
  }

  currentLeader (): any {
    return {
      voice: {
        alerting: this.currentLeaderConnectionId === this.connectionId
      }
    };
  }

  get expose (): AlertingLeaderApi {
    return {
      claimAlertingLeader: this.claimAlertingLeader.bind(this),
      currentLeader: this.currentLeader.bind(this)
    };
  }
}

export interface AlertingLeaderApi {
  claimAlertingLeader (): Promise<void>;
  currentLeader (): any;
}
