const client = new window.GenesysCloudStreamingClient(window.scConfig);
window.client = client;

client.connect();