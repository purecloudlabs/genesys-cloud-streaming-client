import * as utils from './utils/test-utils';

import { Client } from '../../dist/npm/client';
import { GenesysCloudMediaSession } from '../../dist/npm/types/media-session';

declare var window: {
  navigator: {
    mediaDevices: {
      getDisplayMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
    } & MediaDevices;
  } & Navigator;
} & Window & typeof globalThis;

const config = utils.getConfig();
let client: Client;
let guestClient: Client;
let context;
let activeConversationInfo;


describe('ACD Screen Share via streaming [assvs]', function () {
  before(async function () {
    (window as any).spigotContext = context = utils.getContext();
    (window as any).client = client = utils.createConnection(utils.getAuthToken());
    await client.connect();

    const iceServers = await client.webrtcSessions.refreshIceServers();
    if (!iceServers.length) {
      throw new Error('No ICE Servers received');
    }

    console.log('Streaming client connected', client);
  });

  afterEach(async () => {
    // clean up active conversation
    if (activeConversationInfo) {
      console.log(`Active conversation found. Disconnecting call '${activeConversationInfo.id}'.`);
      await utils.disconnectCall(activeConversationInfo.id, true);
      console.log(`Active conversation disconnected '${activeConversationInfo.id}'`);
      activeConversationInfo = null;
    }

    // clean up streaming-client listeners
    client.webrtcSessions.removeAllListeners();

    // clean up guest streaming-client
    return utils.disconnectClient(guestClient);
  });

  after(async () => {
    await Promise.all([
      utils.disconnectClient(guestClient),
      utils.disconnectClient(client)
    ]);
  });

  async function startScreenShare () {
    activeConversationInfo = await utils.testCall(this, client, { phoneNumber: config.outboundNumber, callFromQueueId: context.userQueues[0].id });
    // https://api.inindca.com/api/v2/conversations/58b4f213-9c95-490b-9ddc-c2762e778fc9/participants/413707bc-d518-4ce2-9933-192cb7dc092c/codes
    // {"conversation":{"id":"58b4f213-9c95-490b-9ddc-c2762e778fc9","participants":[],"selfUri":"/api/v2/conversations/58b4f213-9c95-490b-9ddc-c2762e778fc9"},"addCommunicationCode":"324738","sourceCommunicationId":"49c868d9-85b0-423d-bfbe-2fa0d6b43a73"}
    console.log('activeConversationInfo', activeConversationInfo);
    const customer = activeConversationInfo.participants.find(p => p.purpose === 'customer' || p.purpose === 'voicemail');
    const codeData = await utils.fetchJson(`${config.apiUrl}/conversations/${activeConversationInfo.id}/participants/${customer.id}/codes`, {
      headers: utils.getHeaders(),
      method: 'POST',
      body: JSON.stringify({ mediaType: 'screenshare' })
    });
    console.log('CODES result', codeData);

    const headers = new window.Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Accept', 'application/json');
    headers.set('Genesys-App', 'developercenter-cdn--streaming-client-webui');

    const custData = await utils.fetchJson(`${config.apiUrl}/conversations/codes`, {
      headers,
      method: 'POST',
      body: JSON.stringify({
        organizationId: context.org.id,
        addCommunicationCode: codeData.addCommunicationCode
      })
    });

    console.log('CUST DATA', custData);
    guestClient = utils.createConnection(undefined, custData.jwt);

    (window as any).guestClient = guestClient;
    await guestClient.connect();
    guestClient._webrtcSessions.setIceServers(client._stanzaio.jingle.iceServers);
    console.log('customer client connected');

    const customerSourceStream = await window.navigator.mediaDevices.getDisplayMedia({});
    await utils.attachStream(customerSourceStream, false, 'customer source stream');
    const jwt = utils.parseJwt(custData.jwt);
    const jid = jwt.data.jid;

    const gotCustSession = new Promise<GenesysCloudMediaSession>((resolve, reject) => {
      utils.rejectTimeout(reject, 'Customer Session', config.validationTimeout * 2);
      guestClient._webrtcSessions.once('incomingRtcSession', (session: GenesysCloudMediaSession) => {
        console.log('Got customer incoming session', session);
        session.pc.addTrack(customerSourceStream.getVideoTracks()[0]);
        session.accept();
        resolve(session);
      });
      guestClient.webrtcSessions.on('*', console.log.bind(console, 'custSessionEvent'));
    });
    const custSessionid = guestClient.webrtcSessions.initiateRtcSession({
      stream: customerSourceStream,
      jid,
      mediaPurpose: 'screenShare',
      conversationId: custData.conversation.id,
      sourceCommunicationId: custData.sourceCommunicationId
    });

    await utils.timeout(2000);

    const gotAgentSession = new Promise<GenesysCloudMediaSession>((resolve, reject) => {
      utils.rejectTimeout(reject, 'Agent Session', config.validationTimeout * 2);
      client._webrtcSessions.once('incomingRtcSession', async session => {
        console.log('Got agent incoming session', session);
        session.accept();
        resolve(session);
      });
      client.webrtcSessions.on('*', console.log.bind(console, 'agentSessionEvent'));
    });

    const agentSessionId = client.webrtcSessions.initiateRtcSession({
      jid,
      conversationId: codeData.conversation.id,
      sourceCommunicationId: codeData.sourceCommunicationId
    });

    console.log('requested sessions', { custSessionid, agentSessionId });
    const customerSession = await gotCustSession;
    const agentSession = await gotAgentSession;

    const peerTrackAdded = new Promise<MediaStream>((resolve, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for remote stream')), config.validationTimeout);
      if (agentSession.streams.length === 1 && agentSession.streams[0].getVideoTracks().length > 0) {
        // utils.attachStream(agentSession.streams[0], false, 'agent side incoming stream initial');
        return resolve(agentSession.streams[0]);
      }
      agentSession.on('peerTrackAdded', async (track, stream) => {
        console.log('peerTrackAdded', { track, sessionId: agentSession.sid });
        // utils.attachStream(stream, false, 'agent side incoming stream added later');
        resolve(stream);
      });
    });

    console.log('agentSession', agentSession);
    console.log('customerSession', customerSession);
    (window as any).utils = utils;
    (window as any).agentSession = agentSession;
    (window as any).customerSession = customerSession;

    const agentStream = await peerTrackAdded;
    console.log('agent stream & tracks', { tracks: agentStream.getTracks() });
    await utils.getConversationDetails(codeData.conversation.id);
    await utils.validateVideoStream(agentSession, agentStream);

    return {
      customerSession,
      agentSession
    };
  }

  it('Can do a screen share and end the screenshare when the customer ends the session', async function () {
    const { agentSession, customerSession } = await startScreenShare.call(this);
    // verify that ending the customer session will also end the agent session
    const agentSessionEnded = new Promise<void>((resolve, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for agent session to end')), config.validationTimeout);
      agentSession.on('terminated', (reason) => {
        resolve();
      });
    });

    customerSession.end();
    await agentSessionEnded;
    await utils.timeout(1000);
  });

  it('Can do a screen share and end the screenshare when the agent ends the session', async function () {
    const { agentSession, customerSession } = await startScreenShare.call(this);
    // verify that ending the customer session will also end the agent session
    const customerSessionEnded = new Promise<void>((resolve, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for customer session to end')), config.validationTimeout);
      customerSession.on('terminated', (reason) => {
        resolve();
      });
    });

    agentSession.end();
    await customerSessionEnded;
    await utils.timeout(1000);
  });

  it('Can do a screen share and end the screenshare when the conversation ends', async function () {
    const { agentSession, customerSession } = await startScreenShare.call(this);

    if (!activeConversationInfo) {
      throw new Error('No `activeConversationInfo` found to end the conversation');
    }

    const customerSessionEnded = new Promise<void>((resolve, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for customer session to end')), config.validationTimeout);
      customerSession.on('terminated', (reason) => {
        resolve();
      });
    });

    const agentSessionEnded = new Promise<void>((resolve, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for agent session to end')), config.validationTimeout);
      agentSession.on('terminated', (reason) => {
        resolve();
      });
    });

    console.log(`Disconnecting call for conversation: '${activeConversationInfo.id}'`);
    await utils.disconnectCall(activeConversationInfo.id, true);
    console.log(`Active conversation disconnected '${activeConversationInfo.id}'`);
    activeConversationInfo = null;

    await Promise.all([customerSessionEnded, agentSessionEnded]);
    await utils.timeout(1000);
  });
});
