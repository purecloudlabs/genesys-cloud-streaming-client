import axios from 'axios';
import { AlertableInteractionTypes, IAlertingStatus, IClientOptions, ILeaderStatus, RequestApiOptions, StreamingClientExtension, StreamingClientErrorTypes } from './types/interfaces';
import { Client } from './client';
import { EventEmitter } from 'events';
import { NamedAgent } from './types/named-agent';
import { StreamingClientError, retryPromise } from './utils';

export class AlertingLeaderExtension extends EventEmitter implements StreamingClientExtension {
  private connectionId?: string;
  private alertableInteractionTypes: AlertableInteractionTypes[];
  private getLeaderAbortController?: AbortController;
  private leaderStatus: ILeaderStatus = {};

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
        this.getAlertingLeaderEarly();
        await this.subscribeToAlertingLeader();
        this.client.logger.debug('setupAlertingLeader: Done subscribing to topi');
        await this.markAsAlertable();
        this.client.logger.debug('setupAlertingLeader: Done marking connection as alertable');
        await this.getAlertingLeader();
        this.client.logger.debug('setupAlertingLeader: Done getting current leader');
      } catch (err) {
        this.client.logger.warn('Failed to setup alerting leader; falling back to acting as the leader');
        // Fail 'open' so users don't miss calls
        this.client.logger.debug('setupAlertingLeader: Saving and emitting { voice: { alerting: true, configured: false } }');
        this.leaderStatus = { voice: { alerting: true, configured: false } };
        this.emit('alertingLeaderChanged', this.leaderStatus);
      }
    }
  }

  private async subscribeToAlertingLeader (): Promise<any> {
    const topic = `v2.users.${this.client.config.userId}.alertingleader`;
    this.client.on(`notify:${topic}`, (event) => {
      this.getLeaderAbortController?.abort();

      if (event.eventBody?.connectionId) {
        // The consuming client should be the one alerting if our connection is the current leader
        const alerting: boolean = event.eventBody.connectionId === this.connectionId;
        const clientType = event.eventBody.clientType;
        let voice: IAlertingStatus = { alerting, configured: true };
        if (clientType) {
          voice = { ...voice, clientType };
        }
        const message = 'subscribeToAlertingLeader event: Event connection ID: ' + event.eventBody?.connectionId ?? 'N/A';
        this.client.logger.debug(message);
        this.client.logger.debug('subscribeToAlertingLeader event: Saving and emitting { voice: { alerting: ' + alerting + ', configured: true } }');
        this.leaderStatus = { voice };
        this.emit('alertingLeaderChanged', this.leaderStatus);
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
        this.client.logger.warn('Could not mark this connection as alertable');
      });
  }

  private async getAlertingLeaderEarly (): Promise<void> {
    try {
      await this.getAlertingLeader();
    } catch (error) {
      if (axios.isAxiosError(error) && error.status === 400) {
        this.client.logger.info('The org has not configured alerting leader functionality or there are not yet any active alertable connections; falling back to acting as the leader');
        this.client.logger.debug('getAlertingLeaderEarly: Saving and emitting { voice: { alerting: true, configured: false } }');
        this.leaderStatus = { voice: { alerting: true, configured: false } };
        this.emit('alertingLeaderChanged', this.leaderStatus);
      }
    }
  }

  private async getAlertingLeader (): Promise<void> {
    // If an early request is still in-flight, cancel it and get more recent data
    this.getLeaderAbortController?.abort();
    this.getLeaderAbortController = new AbortController();
    const leaderRequestOptions: RequestApiOptions = {
      method: 'get',
      host: this.client.config.apiHost,
      authToken: this.client.config.authToken,
      logger: this.client.logger,
      signal: this.getLeaderAbortController.signal
    };

    try {
      const currentLeader = await this.client.http.requestApiWithRetry('users/alertingleader', leaderRequestOptions, 1000).promise;
      // The consuming client should be the one alerting if our connection is the current leader
      const alerting: boolean = currentLeader.data.connectionId === this.connectionId;
      const clientType = currentLeader.data.clientType;
      let voice: IAlertingStatus = { alerting, configured: true };
      if (clientType) {
        voice = { ...voice, clientType };
      }
      const message = 'getAlertingLeader: Event connection ID: ' + currentLeader.data?.connectionId ?? 'N/A';
      this.client.logger.debug(message);
      this.client.logger.debug('getAlertingLeader: Saving and emitting { voice: { alerting: ' + alerting + ', configured: true } }');
      this.leaderStatus = { voice };
      this.emit('alertingLeaderChanged', this.leaderStatus);
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

  get expose (): AlertingLeaderApi {
    return {
      on: this.on.bind(this),
      off: this.off.bind(this),
      claimAlertingLeader: this.claimAlertingLeader.bind(this),
      getLeaderStatus: () => { return this.leaderStatus; },
      leaderStatus: this.leaderStatus
    };
  }
}

export interface AlertingLeaderApi {
  on: (event: string, handler: (...args: any) => void) => void;
  off: (event: string, handler: (...args: any) => void) => void;
  claimAlertingLeader (): Promise<void>;
  getLeaderStatus (): ILeaderStatus;

  /* @deprecated Use {@link getLeaderStatus} */
  leaderStatus: ILeaderStatus;
}
