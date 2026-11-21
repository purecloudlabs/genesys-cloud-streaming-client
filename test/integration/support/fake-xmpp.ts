/* eslint @typescript-eslint/no-explicit-any: "off" */
import { EventEmitter } from 'events';

/**
 * Stands in for the websocket/XMPP peer, the second outward boundary of the
 * streaming client (the first is the platform HTTP API, see `mock-api-server`).
 *
 * `FakeStanza` replaces what `stanza.createClient()` returns. Everything in
 * streaming client above it runs for real: `Client`, `ConnectionManager`, the
 * extensions, `Ping`, `ServerMonitor`, `HttpClient`.
 *
 * Use it with:
 *   jest.mock('stanza', () => require('./support/fake-xmpp').stanzaModuleMock());
 */

export type ConnectBehavior = 'start-session' | 'sasl-failure' | 'never';

export const xmpp = {
  /** Every instance `createClient()` has returned, in order. */
  instances: [] as FakeStanza[],
  /** What `connect()` does on every new instance until reset. */
  connectBehavior: 'start-session' as ConnectBehavior,
  /** Condition reported when `connectBehavior` is `sasl-failure`. */
  saslCondition: 'not-authorized',

  reset (): void {
    this.instances = [];
    this.connectBehavior = 'start-session';
    this.saslCondition = 'not-authorized';
  },

  get last (): FakeStanza | undefined {
    return this.instances[this.instances.length - 1];
  }
};

export class FakeStanza extends EventEmitter {
  /** Config passed to `updateConfig()`: jid, credentials, websocket url. */
  config: any = {};
  connectCalls = 0;
  disconnectCalls = 0;
  pings: Array<string | undefined> = [];
  subscribedNodes: string[] = [];
  /** Unique id of this connection, as the server sees it (`transport.stream.id`). */
  connectionId = `connection-${globalThis.crypto.randomUUID()}`;
  transport = { stream: { id: this.connectionId } };
  /** The jingle (WebRTC signaling) plugin the webrtc extension configures. */
  jingle: any = Object.assign(new EventEmitter(), { config: { peerConnectionConfig: {}, iceServers: [] } });
  stanzas = { define: (_definitions: any) => undefined };
  /** `getServices(host, type)` calls, as `<type>`. */
  servicesRequested: string[] = [];
  sasl = {
    mechanisms: [{ name: 'ANONYMOUS', priority: 2 }, { name: 'PLAIN', priority: 3 }]
  };

  updateConfig (config: any): void {
    this.config = { ...this.config, ...config };
  }

  connect (): void {
    this.connectCalls++;
    const behavior = xmpp.connectBehavior;
    setTimeout(() => {
      if (behavior === 'start-session') {
        this.emit('connected');
        this.emit('session:started');
      } else if (behavior === 'sasl-failure') {
        this.emit('sasl', { type: 'failure', condition: xmpp.saslCondition });
      }
    }, 0);
  }

  async disconnect (): Promise<void> {
    this.disconnectCalls++;
    this.emit('disconnected');
  }

  async ping (jid?: string): Promise<void> {
    this.pings.push(jid);
  }

  async subscribeToNode (_host: string, node: string): Promise<any> {
    this.subscribedNodes.push(node);
    return { node };
  }

  async getServices (_host: string, type: string): Promise<any> {
    this.servicesRequested.push(type);
    return { services: [{ type, host: `${type}.example.com`, port: 3478, transport: 'udp' }] };
  }

  async unsubscribeFromNode (): Promise<any> {
    return {};
  }

  async sendIQ (): Promise<any> {
    return {};
  }

  sendMessage (): void { /* nothing to do */ }

  /** Simulate the server dropping the websocket. */
  serverDrops (): void {
    this.emit('disconnected');
  }

  /** Simulate a pubsub notification arriving from the server. */
  pushPubsub (topic: string, payload: any): void {
    this.emit('pubsub:event', {
      pubsub: {
        items: {
          node: topic,
          published: [{ content: { json: payload } }]
        }
      }
    });
  }
}

/** Factory for `jest.mock('stanza', ...)`. */
export function stanzaModuleMock (): any {
  const actual = jest.requireActual('stanza');
  return {
    ...actual,
    createClient: () => {
      const instance = new FakeStanza();
      xmpp.instances.push(instance);
      return instance;
    }
  };
}
