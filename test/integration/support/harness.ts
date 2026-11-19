/* eslint @typescript-eslint/no-explicit-any: "off" */
import axios from 'axios';
import { Client } from '../../../src/client';
import { MockApiServer } from './mock-api-server';
import { xmpp } from './fake-xmpp';

/**
 * Shared black-box harness for streaming client integration tests.
 *
 * The client is a browser library, so it needs jsdom's `window`. jsdom's XHR
 * cannot reach a real socket, so we keep jsdom and force axios onto its node
 * `http` adapter for the suite. Do NOT use `@jest-environment node`.
 *
 * Call `installHttpMockServer()` inside a `describe`. It registers the
 * beforeAll/afterAll/afterEach lifecycle and returns the server.
 */
export function installHttpMockServer (): MockApiServer {
  const api = new MockApiServer();
  let prevAdapter: any;

  beforeAll(async () => {
    await api.start();
    prevAdapter = axios.defaults.adapter;
    axios.defaults.adapter = 'http';
  });

  afterAll(async () => {
    axios.defaults.adapter = prevAdapter;
    await api.stop();
  });

  afterEach(() => {
    api.reset();
    xmpp.reset();
  });

  return api;
}

export const silentLogger: any = {
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn()
};

/** Unique id per call, so tests never share fixtures. */
export const uid = (prefix: string): string => `${prefix}-${globalThis.crypto.randomUUID()}`;

export interface SeededUser {
  userId: string;
  jid: string;
  channelId: string;
  authToken: string;
}

/** Stub the two platform calls every non-JWT connect makes: `users/me` and channel creation. */
export function seedConnect (api: MockApiServer): SeededUser {
  const seeded: SeededUser = {
    userId: uid('user'),
    jid: `${uid('jid')}@example.orgspan.com`,
    channelId: uid('channel'),
    authToken: uid('token')
  };

  api
    .stub('get', /\/api\/v2\/users\/me$/, { status: 200, body: { id: seeded.userId, chat: { jabberId: seeded.jid } } })
    .stub('post', /\/api\/v2\/notifications\/channels$/, { status: 200, body: { id: seeded.channelId } });

  return seeded;
}

/** Build a real streaming client pointed at the mock server. */
export function buildClient (api: MockApiServer, authToken: string, overrides: Record<string, any> = {}): Client {
  return new Client({
    host: 'wss://streaming.example.com',
    apiHost: api.baseUrl,
    authToken,
    logger: silentLogger,
    optOutOfWebrtcStatsTelemetry: true,
    ...overrides
  } as any);
}

/** Resolve on the next emit of `event`. */
export const once = <T = any>(emitter: { once: (e: string, cb: (...a: any[]) => void) => any }, event: string): Promise<T> =>
  new Promise(resolve => emitter.once(event, resolve));
