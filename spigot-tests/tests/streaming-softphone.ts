import { Client } from '../../dist/npm/client';

import * as utils from './utils/test-utils';
import { GenesysCloudMediaSession } from '../../dist/npm/types/media-session';

const config = utils.getConfig();

let client: Client;
// let cpSubscription;
let activeCall;

describe('Softphone Via Streaming Client [svso]', function () {
  before(async function () {
    this.timeout(config.validationTimeout * 10);

    (window as any).client = client = utils.createConnection(utils.getAuthToken());
    await client.connect();

    const iceServers = await client.webrtcSessions.refreshIceServers();
    if (!iceServers.length) {
      throw new Error('No ICE Servers received');
    }

    console.log('Streaming client connected', client);
  });

  beforeEach(function () {
    // cpSubscription = utils.carrierPigeonMessages.subscribe((message) => {
    //   // console.log('handling message', message);
    // });
  });

  afterEach(function () {
    // cpSubscription.unsubscribe();
    client.webrtcSessions.removeAllListeners();
    if (activeCall) {
      return utils.disconnectCall(activeCall);
    }
  });

  after(() => {
    return utils.disconnectClient(client);
  });

  async function testCall (phoneNumber) {
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
        console.info('Received Propose', options);
        client.webrtcSessions.acceptRtcSession(options.sessionId);
      });

      // Resolve when the session arrives, short circuiting the timeout/reject
      client.webrtcSessions.on('incomingRtcSession', (session) => {
        console.log('Pending Session received', { session });
        resolve(session);
      });
    });

    // Make the call
    const conversationId = await utils.makeCall({ phoneNumber });
    console.info('Call conversationId', conversationId);

    // wait for the session to arrive
    const session = await incomingRtcSession;
    // session.on('log:*', (evt, ...args) => {
    //   const level = evt.split(':')[1];
    //   console[level]('session log', ...args);
    // });

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
    await utils.validateStream(session, remoteStream, activeCall);
    activeCall = null;
  }

  it('can connect to voicemail [streaming-softphone]', async function () {
    await testCall.call(this, '*86');
  });

  it('can connect a call [streaming-softphone]', async function () {
    await testCall.call(this, config.outboundNumber);
  });

  it('can connect mulitple calls [streaming-softphone]', async function () {
    await testCall.call(this, config.outboundNumber);
    await testCall.call(this, config.outboundNumber);
    await testCall.call(this, config.outboundNumber);
    await testCall.call(this, config.outboundNumber);
    await testCall.call(this, config.outboundNumber);
    await testCall.call(this, config.outboundNumber);
    await testCall.call(this, config.outboundNumber);
    await testCall.call(this, config.outboundNumber);
  });

  const relayOnlyCallsToRun = 1;
  for (let i = 0; i < relayOnlyCallsToRun; i++) {
    it('can connect a call with relay-only streaming-relay-only', async function () {
      this.timeout(config.validationTimeout * 10);
      await new Promise((resolve, reject) => {
        utils.rejectTimeout(reject, 'refreshIceServers to respond', config.validationTimeout * 4);
        client.webrtcSessions.refreshIceServers().then(resolve);
      });
      client._webrtcSessions.config.iceTransportPolicy = 'relay';
      await testCall.call(this, config.outboundNumber);
      client._webrtcSessions.config.iceTransportPolicy = 'all';
    });
  }
});
