### Notifications:

The notifications extension is compatible with topics from our [Notifications][1] APIs.
[1]: https://developer.mypurecloud.com/api/rest/v2/notifications/index.html

The extension provides the following API:

`client.notifications.on('notify', ({ topic, payload })` - For observing all
notifications without explicit handlers.

`client.notifications.bulkSubscribe(topics) - Promise<void>` - For bulk subscribing to topics
 - If a single topic in the bulk request fails (for example, due to permissions), the batch
 fails. the Promise will reject with API message indicating the failure.

`client.notifications.bulkUnsubscribe(topics) - Promise<void>` - For bulk unsubscribing from topics

Bulk subscriptions should be used in mose cases, however, for applications with
smaller discrete components and fewer topic subscriptions, handler subscriptions for individual
topics are useful.

`client.notifications.subscribe(topic, handler) : Promise<void>` - For registering
a handler for a topic

`client.notifications.unsubscribe(topic, handler) : Promise<void>` For unregistering
a handler for a topic

When unsubscribing, either through bulk or individual subscriptions, the client will
only unsubscribe the topic from the backend if there are no more handlers. Since bulk
subscriptions don't have a specific handler for each topic, they could as a single "handler"
for each topic, so that an unsubscribe later will still reference count it.
