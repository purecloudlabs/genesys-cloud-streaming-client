'use strict';
const XMPP = require('stanza.io');
const PUBSUB_HOST = 'firehose.inindca.com';

function connection (client) {
    let subscribedTopics = [];

    let connection = {
        connected: false,
        subscribedTopics: subscribedTopics,
        on: client.on.bind(client),
        connect: client.connect.bind(client),
        disconnect: client.disconnect.bind(client),

        subscribe(topic) {
            return new Promise((resolve, reject) => {
                client.subscribeToNode(PUBSUB_HOST, topic, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        subscribedTopics.push(topic);
                        resolve();
                    }
                });
            });
        }
    };

    client.on('connected', function () {
        connection.connected = true;
    });

    client.on('disconnected', function () {
        connection.connected = false;
    });

    connection.on('session:started', function (event) {
        connection.streamId = event.resource;
    });

    client.on('pubsub:event', function (msg) {
        let topic = msg.event.updated.node;
        let payload = msg.event.updated.published[0].json;
        client.emit('push:notify', {topic: topic, data: payload});
    });

    return connection;
}

let apiMethods = {

    stream(host, jid, auth) {
        let wsHost = host.replace(/http:\/\//, 'ws://')
                         .replace(/https:\/\//, 'wss://');
        let wsUrl = `${wsHost}/stream`;
        var client = XMPP.createClient({
            jid: jid,
            credentials: {
                username: jid,
                password: auth
            },
            transport: 'websocket',
            wsURL: wsUrl
        });

        return connection(client);

    }
};

module.exports = function (host) {
    let api = {};
    Object.keys(apiMethods).forEach((key) => {
        api[key] = apiMethods[key].bind(null, host);
    });
    return api;
};
