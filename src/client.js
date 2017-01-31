'use strict';
const XMPP = require('stanza.io');
const notifications = require('./notifications');

let extensions = {
    notifications: notifications
};

function connection (client) {
    let subscribedTopics = [];

    let connection = {
        connected: false,
        subscribedTopics: subscribedTopics,
        on: client.on.bind(client),
        connect: client.connect.bind(client),
        disconnect: client.disconnect.bind(client),
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

    Object.keys(extensions).forEach((extensionName) => {
        connection[extensionName] = extensions[extensionName](client);
    });

    return connection;
}

module.exports = {

    connection(host, jid, auth) {
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

    },

    extend(namespace, extender) {
        if (extensions[namespace]) {
            throw `Cannot register already existing namespace ${namespace}`;
        }
        extensions[namespace] = extender;
    }

};
