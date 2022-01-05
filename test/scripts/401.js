const client = new window.GenesysCloudStreamingClient({ ...window.scConfig, authToken: "BAD" });

client.connect();
