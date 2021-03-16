import { Client } from '../../dist/npm/client';

import * as utils from './utils/test-utils';
import { GenesysCloudMediaSession } from '../../dist/npm/types/media-session';

const config = utils.getConfig();

let client: Client;
let activeCalls = [];

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

  afterEach(async function () {
    client.webrtcSessions.removeAllListeners();
    if (activeCalls.length) {
      await Promise.all(activeCalls.map(c => utils.disconnectCall(c)));
      activeCalls = [];
    }
  });

  after(() => {
    return utils.disconnectClient(client);
  });

  async function testCall (phoneNumber: string, timeout = 0) {
    // Yes, this timeout is long, but it's because we're making a real call
    if (timeout) {
      this.timeout(timeout);
    } else if (config.callDelay) {
      this.timeout(config.callDelay + 20000);
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
    session.accept();
    activeCalls.push(conversationId);
    const remoteStream = await peerTrackAdded;
    await utils.validateStream(session, remoteStream, conversationId);
  }

  it('can connect to voicemail [streaming-softphone]', async function () {
    await testCall.call(this, '*86');
  });

  it('can connect a call [streaming-softphone]', async function () {
    await testCall.call(this, config.outboundNumber);
  });

  it('can connect mulitple calls [streaming-softphone]', async function () {
    await testCall.call(this, config.outboundNumber, 84000);
    await testCall.call(this, config.outboundNumber, 84000);
    await testCall.call(this, config.outboundNumber, 84000);
    await testCall.call(this, config.outboundNumber, 84000);
    await testCall.call(this, config.outboundNumber, 84000);
    await testCall.call(this, config.outboundNumber, 84000);
    await testCall.call(this, config.outboundNumber, 84000);
    await testCall.call(this, config.outboundNumber, 84000);
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
