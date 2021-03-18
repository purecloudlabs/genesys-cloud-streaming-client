import { assert } from 'chai';
import { filter, first, timeoutWith } from 'rxjs/operators';

import { Client } from '../../dist/npm/client';
import * as utils from './utils/test-utils';
import { GenesysCloudMediaSession } from '../../dist/npm/types/media-session';

const config = utils.getConfig();

let client: Client;
let activeCall;

describe('Streaming Pubsub (Softphone via Streaming) [spsvs] [stable]', function () {
  before(async function () {
    (window as any).client = client = utils.createConnection(utils.getAuthToken());
    await client.connect();

    const iceServers = await client.webrtcSessions.refreshIceServers();
    if (!iceServers.length) {
      throw new Error('No ICE Servers received');
    }
  });

  afterEach(async function () {
    client.webrtcSessions.removeAllListeners();
    if (activeCall) {
      await utils.disconnectCall(activeCall);
      activeCall = null;
    }
  });

  after(function () {
    return utils.disconnectClient(client);
  });

  async function testCall (phoneNumber: string, opts: { timeout?: number, reconnectStreaming?: boolean, hardReconnect?: boolean, isVoicemail?: boolean } = {}) {
    // Yes, this timeout is long, but it's because we're making a real call
    if (opts.timeout) {
      this.timeout(opts.timeout);
    } else if (config.callDelay) {
      this.timeout(config.callDelay + 2000);
    } else {
      this.timeout(20000);
    }

    // pre-request media
    const mediaStream = await utils.getUserMedia();
    // Convert incomingRtcSession event into promise so we can await it
    const incomingRtcSession = new Promise<GenesysCloudMediaSession>((resolve, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for incoming session')), config.validationTimeout);

      // As soon as a call is requested, accept the propose
      client.webrtcSessions.once('requestIncomingRtcSession', async function (options) {
        client.webrtcSessions.acceptRtcSession(options.sessionId);
      });

      // Resolve when the session arrives, short circuiting the timeout/reject
      client.webrtcSessions.once('incomingRtcSession', (session) => {
        console.log('Pending Session received', { session });
        resolve(session);
      });
    });

    const context = utils.getContext();
    const subscription = utils.setupStreamingPubsub(`v2.users.${context.user.id}.conversations`, client);
    const pubsubEvent1 = subscription
      .pipe(
        filter((message) => {
          const hasParticipant = !!(message && message.participants && message.participants.length === 1);
          console.debug('checking streaming client pubsub message has participant: ' + hasParticipant);
          return hasParticipant;
        }),
        first(),
        timeoutWith(config.validationTimeout, utils.observableError('Timeout waiting for conversation alerting event on streaming client'))
      )
      .toPromise();

    const pubsubEvent2 = subscription
      .pipe(
        filter(message => {
          console.debug('checking streaming client pubsub message', message);
          return !!(message && message.participants && message.participants.length === 2);
        }),
        first(),
        timeoutWith(config.validationTimeout, utils.observableError('Timeout waiting for conversation connected event on carrier pigeon'))
      )
      .toPromise();

    const pubsubEvent3 = subscription
      .pipe(
        filter(message => {
          console.debug('checking streaming client pubsub message', message);
          return !!(
            message && message.participants &&
            message.participants.length > 1 &&
            message.participants
              .filter(p => p.calls && p.calls.length && (p.calls[0].state === 'disconnected' || p.calls[0].state === 'terminated')).length > 1
          );
        }),
        first(),
        timeoutWith(opts.timeout || config.validationTimeout, utils.observableError('Timeout waiting for conversation disconnect event on streaming client'))
      )
      .toPromise();

    // Make the call
    const conversationId = await utils.makeCall({ phoneNumber });
    console.info('Call conversationId', conversationId);

    // wait for the session to arrive
    const session = await incomingRtcSession;
    (window as any).session = session;

    await pubsubEvent1;
    console.log('received streaming pubsub event for connect');

    // convert peerTrackAdded event to promise
    const peerTrackAdded = new Promise<MediaStream>((resolve, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for remote stream')), config.validationTimeout);
      if (session.streams.length === 1 && session.streams[0].getAudioTracks().length > 0) {
        return resolve(session.streams[0]);
      }
      session.on('peerTrackAdded', async (track, stream) => {
        resolve(stream);
      });
    });

    // add the local stream and accept
    session.pc.addTrack(mediaStream.getAudioTracks()[0]);
    await session.accept();
    session.on('terminated', () => {
      console.log('session is ending', session);
    });
    activeCall = conversationId;
    const remoteStream = await peerTrackAdded;

    console.log('received streaming pubsub event for connect', await pubsubEvent2);

    await utils.validateStream(session, remoteStream, undefined, undefined, undefined, undefined);

    if (opts.reconnectStreaming) {
      const streamingClients: Client[] = [];
      if (opts.hardReconnect) {
        console.log('Triggering a hard reconnect on streaming client by creating 21 new channels');
        const token = utils.getAuthToken();

        // we have to create and connect 20+ streaming connections to trip `no_longer_subscribed` on the original connection
        for (let i = 0; i < 21; i++) {
          try {
            const subClient = await utils.getConnectedStreamingClient(token);
            streamingClients.push(subClient);
          } catch (error) {
            console.warn(error, { streamingConnectionCount: i + 1 });
          }
          // await utils.fetchJson(`${config.apiUrl}/notifications/channels`, options);
        }
        await Promise.all(streamingClients.map(c => c.disconnect()));
      }
      console.log('Triggering reconnect on streaming client');
      const reconnected = new Promise((resolve, reject) => {
        utils.rejectTimeout(reject, 'the streaming client to reconnect', config.validationTimeout);
        client.on('connected', resolve);
      });
      client.reconnect();
      await reconnected;
    }

    // hardReconnect takes so long, the call ends before we can validate the stream again
    if (!opts.hardReconnect) {
      await utils.validateStream(session, remoteStream, undefined, undefined, undefined, undefined);
    }

    console.log('disconnecting call');
    await utils.disconnectCall(activeCall);
    await pubsubEvent3;
  }

  it('can connect to voicemail (tc60055)', async function () {
    // Wait up to 25s for whole test to finish
    await testCall.call(this, '*86', { timeout: 25000, isVoicemail: true });
  });

  it('can connect a call (tc60056)', async function () {
    // Wait up to 25s for whole test to finish
    await testCall.call(this, config.outboundNumber, { timeout: 25000 });
  });

  it('can connect a call with disconnect [reconnect] (tc60057)', async function () {
    // Wait up to 50s for whole test to finish
    await testCall.call(this, config.outboundNumber, { timeout: 50000, reconnectStreaming: true });
  });

  it('can connect a call with major disconnect [hardreconnect]', async function () {
    // this has to have a long timeout since we need to create and connect 20+ channels
    await testCall.call(this, config.outboundNumber, { timeout: 200000, reconnectStreaming: true, hardReconnect: true });
  });

  it('can do combined user topics (note: fails on streaming client < 10.0.1)', async function () {
    await client.notifications.bulkSubscribe([], { replace: true, force: true });
    const subscriptionsPath = `${config.apiUrl}/notifications/channels/${client.config.channelId}/subscriptions`;
    const initialTopics = await utils.fetchJson(subscriptionsPath, { headers: utils.getHeaders() });
    assert.equal(initialTopics.entities.length, 0);

    const context = utils.getContext();
    const userId = context.user.id;
    const topicsToSubscribe = [
      'geolocation',
      'outofoffice',
      'routingStatus',
      'conversationsummary',
      'presence'
    ].map(t => `v2.users.${userId}.${t}`);
    assert.equal(topicsToSubscribe.length, 5);

    await client.notifications.bulkSubscribe(topicsToSubscribe, { replace: true, force: true });

    const newTopics = await utils.fetchJson(subscriptionsPath, { headers: utils.getHeaders() });

    // with combined topcis, even though we subscribed to 5, the API recognizes them as a single topic
    assert.equal(newTopics.entities.length, 1);
  });
});
