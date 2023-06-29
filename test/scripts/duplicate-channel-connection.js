const client1 = new window.GenesysCloudStreamingClient(window.scConfig);
window.client1 = client1;
let channelId;

async function run () {
  await client1.connect({ keepTryingOnFailure: true });
  channelId = client1.config.channelId;
  console.log('client1 connected, channel id: ' + channelId);

  while ( true ) {
    await wait(5000);
    await spinUpDuplicate();
  }
}

function wait (timeMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeMs);
  });
}

async function spinUpDuplicate () {
  const newClient = new window.GenesysCloudStreamingClient(window.scConfig);
  await newClient.connect({ keepTryingOnFailure: true });
  console.log('newClient connected');
  await newClient.disconnect();
  newClient.config.channelId = channelId;
  await newClient.connect({ keepTryingOnFailure: true });
  console.log('newClient connected again');
}

run();