const client = new window.GenesysCloudStreamingClient(window.scConfig);
window.client = client;

client.connect({ keepTryingOnFailure: true })
  .then(() => {
    console.log('happy path connected');
  });