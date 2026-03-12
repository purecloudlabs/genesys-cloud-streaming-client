import { AlertableInteractionTypes, IClientOptions, RequestApiOptions, StreamingClientExtension } from './types/interfaces';
import { Client } from './client';
import { NamedAgent } from './types/named-agent';
import { retryPromise } from './utils';

export class AlertingLeaderExtension implements StreamingClientExtension {
  private connectionId?: string;
  private alertableInteractionTypes: AlertableInteractionTypes[];

  constructor (private client: Client, options: IClientOptions) {
    this.alertableInteractionTypes = options.alertableInteractionTypes ?? [];
  }

  handleStanzaInstanceChange (stanzaInstance: NamedAgent) {
    this.connectionId = stanzaInstance.transport?.stream?.id;

    if (this.alertableInteractionTypes.length !== 0) {
      this.markAsAlertable();
    }
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

  get expose (): AlertingLeaderApi {
    return {
    };
  }
}

export interface AlertingLeaderApi {
}
