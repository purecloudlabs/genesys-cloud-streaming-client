const client = new window.GenesysCloudStreamingClient(window.scConfig);
window.client = client;

client.connect({ keepTryingOnFailure: true })
  .then(() => {
    const personId = client.me.id;
    client._notifications.subscribe(`v2.users.${personId}.station`);

    // setTimeout(() => {
    //   client._notifications.subscribe(`v2.users.${personId}.station`);
    // }, 3000);
  })