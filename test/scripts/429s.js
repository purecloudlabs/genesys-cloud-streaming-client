const client = new window.GenesysCloudStreamingClient(window.scConfig);
window.client = client;

// client.on('*', console.log);
async function run() {
  // good for reaching 429s
  // await Promise.all([
  //   window.issueTooManyRequests(authToken, 162, 'users/me'),
  //   window.issueTooManyRequests(authToken, 65, 'notifications/channels?connectionType=streaming')
  // ]);

  //
  // OR
  //
  
  // const jidRequestOpts = {
  //   method: 'get',
  //   host: 'inindca.com',
  //   authToken: 'INSERT AUTH TOKEN HERE',
  //   logger: console
  // };
  // for (let i = 0; i < 100; i++) {
  //   await Promise.resolve()
  //     .then(() => console.debug(`*** DEBUG starting request ${i}`))
  //     .then(() => client.http.requestApiWithRetry('users/me', jidRequestOpts).promise)
  //     .then(() => console.debug(`*** DEBUG ending request ${i}`));
  // }

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