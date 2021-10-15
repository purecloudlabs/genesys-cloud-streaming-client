const client = new window.GenesysCloudStreamingClient(window.scConfig);
window.client = client;

// client.on('*', console.log);
async function run() {
  // good for reaching 429s
  // await Promise.all([
  //   window.issueTooManyRequests(authToken, 162, 'users/me'),
  //   window.issueTooManyRequests(authToken, 65, 'notifications/channels?connectionType=streaming')
  // ]);

  await client.connect();

  // uncomment in order to answer calls (no media provided)
  // client.webrtcSessions.on('requestIncomingRtcSession', (session) => {
  //   client.webrtcSessions.acceptRtcSession(session.sessionId)
  // });

  // client.webrtcSessions.on('incomingRtcSession', session => {
  //   session.accept();
  // });

  // try {
  //   await client.reconnect();
  // } catch (error) {
  //   console.warn('error', { ...error });
  // }
}

run();