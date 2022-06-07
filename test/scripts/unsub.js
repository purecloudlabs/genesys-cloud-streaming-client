const client = new window.GenesysCloudStreamingClient(window.scConfig);
window.client = client;

function logDebug () {
  console.log('___current subs:', {
    indiviualSubs: { ...client._notifications.subscriptions },
    bulkSubs: { ...client._notifications.bulkSubscriptions },
  });
}

async function run () {
  await client.connect();

  const user = await client.http.requestApiWithRetry('users/me', {
    method: 'get',
    host: client.config.apiHost,
    authToken: client.config.authToken,
    logger: client.logger
  }).promise.then(res => res.data);

  console.clear();

  const stationTopic = `v2.users.${user.id}.station`;
  const conversationsTopic = `v2.users.${user.id}.conversations`;
  const presenceTopic = `v2.users.${user.id}.presence`;
  const myHandler = () => { /* nothing */ };

  console.log('subscribing to individual station, conversation, & presence topics');
  await Promise.all([
    client.notifications.subscribe(stationTopic, myHandler, false),
    client.notifications.subscribe(presenceTopic, myHandler, false),
    client.notifications.subscribe(conversationsTopic, myHandler, false)
  ]);
  /* here, individual sub list should have three topics with handlers */
  logDebug();

  console.log('subscribing to bulk station & conversation topics');
  await client.notifications.bulkSubscribe([stationTopic, conversationsTopic]);
  /* here, bulk sub list should have two topics with value of `true` */
  logDebug();

  console.log('unsubscribing from individual station and presence topic');
  await client.notifications.unsubscribe(stationTopic, myHandler);
  await client.notifications.unsubscribe(presenceTopic, myHandler);
  /* here, bulk sub list should have two topics with value of `true` but those topics should not be in the individual list */
  logDebug();
}

run();