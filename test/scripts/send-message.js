const client = new window.GenesysCloudStreamingClient(window.scConfig);
window.client = client;

client.connect({ keepTryingOnFailure: true })
  .then(() => {
    const barejid = client.activeStanzaInstance.jid.match(/(.+\.com)/)[1];
    const message = {
      to: barejid,
      from: client.activeStanzaInstance.jid,
      mediaMessage: {id: '123', method: 'headsetControlsRequest', params: { requestType: 'mediaHelper' }}
    };
    client.activeStanzaInstance?.sendMessage(message);
  });