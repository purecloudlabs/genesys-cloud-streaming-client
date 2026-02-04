import { IAlertableInteractions, IClientOptions, RequestApiOptions, StreamingClientExtension } from './types/interfaces';
import { Client } from './client';
import { NamedAgent } from './types/named-agent';

export class AlertingLeaderExtension implements StreamingClientExtension {
  private connectionId?: string;
  private alertableInteractions?: IAlertableInteractions;

  constructor (private client: Client, options: IClientOptions) {
    this.alertableInteractions = options.alertableInteractions;
  }

  handleStanzaInstanceChange (stanzaInstance: NamedAgent) {
    this.connectionId = stanzaInstance.transport?.stream?.id;

    if (this.alertableInteractions?.voice) {
      this.markAsAlertable();
    }
  }

  private markAsAlertable () {
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

    this.client.http.requestApi(`apps/users/${userId}/connections/${this.connectionId}`, connectionsRequestOptions)
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
