window.client = new GenesysCloudStreamingClient(window.scConfig)

let count = 0;
const stanzaConnect = client._stanzaio.connect.bind(client._stanzaio);
client._stanzaio._connect = () => {
  count++;
  console.log(`_stanzaio.connect(): ${count}`);
  stanzaConnect();
}

client._stanzaio.on('--transport-disconnected', function () { console.log('stanza::', '--transport-disconnected', ...arguments) });
client._stanzaio.on('session:started', function () { console.log('stanza::', 'session:started', ...arguments) });
client._stanzaio.on('session:end', function () { console.log('stanza::', 'session:end', ...arguments) });

client.connect()
  .then(() => console.debug('CONNECTED'))
  .catch(console.warn);

window.debug = () => {
  console.debug('==== DEBUG:', {
    connected: client.connected,
    connecting: client.connecting,
    wsReadyState: client._stanzaio.transport && client._stanzaio.transport.socket.readyState,
    channelId: client.config.channelId
  });
}