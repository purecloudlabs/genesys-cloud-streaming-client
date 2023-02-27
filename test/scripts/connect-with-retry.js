const client = new window.GenesysCloudStreamingClient({
  ...window.scConfig
});

window.client = client;

let connectionAttempt = 0;

client['makeConnectionAttempt'] = () => {
  const conAttempt = connectionAttempt++;
  console.log('making connection attempt', { connectionAttempt: conAttempt });
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      console.log('rejecting attempt', { connectionAttempt: conAttempt });
      reject();
    }, 100);
  });
}

client.connect({ maxConnectionAttempts: 10, maxDelayBetweenConnectionAttempts: 10000 });

client.logger.info('logging from the streaming-client logger');