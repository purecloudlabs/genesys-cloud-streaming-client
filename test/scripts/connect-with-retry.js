const client = new window.GenesysCloudStreamingClient({
  ...window.scConfig
});

window.client = client;

client.connect({ keepTryingOnFailure: true, retryDelay: 3000 });

client.logger.info('logging from the streaming-client logger');