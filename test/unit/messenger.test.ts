import EventEmitter from "events";
import { Agent, createClient } from "stanza";
import { v4 } from "uuid";
import { HttpClient } from "../../src/http-client";
import { MediaMessageEvent, MessengerExtension } from "../../src/messenger";
import { NamedAgent } from "../../src/types/named-agent";

function getFakeStanzaClient (): NamedAgent {
  const instance = new EventEmitter();
  return Object.assign(
    instance,
    {
      config: {},
      id: v4(),
      jid: 'myuser@asdf.com/client1',
      send: jest.fn().mockResolvedValue(null),
    }
  ) as unknown as NamedAgent;
}

class Client extends EventEmitter {
  connected = false;
  logger = {
    debug () { },
    info () { },
    warn () { },
    error () { }
  };

  _stanzaio: Agent;
  http: HttpClient;

  constructor (public config: any) {
    super();
    this._stanzaio = createClient({});
    this.http = new HttpClient();
  }
}

describe('handleMessage', () => {
  it('should ignore message', () => {
    const client = new Client({});
    const messenger = new MessengerExtension(client as any, getFakeStanzaClient());

    const spy = messenger.emit = jest.fn();

    messenger.handleMessage({ id: 'lskdjf', to: 'myuser@asdf.com', propose: {} } as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it('should process message and recognize its from this client', () => {
    const client = new Client({});
    const messenger = new MessengerExtension(client as any, getFakeStanzaClient());

    const spy = messenger.emit = jest.fn();

    messenger.handleMessage({ id: 'lskdjf', to: 'myuser@asdf.com', from: 'myuser@asdf.com/client1', mediaMessage: {} } as any);
    expect(spy).toHaveBeenCalled();

    const event = spy.mock.calls[0][1] as MediaMessageEvent;
    expect(event.fromMyClient).toBeTruthy();
    expect(event.fromMyUser).toBeTruthy();
  });

  it('should process message and recognize its from this user but not this client', () => {
    const client = new Client({});
    const messenger = new MessengerExtension(client as any, getFakeStanzaClient());

    const spy = messenger.emit = jest.fn();

    messenger.handleMessage({ id: 'lskdjf', to: 'myuser@asdf.com', from: 'myuser@asdf.com/client2', mediaMessage: {} } as any);
    expect(spy).toHaveBeenCalled();

    const event = spy.mock.calls[0][1] as MediaMessageEvent;
    expect(event.fromMyClient).toBeFalsy();
    expect(event.fromMyUser).toBeTruthy();
  });
});

describe('handleStanzaInstanceChange', () => {
  it('should update the stanzaInstance', () => {
    const client = new Client({});
    const messenger = new MessengerExtension(client as any, getFakeStanzaClient());

    const newStanza = getFakeStanzaClient();
    messenger.handleStanzaInstanceChange(newStanza);

    expect(messenger['stanzaInstance']).toBe(newStanza);
  });
});

describe('broadcastMessage', () => {
  it('should add an id and send the message', async () => {
    const client = new Client({});
    const messenger = new MessengerExtension(client as any, getFakeStanzaClient());

    const id = await messenger.broadcastMessage({ to: 'to', from: 'from', mediaMessage: {
      jsonrpc: '2.0',
      method: 'headsetControlsChanged',
      params: {
        hasControls: true
      }
    }});

    const msgCall = (messenger['stanzaInstance'].send as jest.Mock).mock.calls[0][1];
    expect(id).toEqual(msgCall.id);
  });

  it('should add the "to" if not provided', async () => {
    const client = new Client({});
    const stanza = getFakeStanzaClient();
    const messenger = new MessengerExtension(client as any, stanza);

    stanza.jid = '123myjid@orgspan.com/resource';

    const id = await messenger.broadcastMessage({mediaMessage: {
      jsonrpc: '2.0',
      method: 'headsetControlsChanged',
      params: {
        hasControls: true
      }
    }});

    const msgCall = (messenger['stanzaInstance'].send as jest.Mock).mock.calls[0][1];
    expect(id).toEqual(msgCall.id);
    expect(msgCall.to).toEqual('123myjid@orgspan.com');
  });
});