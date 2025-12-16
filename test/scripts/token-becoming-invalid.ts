interface Window {
  GenesysCloudStreamingClient: any;
  scConfig: any;
  client: any;
}

let client: any;

const button = document.createElement('button');
button.onclick = () => {
  console.log('button clicked, going to send message');
  const barejid = client.activeStanzaInstance?.jid?.match(/(.+\.com)/)?.[1];
  const message = {
    to: barejid,
    from: client.activeStanzaInstance?.jid,
    mediaMessage: { id: '123', method: 'headsetControlsRequest', params: { requestType: 'mediaHelper' }}
  }
  client.activeStanzaInstance?.sendMessage(message);
};
button.textContent = 'Send message';
document.body.appendChild(button);

const button2 = document.createElement('button');
button2.textContent = 'Invalidate token';
button2.onclick = async () => {
  console.log('button clicked, invalidating auth token');
  client.setAccessToken('');
  await client.disconnect();
  client.connect({ keepTryingOnFailure: true });
}
document.body.appendChild(button2);


const authButon = document.createElement('button');
authButon.textContent = 'Set auth token';
authButon.onclick = () => {
  const input = document.querySelector('input');
  const token = input?.value;
  console.log('auth token', token);
  window.scConfig = {
    authToken: token,
    host: 'wss://streaming.inindca.com',
    optOutOfWebrtcStatsTelemetry: true
  };
  client = new window.GenesysCloudStreamingClient(window.scConfig);
  console.log('client');
  window.client = client;
  client.connect({ keepTryingOnFailure: true })
    .then(() => {
      console.log('Client connected 1');
    });

  client.on('error', (error) => {
    console.log('RECEIVED Streaming Client Error!!!!', error);
  });
}
document.body.appendChild(authButon);

const authInput = document.createElement('input');
authInput.type = 'text';
document.body.appendChild(authInput);

const clearAccessTokenBtn = document.createElement('button');
clearAccessTokenBtn.textContent = 'Clear access token';
clearAccessTokenBtn.onclick = () => {
  window.client.setAccessToken('');
}
document.body.appendChild(clearAccessTokenBtn);


const disconnect = document.createElement('button');
disconnect.textContent = 'Disconnect';
disconnect.onclick = () => {
  window.client.disconnect();
}
document.body.appendChild(disconnect);

