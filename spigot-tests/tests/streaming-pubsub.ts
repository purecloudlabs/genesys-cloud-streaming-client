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

  afterEach(function () {
    client.webrtcSessions.removeAllListeners();
    if (activeCall) {
      return utils.disconnectCall(activeCall);
    }
  });

  after(() => {
    return utils.disconnectClient(client);
  });

  async function testCall (phoneNumber: string, opts: any = {}) {
    // Yes, this timeout is long, but it's because we're making a real call
    if (config.callDelay) {
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
      client.webrtcSessions.on('requestIncomingRtcSession', async function (options) {
        client.webrtcSessions.acceptRtcSession(options.sessionId);
      });

      // Resolve when the session arrives, short circuiting the timeout/reject
      client.webrtcSessions.on('incomingRtcSession', (session) => {
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

    const pubsubEvent2 = await subscription
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
        timeoutWith(config.validationTimeout, utils.observableError('Timeout waiting for conversation disconnect event on streaming client'))
      )
      .toPromise();

    // Make the call
    const conversationId = await utils.makeCall({ phoneNumber });
    console.info('Call conversationId', conversationId);

    // wait for the session to arrive
    const session = await incomingRtcSession;

    await pubsubEvent1;
    console.log('received streaming pubsub event for connect');

    // convert peerStreamAdded event to promise
    const peerStreamAdded = new Promise<MediaStream>((resolve, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for remote stream')), config.validationTimeout);
      if (session.streams.length === 1 && session.streams[0].getAudioTracks().length > 0) {
        return resolve(session.streams[0]);
      }
      session.on('peerTrackAdded', async (track, stream) => {
        resolve(stream);
      });
    });

    // add the local stream and accept
    session.addTrack(mediaStream.getAudioTracks()[0]);
    session.accept();
    activeCall = conversationId;
    const remoteStream = await peerStreamAdded;


    console.log('received streaming pubsub event for connect', pubsubEvent2);

    if (opts.reconnectStreaming) {
      if (opts.hardReconnect) {
        console.log('Triggering a hard reconnect on streaming client by creating 11 new channels');
        const options = {
          method: 'POST',
          mode: 'cors',
          body: JSON.stringify({}),
          headers: utils.getHeaders()
        } as RequestInit;
        for (let i = 0; i < 11; i++) {
          await utils.fetchJson(`${config.apiUrl}/notifications/channels`, options);
        }
        await utils.timeout(config.validationTimeout);
      }
      console.log('Triggering reconnect on streaming client');
      const reconnected = new Promise((resolve, reject) => {
        utils.rejectTimeout(reject, 'the streaming client to reconnect', config.validationTimeout);
        client.on('connected', resolve);
      });
      client.reconnect();
      await reconnected;
    }
    await utils.validateStream(session, remoteStream, activeCall, undefined, undefined, undefined);

    console.log('disconnecting call');
    utils.disconnectCall(activeCall);
    activeCall = null;
    await pubsubEvent3;
  }

  it('can connect to voicemail (tc60055)', async function () {
    this.timeout(25000); // Wait up to 25s for whole test to finish
    await testCall.call(this, '*86', { isVoicemail: true });
  });

  it('can connect a call (tc60056)', async function () {
    this.timeout(25000); // Wait up to 25s for whole test to finish
    await testCall.call(this, config.outboundNumber);
  });

  it('can connect a call with disconnect [reconnect] (tc60057)', async function () {
    this.timeout(25000); // Wait up to 25s for whole test to finish
    await testCall.call(this, config.outboundNumber, { reconnectStreaming: true });
  });

  it('can connect a call with major disconnect [hardreconnect]', async function () {
    this.timeout(25000);
    await testCall.call(this, config.outboundNumber, { reconnectStreaming: true, hardReconnect: true });
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
