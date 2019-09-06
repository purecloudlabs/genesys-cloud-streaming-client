### Notifications:

The notifications extension is compatible with topics from our [Notifications][1] APIs.
[1]: https://developer.mypurecloud.com/api/rest/v2/notifications/index.html

The extension provides the following API:

`client.notifications.bulkSubscribe(topics, options = { replace: false }) - Promise<void>`
  - For bulk subscribing to topics
  - If a single topic in the bulk request fails (for example, due to permissions), the batch
 fails. the Promise will reject with API message indicating the failure.
  - parameters
    - `Object options` Optional; with properties:
      - `Boolean replace`: true indicates the list of topics should replace the
          current list of bulk subscribed topics (without removing individually subscribed topics)
      - `Boolean force`: true indicates that individually subscribed topics should be removed
          (i.e., forcibly overwrite the list of subscribed topics)

Examples:

```js
await client.notifications.bulkSubscribe(['topic1', 'topic2']);
// subscribed topics: [ 'topic1', 'topic2' ]
await client.notifications.bulkSubscribe(['topic3', 'topic4'])
// subscribed topics: [ 'topic1', 'topic2', 'topic3', 'topic4' ]
await client.notifications.bulkSubscribe(['topic5', 'topic6'], { replace: true })
// subscribed topics: [ 'topic5', 'topic6' ]
```

To listen for notification events for subscribed topics, use one of:

`client.on('notify', ({ topic, data }) => {})`
`client.on('notify:your-topic', data => {})`

Example:

```js
// myUserId defined
const topics = ['conversations.calls', 'conversations.chats', 'conversations.emails']
  .map(topic => `v2.users.${myUserId}.${topic}`);
client.notifications.bulkSubscribe(topics)
client.on(`notify:v2.users.${myUserId}.conversations.calls`, handleCall);
client.on(`notify`, ({topic, data}) => {
  if (topics.indexOf(topic) === -1) {
    // other subscription or system topic
  }
});
```

Bulk subscriptions should be used in most cases. However, for applications with
smaller, discrete components and fewer topic subscriptions, handler subscriptions for individual
topics are useful.

`client.notifications.subscribe(topic, handler = () => {}) : Promise<void>` - For registering
a handler for a topic. Handler is optional. When no handler is provided, use event
bindings shown above (`on('notify...')`).

`client.notifications.unsubscribe(topic, handler = () => {}) : Promise<void>` For unregistering
a handler for a topic

When unsubscribing, the client will only unsubscribe the topic from the backend if
there are no more handlers. Since bulk subscriptions don't have a specific handler for each topic, they count as a single "handler" for each topic, so that an unsubscribe later will still reference count it.

#### Mixing Bulk and Individual Subscriptions

Mixing bulk and individual subscriptions may be useful when dealing with an application where
most topics are managed by a central service, but some smaller components want to subscribe as
well, without disrupting reference counting.

To support this, calling `bulkSubscribe(topics, { replace: true })` will maintain any individual
subscriptions made previously with `subscribe(topic, handler)`. In order to forcibly overwrite
the list of subscriptions, you can provide `force: true` in the options parameter. For example:

```js
// myUserId defined
client.notifications.subscribe(`topic1`, () => {});

await client.notifications.bulkSubscribe(['topic2', 'topic3'], { replace: true });
// subscribed topics: ['topic1', 'topic2', 'topic3']

await client.notifications.bulkSubscribe(['topic4', 'topic5'], { replace: true })
// subscribed topics: ['topic1', 'topic4', 'topic5']

await client.notifications.bulkSubscribe(['topic4', 'topic5'], { replace: true, force: true })
// subscribed topics: ['topic4', 'topic5']
```